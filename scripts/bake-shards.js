import fs from 'fs';
import path from 'path';

const DATA_DIR = './public/data';
const OUTPUT_DIR = './public/data/baked';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.baked.json'));

console.log(`Baking ${files.length} files...`);

const MAX_SHARDS = 1500;
const FULCRUM_Z = -10.0;
const WORLD_HEIGHT = 10.0;

files.forEach(file => {
    try {
        const rawData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
        const shards = rawData.shards || rawData.strokes || [];
        if (shards.length === 0) return;

        const meta = rawData.meta || {};
        const res = rawData.resolution || meta.res || meta.resolution || [1000, 1000];
        const [imgW, imgH] = res;
        const imgAspect = imgW / imgH;
        const worldWidth = WORLD_HEIGHT * imgAspect;

        // Sort by size (index 4) descending
        const sortedShards = [...shards].sort((a, b) => (b[4] || 0) - (a[4] || 0)).slice(0, MAX_SHARDS);
        const count = sortedShards.length;

        const baked = {
            id: file.replace('.json', ''),
            res,
            count,
            // We'll use flat arrays for InterleavedBuffer accessibility or just compact JSON
            attributes: {
                aOffset: new Float32Array(count * 3),
                aScale: new Float32Array(count * 2),
                aColor: new Float32Array(count * 3),
                aUvOffset: new Float32Array(count * 2),
                aUvScale: new Float32Array(count * 2)
            }
        };

        for (let i = 0; i < count; i++) {
            const shard = sortedShards[i];
            let nx, ny, raw_depth, sw, sh, r, g, b;

            if (Array.isArray(shard)) {
                nx = shard[0] / 10.0;
                ny = shard[1] / 10.0;
                raw_depth = shard[2];
                sw = shard[4] * 0.5;
                sh = shard[4] * 0.5;
                r = (shard[5] || 255) / 255;
                g = (shard[6] || 255) / 255;
                b = (shard[7] || 255) / 255;
            } else {
                let x, y, w, h;
                if (shard.bbox) [x, y, w, h] = shard.bbox;
                else { x = shard.x || 0; y = shard.y || 0; w = shard.scale || 1; h = shard.scale || 1; }
                const col = shard.color || [255, 255, 255];
                r = col[0] / 255; g = col[1] / 255; b = col[2] / 255;
                nx = ((x + w / 2) / imgW) - 0.5;
                ny = -(((y + h / 2) / imgH) - 0.5);
                raw_depth = shard.depth !== undefined ? shard.depth : (shard.z || 0);
                sw = w / imgW; sh = h / imgH;
            }

            const z = raw_depth;
            const factor = Math.abs(z) / Math.abs(FULCRUM_Z);

            // aOffset
            baked.attributes.aOffset[i * 3] = nx * worldWidth * factor;
            baked.attributes.aOffset[i * 3 + 1] = ny * WORLD_HEIGHT * factor;
            baked.attributes.aOffset[i * 3 + 2] = z;

            // aScale
            baked.attributes.aScale[i * 2] = sw * worldWidth * factor;
            baked.attributes.aScale[i * 2 + 1] = sh * WORLD_HEIGHT * factor;

            // aColor
            baked.attributes.aColor[i * 3] = r;
            baked.attributes.aColor[i * 3 + 1] = g;
            baked.attributes.aColor[i * 3 + 2] = b;

            // aUvOffset/Scale
            baked.attributes.aUvOffset[i * 2] = nx + 0.5 - (sw / 2.0);
            baked.attributes.aUvOffset[i * 2 + 1] = (1.0 - (ny + 0.5)) - (sh / 2.0);
            baked.attributes.aUvScale[i * 2] = sw;
            baked.attributes.aUvScale[i * 2 + 1] = sh;
        }

        // Convert TypedArrays to regular arrays for JSON serialization (simplest for now)
        // In the future, write to .bin and load with ArrayBuffer
        const serializable = {
            id: baked.id,
            res: baked.res,
            count: baked.count,
            aOffset: Array.from(baked.attributes.aOffset),
            aScale: Array.from(baked.attributes.aScale),
            aColor: Array.from(baked.attributes.aColor),
            aUvOffset: Array.from(baked.attributes.aUvOffset),
            aUvScale: Array.from(baked.attributes.aUvScale),
        };

        fs.writeFileSync(path.join(OUTPUT_DIR, `${baked.id}.baked.json`), JSON.stringify(serializable));
    } catch (e) {
        console.error(`Error baking ${file}:`, e);
    }
});

console.log("Baking complete.");
