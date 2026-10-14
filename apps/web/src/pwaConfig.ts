import type { VitePWAOptions } from 'vite-plugin-pwa';

export const pwaOptions = {
  registerType: 'autoUpdate',
  manifest: {
    name: 'Hogar natural',
    short_name: 'Hogar',
    description: 'Lista doméstica de compras',
    lang: 'es',
    start_url: '/add',
    scope: '/',
    display: 'standalone',
    theme_color: '#3f684e',
    background_color: '#f6f0e2',
  },
  workbox: {
    globPatterns: ['**/*.{html,js,css,png,svg,woff2}'],
    navigateFallback: '/index.html',
    navigateFallbackAllowlist: [/^\/$/, /^\/add\/?$/, /^\/list\/?$/],
    runtimeCaching: [],
    cleanupOutdatedCaches: true,
  },
} satisfies Partial<VitePWAOptions>;
