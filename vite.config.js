import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { lstatSync, readFileSync, readdirSync, readlinkSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Vite copies public/ into dist/ wholesale, with no filter. Some of what
// lives under public/ is source material that must stay on disk (scripts
// read it) but must never be deployed:
//   - public/assets/raw/   ~1 GB of full-resolution originals, input to the
//                          bake scripts (scripts/theater_baker.py etc.) only
//   - public/assets/<name> symlinks into raw/ (every top-level entry is one;
//                          the bake scripts read public/assets/ through
//                          them). Vite dereferences symlinks when copying,
//                          so without this the same ~1 GB ships again under
//                          dist/assets/. The only originals the site fetches
//                          are the images named in public/graph.json (the
//                          flat-image fallback in Scene.jsx), so those are
//                          kept.
//   - *.HEIC anywhere      browsers can't display it; only the bake reads it
//   - loose images directly in public/data/ (not in a subfolder) — strays;
//                          the runtime only fetches JSON/bakes from there
// This prunes them from dist/ after the copy. It deletes from the BUILD
// OUTPUT only, never from public/.
const SHIP_EXCLUDE_DIRS = ['assets/raw'];
const HEIC_RE = /\.hei[cf]$/i;
const LOOSE_DATA_IMAGE_RE = /\.(jpe?g|png|webp|tiff?|hei[cf])$/i;

function walk(dir, visit) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, visit);
    else visit(p, e.name);
  }
}

// Names (relative to public/assets/) of the images the runtime fallback
// graph references — the only originals that must survive pruning.
function fallbackGraphImages(publicDir) {
  try {
    const g = JSON.parse(readFileSync(join(publicDir, 'graph.json'), 'utf8'));
    return new Set((g.nodes || []).map(n => n.image).filter(Boolean));
  } catch {
    return new Set();
  }
}

function excludeSourceMaterial() {
  let outDir = 'dist';
  let publicDir = 'public';
  return {
    name: 'exclude-source-material',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      publicDir = config.publicDir;
    },
    // writeBundle runs after Vite's public/ copy, and before
    // vite-plugin-pwa scans dist/ for its precache manifest in closeBundle.
    writeBundle() {
      let removed = 0;
      for (const rel of SHIP_EXCLUDE_DIRS) {
        rmSync(join(outDir, rel), { recursive: true, force: true });
      }
      const keep = fallbackGraphImages(publicDir);
      const srcAssets = join(publicDir, 'assets');
      let srcEntries = [];
      try { srcEntries = readdirSync(srcAssets); } catch { /* no public/assets */ }
      for (const name of srcEntries) {
        if (keep.has(name)) continue;
        let isRawLink = false;
        try {
          isRawLink = lstatSync(join(srcAssets, name)).isSymbolicLink()
            && /(^|\/)raw\//.test(readlinkSync(join(srcAssets, name)));
        } catch { /* unreadable entry — leave it */ }
        if (isRawLink) { rmSync(join(outDir, 'assets', name), { force: true }); removed++; }
      }
      walk(outDir, (p, name) => {
        if (HEIC_RE.test(name)) { rmSync(p, { force: true }); removed++; }
      });
      const dataDir = join(outDir, 'data');
      let dataEntries = [];
      try { dataEntries = readdirSync(dataDir, { withFileTypes: true }); } catch { /* no data dir */ }
      for (const e of dataEntries) {
        if (e.isFile() && LOOSE_DATA_IMAGE_RE.test(e.name)) { rmSync(join(dataDir, e.name), { force: true }); removed++; }
      }
      this.info?.(`pruned ${SHIP_EXCLUDE_DIRS.join(', ')} and ${removed} source image(s) from ${outDir}`);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    excludeSourceMaterial(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'pwa-icon-192.png', 'pwa-icon-512.png', 'pwa-icon-maskable-512.png'],
      // index.html already links a real, hand-authored manifest — either
      // /manifest.json (gallery) or /admin-manifest.json (/admin), swapped
      // at runtime by App.jsx's useRouteManifest() so each installs with
      // its own start_url. Keep vite-plugin-pwa from generating a second,
      // conflicting manifest.
      manifest: false,
      workbox: {
        // Precache the application shell only. Artwork, theater data,
        // canonical integration records, binary buffers, and source images
        // are corpus data rather than shell assets; precaching them makes
        // first load/install cost grow with the gallery. They remain normal
        // HTTP resources and use the browser cache when actually requested.
        globPatterns: ['**/*.{js,css,html,ico,svg}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ],
  server: {
    port: 3000
  },
  build: {
    target: 'baseline-widely-available'
  }
});
