const fs = require('fs');
const path = require('path');

const graphPath = path.join(__dirname, '../public/graph.json');
const assetsDir = path.join(__dirname, '../public/assets');

if (!fs.existsSync(graphPath)) {
    console.error('graph.json not found at', graphPath);
    process.exit(1);
}

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const assets = fs.readdirSync(assetsDir);

const missing = [];
const mismatched = [];

graph.nodes.forEach(node => {
    const id = node.id;
    // Check for jpg, jpeg, png, webp
    const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.JPG', '.JPEG', '.PNG', '.WEBP'];
    let found = false;
    let foundExt = '';

    for (const ext of extensions) {
        if (assets.includes(id + ext)) {
            found = true;
            foundExt = ext;
            break;
        }
    }

    if (!found) {
        missing.push(id);
    } else {
        // Log if it matches but might need extension mapping in code
    }
});

console.log('--- ASSET VERIFICATION ---');

// 1. Filter out missing nodes and Mapper Extensions
const originalNodesCount = graph.nodes.length;
graph.nodes = graph.nodes.filter(n => {
    const id = n.id;
    const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.JPG', '.JPEG', '.PNG', '.WEBP'];
    let found = false;
    for (const ext of extensions) {
        if (assets.includes(id + ext)) {
            n.image = id + ext;
            found = true;
            break;
        }
    }
    if (!found) {
        console.log(`- Missing asset for node: ${id}`);
        missing.push(id);
        return false;
    }
    return true;
});

console.log(`- Valid nodes: ${graph.nodes.length}/${originalNodesCount}`);

if (missing.length > 0) {
    console.log('\nRepairing edges for missing nodes...');
    // Bridge Edges
    let currentEdges = graph.edges;
    missing.forEach(mid => {
        const predecessors = currentEdges.filter(e => e.target === mid);
        const successors = currentEdges.filter(e => e.source === mid);
        const newEdges = [];
        predecessors.forEach(p => {
            successors.forEach(s => {
                if (p.source !== s.target) {
                    newEdges.push({
                        source: p.source,
                        target: s.target,
                        source_shard: p.source_shard,
                        target_shard: s.target_shard,
                        weight: (p.weight + s.weight) / 2
                    });
                }
            });
        });
        currentEdges = currentEdges.filter(e => e.source !== mid && e.target !== mid);
        currentEdges.push(...newEdges);
    });
    graph.edges = currentEdges;
    console.log(`- Final edge count: ${graph.edges.length}`);
}

fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
console.log('--- REPAIR COMPLETE ---');
