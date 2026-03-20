import fs from 'fs';
import path from 'path';

const DATA_DIR = './public/data';
const OUTPUT_DIR = './public/data/baked';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.baked.json'));

console.log(`Baking ${files.length} files with Perspective Correction...`);

const MAX_TOTAL_SHARDS = 10000; // Total count including mirrored
const FOV = 50;
const WORLD_HEIGHT = 10.0;
// Focal Distance D based on Camera FOV
const D = (WORLD_HEIGHT / 2) / Math.tan(((FOV / 2) * Math.PI) / 180); // ~10.7232

files.forEach(file => {
    try {
        const rawPath = path.join(DATA_DIR, file);
        const rawData = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
        const strokes = rawData.strokes || rawData.shards || [];
        if (strokes.length === 0) return;

        // 1. Determine raw depth range for normalization
        let minZ = Infinity, maxZ = -Infinity;
        strokes.forEach(s => {
            const z = (Array.isArray(s) ? s[2] : (s.z || s.depth || 0));
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        });

        // 2. Select and sort shards
        const shardLimit = Math.floor(MAX_TOTAL_SHARDS / 2);
        const sortedStrokes = [...strokes]
            .sort((a, b) => {
                const radA = Array.isArray(a) ? a[3] : (a.scale || 0);
                const radB = Array.isArray(b) ? b[3] : (b.scale || 0);
                return radB - radA;
            })
            .slice(0, shardLimit);

        const count = sortedStrokes.length;
        const outCount = count * 2;

        const aOffset = new Float32Array(outCount * 3);
        const aScale = new Float32Array(outCount * 2);
        const aColor = new Float32Array(outCount * 3);
        const aUvOffset = new Float32Array(outCount * 2);
        const aUvScale = new Float32Array(outCount * 2);

        for (let i = 0; i < count; i++) {
            const s = sortedStrokes[i];
            let rx, ry, rz, radius, randVal, cr, cg, cb;

            if (Array.isArray(s)) {
                [rx, ry, rz, radius, randVal, cr, cg, cb] = s;
                ry = -ry; // JSON usually has Y-down
            } else {
                rx = s.x || 0; ry = -(s.y || 0); rz = s.z || s.depth || 0;
                radius = s.scale || 1.0;
                randVal = s.random || Math.random();
                [cr, cg, cb] = s.color || [255, 255, 255];
            }

            // Map raw depth to normalized range [0, D]
            let t = (maxZ === minZ) ? 0.5 : (rz - maxZ) / (minZ - maxZ);
            const zF = -t * D;
            const zM = -2.0 * D + t * D;

            const writeShard = (groupIndex, worldZ) => {
                const idx = groupIndex + i;
                const factor = Math.abs(worldZ) / D;

                // Simple 'liquid' aspect ratio variation [0.8, 1.5]
                // Derived from the shard's own random value to stay deterministic
                const aspect = 0.8 + (randVal % 1.0) * 0.7;

                aOffset[idx * 3 + 0] = rx * factor;
                aOffset[idx * 3 + 1] = ry * factor;
                aOffset[idx * 3 + 2] = worldZ;

                aScale[idx * 2 + 0] = radius * factor * aspect;
                aScale[idx * 2 + 1] = radius * factor;

                aColor[idx * 3 + 0] = cr / 255;
                aColor[idx * 3 + 1] = cg / 255;
                aColor[idx * 3 + 2] = cb / 255;

                const uw = (radius * aspect) / 10;
                const uh = radius / 10;
                const ux = (rx + 5) / 10 - uw / 2;
                const uy = (ry + 5) / 10 - uh / 2;
                
                aUvOffset[idx * 2 + 0] = ux;
                aUvOffset[idx * 2 + 1] = uy;
                aUvScale[idx * 2 + 0] = uw;
                aUvScale[idx * 2 + 1] = uh;
            };

            writeShard(0, zF);
            writeShard(count, zM);
        }

        const result = {
            id: file.replace('.json', ''),
            count: outCount,
            aOffset: Array.from(aOffset),
            aScale: Array.from(aScale),
            aColor: Array.from(aColor),
            aUvOffset: Array.from(aUvOffset),
            aUvScale: Array.from(aUvScale)
        };

        fs.writeFileSync(path.join(OUTPUT_DIR, `${result.id}.baked.json`), JSON.stringify(result));
    } catch (err) {
        console.error(`Error baking ${file}:`, err);
    }
});

console.log("Baking Complete. Shards are now mathematically aligned for anamorphic coalescence.");
