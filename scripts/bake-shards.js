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
            count: count * 2, // Double for mirroring
            attributes: {
                aOffset: new Float32Array(count * 2 * 3),
                aScale: new Float32Array(count * 2 * 2),
                aColor: new Float32Array(count * 2 * 3),
                aUvOffset: new Float32Array(count * 2 * 2),
                aUvScale: new Float32Array(count * 2 * 2)
            }
        };

        const SIZE_MULTIPLIER = 1.3; 

        for (let i = 0; i < count; i++) {
            const shard = sortedShards[i];
            let nx, ny, nw, nh, raw_depth, r, g, b;
            let worldW, worldH;

            if (Array.isArray(shard)) {
                nx = shard[0] / 10.0;
                ny = -(shard[1] / 10.0);
                raw_depth = shard[2];
                worldW = shard[4] * SIZE_MULTIPLIER;
                worldH = shard[4] * SIZE_MULTIPLIER;
                nw = shard[4] / 10.0; 
                nh = shard[4] / 10.0;
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
                nw = w / imgW; 
                nh = h / imgH;
                worldW = nw * worldWidth * SIZE_MULTIPLIER;
                worldH = nh * WORLD_HEIGHT * SIZE_MULTIPLIER;
            }

            // Original Shard
            const z1 = raw_depth;
            const factor1 = Math.abs(z1) / Math.abs(FULCRUM_Z);

            baked.attributes.aOffset[i * 3] = nx * worldWidth * factor1;
            baked.attributes.aOffset[i * 3 + 1] = ny * WORLD_HEIGHT * factor1;
            baked.attributes.aOffset[i * 3 + 2] = z1;

            baked.attributes.aScale[i * 2] = worldW * factor1;
            baked.attributes.aScale[i * 2 + 1] = worldH * factor1;

            baked.attributes.aColor[i * 3] = r;
            baked.attributes.aColor[i * 3 + 1] = g;
            baked.attributes.aColor[i * 3 + 2] = b;

            baked.attributes.aUvOffset[i * 2] = (nx + 0.5) - (nw / 2.0);
            baked.attributes.aUvOffset[i * 2 + 1] = (ny + 0.5) - (nh / 2.0);
            baked.attributes.aUvScale[i * 2] = nw;
            baked.attributes.aUvScale[i * 2 + 1] = nh;

            // Mirrored Shard (Lobe 2)
            const idx2 = i + count;
            const z2 = 2.0 * FULCRUM_Z - raw_depth; // Mirror across the fulcrum
            const factor2 = Math.abs(z2) / Math.abs(FULCRUM_Z);

            baked.attributes.aOffset[idx2 * 3] = nx * worldWidth * factor2;
            baked.attributes.aOffset[idx2 * 3 + 1] = ny * WORLD_HEIGHT * factor2;
            baked.attributes.aOffset[idx2 * 3 + 2] = z2;

            baked.attributes.aScale[idx2 * 2] = worldW * factor2;
            baked.attributes.aScale[idx2 * 2 + 1] = worldH * factor2;

            baked.attributes.aColor[idx2 * 3] = r;
            baked.attributes.aColor[idx2 * 3 + 1] = g;
            baked.attributes.aColor[idx2 * 3 + 2] = b;

            baked.attributes.aUvOffset[idx2 * 2] = (nx + 0.5) - (nw / 2.0);
            baked.attributes.aUvOffset[idx2 * 2 + 1] = (ny + 0.5) - (nh / 2.0);
            baked.attributes.aUvScale[idx2 * 2] = nw;
            baked.attributes.aUvScale[idx2 * 2 + 1] = nh;
        }

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
