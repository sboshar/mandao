import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the SW ourselves in src/lib/pwaUpdate.ts so we can
      // re-check on visibilitychange and auto-reload on controllerchange.
      injectRegister: false,
      // Serve the manifest + service worker in `vite dev` so install
      // prompt + offline behavior can be exercised locally without
      // running a production build.
      devOptions: { enabled: true },
      workbox: {
        // `txt` is here so cedict.txt — awaited on every boot — is
        // precached; without it, offline cold-start hangs on the fetch.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,txt}'],
        // Workbox's 2 MiB default would silently drop cedict.txt.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\//,
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'Mandao',
        short_name: 'Mandao',
        description: 'Mandarin sentence-based SRS study app',
        // Light-theme `--bg-base`. Captured at install time as the
        // initial title-bar color; the live page overrides it via
        // <meta name="theme-color">, updated by themeStore on toggle.
        theme_color: '#f5f1eb',
        background_color: '#f5f1eb',
        display: 'standalone',
        start_url: '/',
        icons: [
          // Chrome's installability heuristic requires 192x192 and 512x512
          // PNGs; the SVG entry stays for high-DPI Safari and as a fallback.
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
})
