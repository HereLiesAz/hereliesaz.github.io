import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'apple-touch-icon.png'],
      manifest: {
        name: 'HereLiesAz: Volumetric Portfolio',
        short_name: 'HereLiesAz',
        description: 'A spatial deconstruction of art.',
        theme_color: '#050505',
        background_color: '#050505',
        display: 'standalone', // Hides browser UI on mobile
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        // 1. Precache the App Shell (JS, CSS, HTML)
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        
        // 2. Runtime Cache for the "Void" Data (Lazy Load)
        runtimeCaching: [
          {
            // Cache the Grinder output (JSON stroke data)
            urlPattern: ({ url }) => url.pathname.startsWith('/data/'),
            handler: 'CacheFirst', // Once loaded, never ask network again
            options: {
              cacheName: 'volumetric-data-cache',
              expiration: {
                maxEntries: 50, // Keep last 50 paintings
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 Year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Cache the Brush Textures
            urlPattern: ({ url }) => url.pathname.includes('brush_stroke'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'texture-cache',
            }
          }
        ]
      }
    })
  ]
});
