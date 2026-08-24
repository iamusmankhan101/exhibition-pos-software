import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate': a POS must never reload itself mid-sale.
      // The app asks, and the salesperson takes the update when the queue is
      // empty and nobody is standing at the counter.
      registerType: 'prompt',
      // `injectManifest`, not the default generator: workbox writes its template
      // with single-quoted absolute paths, and this project lives under a
      // directory containing an apostrophe, which breaks the generated file.
      // Writing the worker ourselves sidesteps it and gives explicit control
      // over what a till is allowed to cache.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      manifest: {
        name: 'Tareez POS',
        short_name: 'Tareez POS',
        description: 'Point of sale and inventory for exhibitions, pop-ups and stalls.',
        theme_color: '#021b8d',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // jsPDF and the scanner are large lazy chunks; without this they are
        // skipped and the first offline PDF or scan fails.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: {
        // Off in dev: a service worker caching a hot-reloading app is a
        // debugging trap, not a feature.
        enabled: false,
      },
    }),
  ],
  build: {
    /*
     * Force the brand logo to be inlined as a data URL.
     *
     * `settings.business.logo` is a data URL everywhere it is used: jsPDF draws
     * it into the invoice, an exported backup carries it, and it syncs to
     * Supabase inside the settings blob. Emitted as a file it would be a
     * relative path instead — the invoice logo would silently vanish, and a
     * backup restored on another build would point at a hash that no longer
     * exists.
     *
     * A function rather than a raised `assetsInlineLimit` number, so this is the
     * only asset the rule touches; everything else keeps Vite's default. (Vite 5
     * has no `?inline` query — that landed in 6 — so the decision belongs here.)
     */
    assetsInlineLimit: (filePath) => (filePath.includes('tareez-logo') ? true : undefined),
  },

  server: {
    host: true,
    port: 5173,
  },
  test: {
    setupFiles: ['./vitest.setup.js'],
  },
})
