import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { registerSW } from 'virtual:pwa-register';
import { registerPwaUpdates } from './pwaUpdates';

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }));

describe('PWA updates', () => {
  let callbacks: NonNullable<Parameters<typeof registerSW>[0]>;
  let serviceWorker: EventTarget & { controller: ServiceWorker | null };
  let stop: () => void;
  let online: boolean;

  beforeEach(() => {
    vi.resetAllMocks();
    callbacks = {};
    vi.mocked(registerSW).mockImplementation((options) => {
      callbacks = options ?? {};
      return async () => {};
    });
    serviceWorker = Object.assign(new EventTarget(), { controller: {} as ServiceWorker });
    online = true;
    vi.stubGlobal('navigator', { get onLine() { return online; }, serviceWorker });
    document.body.replaceChildren();
  });

  afterEach(() => {
    stop?.();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('checks the current worker on launch and after reconnecting', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const fetchWorker = vi.fn().mockResolvedValue({
      status: 200, headers: new Headers({ 'content-type': 'text/javascript' }),
    });
    vi.stubGlobal('fetch', fetchWorker);
    stop = registerPwaUpdates(vi.fn());
    callbacks.onRegisteredSW?.('/sw.js', { installing: null, update } as unknown as ServiceWorkerRegistration);
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(fetchWorker).toHaveBeenCalledWith('/sw.js', { cache: 'no-store' });

    online = false;
    window.dispatchEvent(new Event('online'));
    expect(update).toHaveBeenCalledOnce();

    online = true;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  });

  it('reloads once after the new worker controls the page and an open form closes', async () => {
    const reload = vi.fn();
    stop = registerPwaUpdates(reload);
    const form = document.createElement('form');
    document.body.append(form);
    callbacks.onNeedReload?.();
    expect(reload).not.toHaveBeenCalled();

    serviceWorker.controller = {} as ServiceWorker;
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();

    form.remove();
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('waits for a pending local write before reloading', async () => {
    const reload = vi.fn();
    stop = registerPwaUpdates(reload);
    const main = document.createElement('main');
    main.setAttribute('data-local-write-pending', '');
    document.body.append(main);

    serviceWorker.controller = {} as ServiceWorker;
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();

    main.removeAttribute('data-local-write-pending');
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });
});
