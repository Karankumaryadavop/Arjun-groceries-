import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: [],
        manifest: {
          id: '/',
          name: 'Arjun Groceries',
          short_name: 'Arjun Groceries',
          description:
            'Arjun Groceries — Shop Smart • Save More. Offline-first Android store management with local IndexedDB ledger, inventory, expenses, cashbook, and encrypted backups.',
          theme_color: '#065f46',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          cacheId: 'arjun-groceries-app-shell-v1',
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          dontCacheBustURLsMatching: /^assets\/[^/]+-[a-zA-Z0-9_-]{8}\.(js|css|mjs)$/,
          globPatterns: ['**/*.{js,mjs,css,html,ico,png,jpg,svg,woff,woff2}'],
          globIgnores: [
            'assets/aistudio/IMG_20261117_*',
            'assets/aistudio/Screenshot_20261116_*',
            'assets/aistudio/Screenshot_2026_1117_164602_*',
            'assets/aistudio/Screenshot_20261118_*',
          ],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/__\//, /^\/offline\.html$/],
          runtimeCaching: [
            {
              urlPattern: /^\/api\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern:
                /^https:\/\/(.*\.)?(googleapis\.com|firebaseio\.com|firebasestorage\.app|firebaseapp\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com)\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/graph\.facebook\.com\/.*/i,
              handler: 'NetworkOnly',
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
