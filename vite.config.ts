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
      includeAssets: ['cedict.txt', 'favicon.svg', 'icon-192.png', 'icon-512.png'],
      workbox: {
        // Precache everything needed for cold-boot. `txt` covers cedict.txt
        // (~8.5MB) which loadCedict() awaits on every boot — without it
        // cached, opening the installed PWA offline fails the dictionary
        // fetch and the app never reaches the ready state. `wasm` covers
        // sql-wasm.wasm so Anki import also works offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,txt,wasm}'],
        // Default cap is 2 MiB, which silently excludes cedict.txt from
        // the precache. Raise to fit it (plus headroom for growth).
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
