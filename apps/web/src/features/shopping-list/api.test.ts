import { afterEach, describe, expect, it, vi } from 'vitest';
import { removePendingItem } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('cliente de pendientes', () => {
  it('envía DELETE sin Content-Type cuando no hay cuerpo', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => null });
    vi.stubGlobal('fetch', fetchMock);
    await removePendingItem('product-id');
    expect(fetchMock).toHaveBeenCalledWith('/api/shopping-list/items/product-id', {
      method: 'DELETE', headers: {}, credentials: 'same-origin',
    });
  });
});
