import { registerSW } from 'virtual:pwa-register';

const updateIntervalMs = 60 * 60 * 1000;

export function registerPwaUpdates(reload = () => window.location.reload()) {
  if (!('serviceWorker' in navigator)) return () => {};

  const originalController = navigator.serviceWorker.controller;
  let reloading = false;
  let checking = false;
  let registration: ServiceWorkerRegistration | undefined;
  let swUrl = '';

  const reloadWhenSafe = () => {
    if (reloading || !originalController || navigator.serviceWorker.controller === originalController
      || document.visibilityState !== 'visible' || document.querySelector('form')
      || document.querySelector('[data-local-write-pending]')) return;
    reloading = true;
    reload();
  };

  const checkForUpdate = async () => {
    if (checking || !registration || registration.installing || !navigator.onLine) return;
    checking = true;
    try {
      const response = await fetch(swUrl, { cache: 'no-store' });
      if (response.status === 200 && response.headers.get('content-type')?.includes('javascript')) {
        await registration.update();
      }
    } catch {
      // Keep the current offline shell; the next online/focus check can retry.
    } finally {
      checking = false;
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      reloadWhenSafe();
      void checkForUpdate();
    }
  };
  const onFocus = () => { reloadWhenSafe(); void checkForUpdate(); };
  const onOnline = () => { void checkForUpdate(); };
  const observer = new MutationObserver(reloadWhenSafe);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-local-write-pending'],
  });
  navigator.serviceWorker.addEventListener('controllerchange', reloadWhenSafe);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  const interval = window.setInterval(() => void checkForUpdate(), updateIntervalMs);

  registerSW({
    immediate: true,
    onNeedReload: reloadWhenSafe,
    onRegisteredSW(url, currentRegistration) {
      swUrl = url;
      registration = currentRegistration;
      void checkForUpdate();
    },
  });

  return () => {
    window.clearInterval(interval);
    observer.disconnect();
    navigator.serviceWorker.removeEventListener('controllerchange', reloadWhenSafe);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
  };
}
