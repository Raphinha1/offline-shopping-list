import { describe, expect, it } from 'vitest';
import { pwaOptions } from './pwaConfig';

describe('PWA configuration', () => {
  it('retains the PWA manifest metadata without references to excluded icons', () => {
    expect(pwaOptions.manifest).toMatchObject({
      name: 'Hogar natural',
      short_name: 'Hogar',
      start_url: '/add',
      scope: '/',
      display: 'standalone',
      theme_color: '#3f684e',
      background_color: '#f6f0e2',
    });
    expect(pwaOptions.manifest).not.toHaveProperty('icons');
  });

  it('precaches static shell assets and provides only app routes offline', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate');
    expect(pwaOptions.workbox?.globPatterns).toEqual(['**/*.{html,js,css,png,svg,woff2}']);
    expect(pwaOptions.workbox?.navigateFallback).toBe('/index.html');
    const allowlist = pwaOptions.workbox?.navigateFallbackAllowlist ?? [];
    for (const route of ['/', '/add', '/list']) {
      expect(allowlist.some((pattern) => pattern.test(route))).toBe(true);
    }
    expect(allowlist.some((pattern) => pattern.test('/api/shopping-list'))).toBe(false);
    expect(pwaOptions.workbox?.runtimeCaching).toEqual([]);
  });
});
