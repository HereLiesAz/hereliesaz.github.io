import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'pwa-icon-512.png'],
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
    target: 'esnext'
  }
});
