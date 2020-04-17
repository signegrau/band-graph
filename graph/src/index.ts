import d3 from "d3";
import parse = require("csv-parse");

interface Node {
    id: string;
    name: string;
}

interface Edge {
    source: string;
    target: string;
    band: string;
}

interface Data {
    edges: ReadonlyArray<Edge>;
    nodes: ReadonlyArray<Node>;
}

const getData = async (): Promise<Data> => {
    const response = await fetch("/data/bands.csv");
    const text = await response.text();

    const edges: Array<Edge> = [];
    const bandMembers: Map<string, Node> = new Map();

    return await new Promise((resolve, reject) => parse(text, {
        delimiter: ';',
        relax_column_count: true,
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
                members.slice(i + 1).forEach((m) => edges.push({
                        source: member.id,
                        target: m.id,
                        band: band
                    })
                );
            }

            members.forEach(m => bandMembers.set(m.id, m));
        }
    }).on('end', function () {
        console.log(edges.slice(0, 20));
        resolve({
            edges: edges,
            nodes: Array.from(bandMembers.values()),
        })
    }));
}

getData().then((data) => {
    console.log(data.nodes.slice(0, 20));
});
