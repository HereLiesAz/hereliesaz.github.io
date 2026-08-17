import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'pwa-icon-512.png'],
      // index.html already links the real, hand-authored manifest at
      // /manifest.json (name/colors matching the site's actual branding and
      // its own <meta name="theme-color">). vite-plugin-pwa's `manifest`
      // option would generate a SECOND, independent /manifest.webmanifest
      // and inject a second <link rel="manifest"> unconditionally — it does
      // not check for or merge with an existing one — leaving two
      // conflicting manifests in the page with no defined rule for which a
      // given browser honours. `manifest: false` disables that generation
      // entirely so public/manifest.json stays the single source of truth.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,bin,webp}'],
        // data/*.json (973 files) and data/baked/**/*.json (988 files) are
        // raw per-photo pipeline intermediates the Python bake pipeline
        // reads and writes — the frontend only ever fetches
        // /data/theater/**. Left unfiltered, the `json` glob above swept
        // them into the precache too: ~1.1GB (93% of the whole precache) of
        // data the app never requests, force-downloaded to every visitor on
        // first load. graph.json (the legacy no-theater-bake fallback
        // Scene.jsx fetches) and data/theater/**/*.json are NOT under
        // data/baked/ and don't match the bare `data/*.json` pattern (which
        // only matches direct children of data/, not its subdirectories),
        // so they still precache normally.
        globIgnores: ['data/*.json', 'data/baked/**'],
        // Increase maximum file size for caching large shard data
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
  ],
  server: {
    port: 3000
  },
  build: {
    target: 'esnext'
  }
});
