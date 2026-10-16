// Verifies that every node in public/graph.json (the legacy flat-image
// fallback Scene.jsx loads when there is no theater bake) points at an image
// that actually exists in public/assets/.
//
//   node scripts/verify-assets.cjs         check only; exit 1 on any missing
//                                          image (run by `npm run verify`/CI)
//   node scripts/verify-assets.cjs --fix   rewrite public/graph.json: remap
//                                          each node to an existing id+ext,
//                                          drop nodes with no file, and
//                                          bridge edges around dropped nodes
const fs = require('fs');
const path = require('path');

const FIX = process.argv.includes('--fix');

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

if (!FIX) {
    const broken = graph.nodes.filter(n => !n.image || !assets.includes(n.image));
    if (broken.length > 0) {
        console.error(`public/graph.json: ${broken.length}/${graph.nodes.length} node image(s) missing from public/assets/:`);
        broken.forEach(n => console.error(`- ${n.id}: ${n.image}`));
        console.error('Run `node scripts/verify-assets.cjs --fix` to regenerate the fallback graph from files on disk.');
        process.exit(1);
    }
    console.log(`- All ${graph.nodes.length} fallback graph images present.`);
    process.exit(0);
}

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
