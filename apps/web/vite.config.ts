import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Fondal Fit', short_name: 'Fondal', description: 'Training tracking for athletes and coaches',
        theme_color: '#0b0d10', background_color: '#0b0d10', display: 'standalone', start_url: '/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { navigateFallbackDenylist: [/^\/api/] },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:3001' } },
  test: { environment: 'node' },
});
