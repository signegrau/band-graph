import * as d3 from "d3";
import * as d3Zoom from "d3-zoom";
import parse = require("csv-parse");

interface Node {
    id: string;
    name: string;
}

interface Edge {
    source: string;
    target: string;
    bands: string[];
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

    return await new Promise((resolve, reject) => parse(text, {
        delimiter: ';',
        relax_column_count: true,
        to: 600,
    }).on('readable', function () {
        let record: ReadonlyArray<string>;
        while (record = this.read()) {
            const band = record[0].split(',')[1];
            const members: ReadonlyArray<Node> = record.slice(1).map((s) => {
                const split = s.split(',');
                return {
                    id: split[0],
                    name: split[1]
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

                    const existing = bandMemberMap.get(sorted[1]);

                    if (existing) {
                        existing.bands.push(band);
                    } else {
                        bandMemberMap.set(sorted[1], {
                            source: member.id,
                            target: m.id,
                            bands: [band]
                        });
                    }
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

    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id))
        .force("charge", d3.forceManyBody())
        .force('collision', d3.forceCollide().radius(d => 0.5));


    const svg = d3.create("svg")
        .attr("viewBox", [-width / 2, -height/2, width, height]);

    const link = svg.append("g")
        .attr("stroke", "#f00")
        .attr("stroke-opacity", 0.8)
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke-width", d => Math.sqrt(Math.pow(d.bands.length, 2)));

    const node = svg.append("g")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.0)
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", 5)
        .attr("fill", d => "black");


    svg.call(d3Zoom.zoom().on("zoom", () => {
        svg.attr("transform", d3.event.transform)
    }));

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
