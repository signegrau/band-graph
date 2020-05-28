import * as d3 from "d3";
import * as d3Zoom from "d3-zoom";
import parse = require("csv-parse");

interface Node {
    id: string;
    name: string;
    group: string;
    x?: number;
    y?: number;
    size?: number;
    group_data?: string;
}

interface Edge {
    source: string;
    target: string;
    value: number;
}

interface Data {
    edges: ReadonlyArray<Edge>;
    nodes: ReadonlyArray<Node>;
}

const getData = async (): Promise<Data> => {
    const response = await fetch("/data/bands_full.csv");
    const text = await response.text();

    const bandMembers: Map<string, Node> = new Map();
    const bandMembersEdges: Map<string, Map<string, Edge>> = new Map();
    const artistBands: Map<string, Array<string>> = new Map();

    return await new Promise((resolve) => parse(text, {
        delimiter: ';',
        relax_column_count: true,
    }).on('readable', function () {
        let record: ReadonlyArray<string>;
        while (record = this.read()) {
            const band = record[0].split(',')[1];
            const members: ReadonlyArray<Node> = record.slice(1).map((s) => {
                const split = s.split(',');
                const artist = split[0];
                const id = `${artist}|${band}`;

                let bands = artistBands.get(artist);

                if (!bands) {
                    bands = [band];
                    artistBands.set(artist, bands);
                } else {
                    bands.push(band);
                }

                let bandMemberMap = bandMembersEdges.get(id);
                if (!bandMemberMap) {
                    bandMemberMap = new Map<string, Edge>();
                    bandMembersEdges.set(id, bandMemberMap);
                }

                bands.filter(b => b !== band).forEach(otherBand => {
                    const otherId = `${artist}|${otherBand}`;
                    bandMemberMap.set(otherId, {
                        source: id,
                        target: otherId,
                        value: 1,
                    });
                })

                return {
                    id: id,
                    name: split[1],
                    group: band,
                };
            });

            for (let i = 0; i < members.length - 1; i++) {
                const member = members[i];
                members.slice(i + 1).forEach((m) => {
                    const sorted = [member.id, m.id].sort((a, b) => a.localeCompare(b));

                    let bandMemberMap = bandMembersEdges.get(sorted[0]);

                    if (!bandMemberMap) {
                        bandMemberMap = new Map<string, Edge>();
                        bandMembersEdges.set(sorted[0], bandMemberMap);
                    }

                    bandMemberMap.set(sorted[1], {
                        source: member.id,
                        target: m.id,
                        value: 1,
                    });
                });
            }

            members.forEach(m => bandMembers.set(m.id, m));
        }
    }).on('end', function () {
        const edges = [];
        bandMembersEdges.forEach((map) => map.forEach(edge => edges.push(edge)));

        resolve({
            edges: edges,
            nodes: Array.from(bandMembers.values()),
        });
    }));
}

const network = (data: Data, prev: Data | undefined, index: (n: string) => string, expand) => {
    expand = expand || {};
    let gm = {},    // group map
        nm = {},    // node map
        lm = {},    // link map
        gn = {},    // previous group nodes
        gc = {},    // previous group centroids
        nodes = [], // output nodes
        links = []; // output links

    // process previous nodes for reuse or centroid calculation
    if (prev) {
        prev.nodes.forEach(function(n) {
            let i = index(n.id), o;
            if (n.size > 0) {
                gn[i] = n;
                n.size = 0;
            } else {
                o = gc[i] || (gc[i] = {x:0,y:0,count:0});
                o.x += n.x;
                o.y += n.y;
                o.count += 1;
            }
        });
    }

    // determine nodes
    for (let k=0; k<data.nodes.length; ++k) {
        let n = data.nodes[k],
            i = index(n.id),
            l = gm[i] || (gm[i]=gn[i]) || (gm[i]={id:i, name:i, group:i, size:0, nodes:[]});

        if (expand[i]) {
            // the node should be directly visible
            nm[n.id] = nodes.length;
            nodes.push(n);
            if (gn[i]) {
                // place new nodes at cluster location (plus jitter)
                n.x = gn[i].x + Math.random();
                n.y = gn[i].y + Math.random();
            }
        } else {
            // the node is part of a collapsed cluster
            if (l.size == 0) {
                // if new cluster, add to set and position at centroid of leaf nodes
                nm[i] = nodes.length;
                nodes.push(l);
                if (gc[i]) {
                    l.x = gc[i].x / gc[i].count;
                    l.y = gc[i].y / gc[i].count;
                }
            }
            l.nodes.push(n);
        }
        // always count group size as we also use it to tweak the force graph strengths/distances
        l.size += 1;
        n.group_data = l;
    }

    for (const i in gm) { gm[i].link_count = 0; }

    // determine links
    for (let k=0; k<data.edges.length; ++k) {
        let e = data.edges[k],
            u = index(e.source),
            v = index(e.target);
        if (u != v) {
            gm[u].link_count++;
            gm[v].link_count++;
        }
        u = expand[u] ? nm[e.source] : u;
        v = expand[v] ? nm[e.target] : v;
        let i = (u<v ? u+"|"+v : v+"|"+u),
            l = lm[i] || (lm[i] = {source:u, target:v, size:0});
        l.size += 1;
    }
    for (const i in lm) { links.push(lm[i]); }

    return {nodes: nodes, links: links};
}

const convexHulls = (nodes, index, offset) => {
    let hulls = {};

    // create point sets
    for (let k=0; k<nodes.length; ++k) {
        const n = nodes[k];
        if (n.size) continue;
        const i = index(n),
            l = hulls[i] || (hulls[i] = []);
        l.push([n.x-offset, n.y-offset]);
        l.push([n.x-offset, n.y+offset]);
        l.push([n.x+offset, n.y-offset]);
        l.push([n.x+offset, n.y+offset]);
    }

    // create convex hulls
    const hullset = [];
    for (let i in hulls) {
        hullset.push({group: i, path: d3.geom.hull(hulls[i])});
    }

    return hullset;
}

const curve = d3.line()
    .curve(d3.curveCardinalClosed);

const drawCluster = (d) => {
    return curve(d.path); // 0.8
}


const drag = simulation => {

    function dragstarted(d) {
        if (!d3.event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(d) {
        d.fx = d3.event.x;
        d.fy = d3.event.y;
    }

    function dragended(d) {
        if (!d3.event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
}

const makeChart = (data: Data) => {
    const links: ReadonlyArray<Edge> = data.edges.map(d => Object.create(d));
    const nodes: ReadonlyArray<Node> = data.nodes.map(d => Object.create(d));

    const height = 4800;
    const width = 6400;


    const svg = d3.create("svg")
        .attr("viewBox", [0, 0, width, height]);

    const root = svg.append("g")
        .attr("class", "everything");

    const net = network(data, null, (n: string) => n.split('|')[1], {});
    console.log(net);

    const simulation = d3.forceSimulation(net.nodes)
        .force("link", d3.forceLink(net.links).id(d => d.id))
        .force("charge", d3.forceManyBody())
        .force('collision', d3.forceCollide().radius(d => d.nodes.length))
        .force('center', d3.forceCenter(width / 2, height / 2));

    const link = root.append("g")
        .attr("stroke", "#f00")
        .attr("stroke-opacity", 0.8)
        .selectAll("line")
        .data(net.links)
        .join("line")
        .attr("stroke-width", d => Math.sqrt(Math.pow(d.size, 2)));

    const node = root.append("g")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.0)
        .selectAll("circle")
        .data(net.nodes)
        .join("circle")
        .attr("r", d => d.nodes.length)
        .attr("fill", "black")
        .call(drag(simulation));

    const zoomHandler = d3Zoom.zoom().on("zoom", () => {
        root.attr("transform", d3.event.transform);
    });

    zoomHandler(svg);

    node.append("title")
        .text(d => d.id);

    simulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node
            .attr("cx", d => d.x)
            .attr("cy", d => d.y);
    });

//invalidation.then(() => simulation.stop());

    return svg.node();
}

getData().then((data) => {
    console.log(data.nodes.length);
    console.log(data.edges.length);
    const svg = makeChart(data);
    document.body.append(svg);
});
