import * as d3 from "d3";
import * as d3Zoom from "d3-zoom";
import * as d3Polygon from "d3-polygon";
import parse = require("csv-parse");

interface Node {
    id: string;
    name: string;
    group: string;
    x?: number;
    y?: number;
    rx?: number;
    ry?: number;
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
        //to_line: 1000
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

const network = (prev, index: (n: string) => string, expand: string | undefined) => {
    let gm = {},    // group map
        nm = {},    // node map
        lm = {},    // link map
        gn = {},    // previous group nodes
        gc = {},    // previous group centroids
        nodes = [], // output nodes
        links = []; // output links

    // process previous nodes for reuse or centroid calculation
    if (prev) {
        prev.nodes.forEach(function (n) {
            let i = index(n.id), o;
            if (n.size > 0) {
                gn[i] = n;
                n.size = 0;
            } else {
                o = gc[i] || (gc[i] = {x: 0, y: 0, count: 0});
                o.x += n.x;
                o.y += n.y;
                o.count += 1;
            }
        });
    }

    // determine nodes
    for (let k = 0; k < data.nodes.length; ++k) {
        let n = data.nodes[k];
        let i = index(n.id);

        if (gm[i] == undefined) {
            gm[i] = gn[i] || {id: i, name: i, group: i, size: 0, nodes: []};
        }

        let l = gm[i];

        if (expand === i) {
            // the node should be directly visible
            nm[n.id] = n.id;
            nodes.push(n);
            if (gn[i]) {
                // place new nodes at cluster location (plus jitter)
                n.x = gn[i].x;
                n.y = gn[i].y;
            }
        } else {
            // the node is part of a collapsed cluster
            if (l.size == 0) {
                l.nodes = [];
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

        if (n.rx === undefined || n.ry === undefined) {
            n.rx = Math.random();
            n.ry = Math.random();
        }
    }

    for (const i in gm) {
        gm[i].link_count = 0;
    }

    // determine links
    for (let k = 0; k < data.edges.length; ++k) {
        let e = data.edges[k],
            u = index(e.source),
            v = index(e.target);
        if (u != v) {
            gm[u].link_count++;
            gm[v].link_count++;
        }
        let internal = u == v;
        u = expand == u ? nm[e.source] : u;
        v = expand == v ? nm[e.target] : v;
        let i = (u < v ? u + "|" + v : v + "|" + u),
            l = lm[i] || (lm[i] = {source: u, target: v, size: 0, internal: internal});
        l.size += 1;
    }
    for (const i in lm) {
        links.push(lm[i]);
    }

    return {nodes: nodes, links: links};
}

const convexHulls = (nodes, index, offset) => {
    let hulls = {};

    // create point sets
    for (let k = 0; k < nodes.length; ++k) {
        const n = nodes[k];
        if (n.size) continue;
        const i = index(n.id),
            l = hulls[i] || (hulls[i] = []);
        l.push([n.x - offset, n.y - offset]);
        l.push([n.x - offset, n.y + offset]);
        l.push([n.x + offset, n.y - offset]);
        l.push([n.x + offset, n.y + offset]);
    }

    // create convex hulls
    const hullset = [];
    for (let i in hulls) {
        hullset.push({group: i, path: d3Polygon.polygonHull(hulls[i])});
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

const tooltip = d3.select("body").append("div")
    .attr("class", "tooltip")
    .style("opacity", 0);

let data: Data, svg, root, net, simulation, simulationInner, linkBands, link, node, hull, zoomHandler, dragHandler,
    selected, selectedd;
let height = 6400;
let width = 6400;

const nodeRadius = d => d.nodes ? Math.log(d.nodes.length) * 3 : (d.id === selected ? 5 : 3)
const nodeFill = d => d.nodes ? "#000000" : "#673AB7"

const search = d3.select("#search").on("input", function () {
    const value = d3.event.target.value;
    node.attr('fill', nodeFill).filter(function (d) {
        return d.id.toLowerCase().includes(value.toLowerCase())
    }).attr('fill', 'red');
    console.log(d3.event.target.value);
})

const init = (initData: Data) => {
    data = initData;

    svg = d3.create("svg")
        .attr("viewBox", [0, 0, width, height]);

    root = svg.append("g")
        .attr("class", "everything");

    dragHandler = d3.drag()
        .on("start", d => {
            if (!d3.event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        })
        .on("drag", d => {
            d.fx = d3.event.x;
            d.fy = d3.event.y;
        })
        .on("end", d => {
            if (!d3.event.active) simulation.alphaTarget(0);

            if (d.group_data === undefined) {
                d.fx = null;
                d.fy = null;
            }
        });

    zoomHandler = d3Zoom.zoom().on("zoom", () => {
        root.attr("transform", d3.event.transform);
    });

    zoomHandler(svg);

    makeChart(undefined);
}

const getBand = (n: string) => n.split('|')[1] || n;
const getName = (n: string) => n.split('|')[0] || undefined;

const size = (d) => d.group_data?.size || d.size;

const noise = (value: number, radius: number, rand?: number) => (value - (radius / 2)) + ((rand ?? Math.random()) * radius)

const group_radius = (d) => size(d) * 2
const group_area = (d, i: 'x' | 'y') => [d.group_data[i] - (group_radius(d) / 2), d.group_data[i] + (group_radius(d) / 2)]

const makeChart = (expand: string | undefined) => {
    if (simulation) simulation.stop();
    if (simulationInner) simulationInner.stop();

    net = network(net, getBand, expand);

    net.nodes = net.nodes.map(d => {
        if (d.group_data) {
            const i = d.index - d.group_data.index;
            d.fx = noise(d.group_data.x, group_radius(d), d.rx);
            d.fy = noise(d.group_data.y, group_radius(d), d.ry);
        }

        return d;
    });

    simulation = d3.forceSimulation(net.nodes)
        .force("link", d3.forceLink(net.links).id(d => d.id).distance(link =>
            30
        ).strength((link) =>
            1 / Math.min(size(link.source), size(link.target))
        ))
        .force("charge", d3.forceManyBody().strength(d => -30)
            .theta(10).distanceMax(2000))
        .force('collision', d3.forceCollide().radius(d => 2 + (d.nodes ? Math.log(d.nodes.length) * 3 : 8)))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('x', d3.forceX(width / 2).strength(d => size(d) * 0.007))
        .force('y', d3.forceY(height / 2).strength(d => size(d) * 0.007));

    const linkStroke = d => d.source.group_data || d.target.group_data ? "#43A047" : "#B0BEC5";
    const linkOpacity = d => d.internal ? 0.0 : 1;
    const linkWidth = d => d.internal ? 0.0 : Math.sqrt(Math.pow(d.size, 2));

    if (linkBands) linkBands.remove();
    linkBands = root.append("g")
        .selectAll("line")
        .data(net.links.filter(d => d.source.nodes !== undefined && d.target.nodes !== undefined))
        .join("line")
        .attr("stroke", linkStroke)
        .attr("stroke-opacity", linkOpacity)
        .attr("stroke-width", linkWidth);

    if (hull) hull.remove();
    hull = root.append("g")
        .data(convexHulls(net.nodes, getBand, 4))
        .append("path")
        .attr("class", "hull")
        .attr("d", drawCluster)
        .style("fill", d => "#03A9F4")
        .style("opacity", d => 0.4)
        .on("click", function (d) {
            console.log("hull click", d, arguments, this, expand[d.group]);

            if (selected) {
                d3.select(selected).attr("r", nodeRadius);
                d3.select(selected).attr("fill", nodeFill);

                const box = document.getElementById("box");
                box.style.display = "none";
                selected = undefined;
            }

            makeChart(undefined);
        });

    if (link) link.remove();
    link = root.append("g")
        .selectAll("line")
        .data(net.links.filter(d => d.source.nodes === undefined || d.target.nodes === undefined))
        .join("line")
        .attr("stroke", linkStroke)
        .attr("stroke-opacity", linkOpacity)
        .attr("stroke-width", linkWidth);

    if (node) node.remove();
    node = root.append("g")
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.0)
        .selectAll("circle")
        .data(net.nodes)
        .join("circle")
        .attr("r", nodeRadius)
        .attr("fill", nodeFill)
        .on("click", function (d) {
            console.log("node click", d, arguments, this, expand);
            if (d.nodes) {
                makeChart(d.group);
            } else {
                if (selected) {
                    d3.select(selected).attr("r", nodeRadius);
                    d3.select(selected).attr("fill", nodeFill);

                    link.each(function (l) {
                        if ((l.source === selectedd || l.target === selectedd) && l.source.group !== l.target.group) {
                            d3.select(this).attr('stroke', linkStroke)
                        }
                    });
                }

                selected = this;
                selectedd = d;
                d3.select(this).attr('fill', "#FF9800");
                d3.select(this).attr('r', 5);

                link.each(function (l) {
                    if ((l.source === d || l.target === d) && l.source.group !== l.target.group) {
                        d3.select(this).attr('stroke', "#FF4081")
                    }
                });

                const artist = {
                    name: d.name,
                    bands: [{
                        name: d.group,
                        members: d.group_data.nodes.filter(e => e.id !== d.id).map(e => e.name),
                    }].concat(data.edges
                        .filter(e => getBand(e.source) !== getBand(e.target) && (e.source === d.id || e.target === d.id))
                        .map(e => {
                            const other = e.source === d.id ? e.target : e.source;
                            return data.nodes.filter(n => n.id === other)[0].group;
                        })
                        .map(b => ({
                            name: b,
                            members: data.nodes.filter(n => n.group === b && getName(n.id) !== getName(d.id))
                                .map(n => n.name)
                        })))
                }

                const box = document.getElementById("box");
                const boxContents = document.getElementById("box-contents");
                box.style.display = "";
                boxContents.innerHTML = "";

                const title = document.getElementById('box-title');
                title.innerHTML = artist.name.trim();

                artist.bands.forEach(band => {
                    const div = document.createElement('div');

                    const subtitle = document.createElement('span');
                    subtitle.className = "box-subtitle";
                    subtitle.innerHTML = band.name.trim();

                    div.append(subtitle);

                    band.members.forEach(member => {
                        const item = document.createElement('span');
                        item.className = "box-item";
                        item.innerHTML = member.trim();

                        div.append(item);
                    })

                    boxContents.append(div);
                })
            }
        })
        .on("mouseover", function (d) {
            tooltip.html(d.name)
                .style("opacity", 1)
                .style("left", `${d3.event.pageX}px`)
                .style("top", `${d3.event.pageY}px`)
        })
        .on("mouseout", function (d) {
            tooltip.style("opacity", 0);
        });

    dragHandler(node);

    node.append("title")
        .text(d => d.id);

    simulation.on("tick", () => {
        if (!hull.empty()) {
            hull.data(convexHulls(net.nodes, getBand, 4))
                .attr("d", drawCluster);
        }

        linkBands
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node
            .attr("cx", d => d.x = Math.max(0, Math.min(d.x, width)))
            .attr("cy", d => d.y = Math.max(0, Math.min(d.y, height)));
    });
}

getData().then((data) => {
    console.log(data.nodes.length);
    console.log(data.edges.length);
    init(data);
    document.body.append(svg.node());
});
