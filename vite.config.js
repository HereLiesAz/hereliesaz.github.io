import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg', 'pwa-icon-512.png'],
      manifest: {
        name: 'Here Lies Az',
        short_name: 'HereLiesAz',
        description: 'Immersive Shard-Based Art Portfolio',
        theme_color: '#050505',
        background_color: '#050505',
        display: 'standalone',
        icons: [
          {
            src: 'pwa-icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,bin,webp}'],
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
