import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/request';
import * as shoppingApi from '../features/shopping-list/api';
import * as purchaseApi from '../features/purchases/api';
import { hydrateLocalShopping, readLocalShopping } from './localData';
import { enqueueShoppingCommand, readPendingOperations, writeLocalSnapshot, type LocalSnapshot } from './localStore';
import { syncOutbox } from './syncOutbox';

vi.mock('../features/shopping-list/api', () => ({ listPendingItems: vi.fn(), addPendingItem: vi.fn(), removePendingItem: vi.fn() }));
vi.mock('../features/purchases/api', () => ({ getCurrentPurchase: vi.fn(), buyPendingItem: vi.fn(),
  changePurchasePrice: vi.fn(), undoPurchasedItem: vi.fn(), finishCurrentPurchase: vi.fn() }));

const category = { id: 'pantry', name: 'Despensa', sortOrder: 0 };
const milk = { id: 'milk', name: 'Leche', active: true, category };
const eggs = { id: 'eggs', name: 'Huevos', active: true, category };
const emptyPurchase: LocalSnapshot['purchase'] = { purchaseId: null, status: null, startedAt: null,
  items: [], totalPriceCents: 0, pricedItemCount: 0, unpricedItemCount: 0 };
const pendingMilk = { productId: milk.id, name: milk.name, active: true, category, addedAt: '2026-01-01' };

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('lista-domestica');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  vi.clearAllMocks();
  await writeLocalSnapshot({ categories: [category], products: [milk, eggs], pendingItems: [], purchase: emptyPurchase });
  vi.mocked(shoppingApi.listPendingItems).mockResolvedValue([]);
  vi.mocked(purchaseApi.getCurrentPurchase).mockResolvedValue(emptyPurchase);
  vi.mocked(shoppingApi.addPendingItem).mockResolvedValue(pendingMilk);
  vi.mocked(shoppingApi.removePendingItem).mockResolvedValue(undefined);
  vi.mocked(purchaseApi.buyPendingItem).mockResolvedValue(emptyPurchase);
  vi.mocked(purchaseApi.changePurchasePrice).mockResolvedValue(emptyPurchase);
  vi.mocked(purchaseApi.undoPurchasedItem).mockResolvedValue(emptyPurchase);
  vi.mocked(purchaseApi.finishCurrentPurchase).mockResolvedValue({ purchaseId: 'server', status: 'FINISHED', finishedAt: '2026-01-01' });
});

describe('outbox', () => {
  it('does not queue an invalid local action', async () => {
    await expect(enqueueShoppingCommand({ kind: 'buyPending', productId: milk.id })).rejects.toThrow('no está en la lista');
    expect(await readPendingOperations()).toEqual([]);
    expect((await readLocalShopping())?.pendingItems).toEqual([]);
  });

  it('keeps an offline action and reconciles it after a retry', async () => {
    vi.mocked(shoppingApi.addPendingItem).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { operation, shopping } = await enqueueShoppingCommand({ kind: 'addPending', productId: milk.id });
    expect(operation.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(shopping.pendingItems.map((item) => item.productId)).toEqual([milk.id]);
    expect((await syncOutbox()).retryableError).toBe(true);
    expect((await readPendingOperations()).map((item) => item.operationId)).toEqual([operation.operationId]);

    vi.mocked(shoppingApi.listPendingItems).mockResolvedValue([{ ...pendingMilk, addedAt: 'server-time' }]);
    expect((await syncOutbox()).retryableError).toBe(false);
    expect(await readPendingOperations()).toEqual([]);
    expect((await readLocalShopping())?.pendingItems[0].addedAt).toBe('server-time');
  });

  it('does not overwrite queued local changes during hydration', async () => {
    await enqueueShoppingCommand({ kind: 'addPending', productId: milk.id });
    expect((await hydrateLocalShopping()).pendingItems.map((item) => item.productId)).toEqual([milk.id]);
    expect(shoppingApi.listPendingItems).not.toHaveBeenCalled();
    expect(await readPendingOperations()).toHaveLength(1);
  });

  it('retries a lost response with the same operationId without duplicating effects', async () => {
    const delivered: string[] = [];
    const serverPending: typeof pendingMilk[] = [];
    vi.mocked(shoppingApi.addPendingItem).mockImplementation(async (_productId, operationId) => {
      delivered.push(operationId!);
      if (serverPending.length === 0) serverPending.push(pendingMilk);
      if (delivered.length === 1) throw new TypeError('Response lost');
      return serverPending[0];
    });
    vi.mocked(shoppingApi.listPendingItems).mockImplementation(async () => [...serverPending]);
    await enqueueShoppingCommand({ kind: 'addPending', productId: milk.id });
    await syncOutbox();
    expect(await readPendingOperations()).toHaveLength(1);
    await syncOutbox();
    expect(delivered).toHaveLength(2);
    expect(delivered[0]).toBe(delivered[1]);
    expect(serverPending).toHaveLength(1);
    expect(await readPendingOperations()).toEqual([]);
  });

  it('delivers commands in insertion order', async () => {
    const calls: string[] = [];
    vi.mocked(shoppingApi.addPendingItem).mockImplementation(async () => { calls.push('add'); return pendingMilk; });
    vi.mocked(purchaseApi.buyPendingItem).mockImplementation(async () => { calls.push('buy'); return emptyPurchase; });
    vi.mocked(purchaseApi.changePurchasePrice).mockImplementation(async () => { calls.push('price'); return emptyPurchase; });
    vi.mocked(purchaseApi.finishCurrentPurchase).mockImplementation(async () => {
      calls.push('finish'); return { purchaseId: 'server', status: 'FINISHED', finishedAt: '2026-01-01' };
    });
    await enqueueShoppingCommand({ kind: 'addPending', productId: milk.id });
    await enqueueShoppingCommand({ kind: 'buyPending', productId: milk.id });
    await enqueueShoppingCommand({ kind: 'changePrice', productId: milk.id, priceCents: 3150 });
    await enqueueShoppingCommand({ kind: 'finishPurchase' });
    expect((await readPendingOperations()).map((operation) => operation.kind)).toEqual(['addPending', 'buyPending', 'changePrice', 'finishPurchase']);
    await syncOutbox();
    expect(calls).toEqual(['add', 'buy', 'price', 'finish']);
    expect(await readPendingOperations()).toEqual([]);
  });

  it('updates price, undoes and finishes locally without network', async () => {
    await enqueueShoppingCommand({ kind: 'addPending', productId: milk.id });
    await enqueueShoppingCommand({ kind: 'addPending', productId: eggs.id });
    await enqueueShoppingCommand({ kind: 'buyPending', productId: milk.id });
    await enqueueShoppingCommand({ kind: 'changePrice', productId: milk.id, priceCents: 3150 });
    expect((await readLocalShopping())?.purchase).toMatchObject({ totalPriceCents: 3150, pricedItemCount: 1 });
    await enqueueShoppingCommand({ kind: 'undoPurchased', productId: milk.id });
    expect((await readLocalShopping())?.pendingItems.map((item) => item.productId)).toEqual([eggs.id, milk.id]);
    expect((await readLocalShopping())?.purchase).toMatchObject({ totalPriceCents: 0, items: [] });
    await enqueueShoppingCommand({ kind: 'buyPending', productId: milk.id });
    await enqueueShoppingCommand({ kind: 'finishPurchase' });
    expect((await readLocalShopping())?.purchase).toEqual(emptyPurchase);
    expect((await readLocalShopping())?.pendingItems.map((item) => item.productId)).toEqual([eggs.id]);
    expect((await readPendingOperations()).map((operation) => operation.kind)).toEqual([
      'addPending', 'addPending', 'buyPending', 'changePrice', 'undoPurchased', 'buyPending', 'finishPurchase',
    ]);
  });

  it('parks a definitive rejection and continues with the next command', async () => {
    vi.mocked(shoppingApi.addPendingItem).mockImplementation(async (productId) => {
      if (productId === milk.id) throw new ApiRequestError('Producto inactivo.', 409, 'PRODUCT_INACTIVE');
      return { ...pendingMilk, productId: eggs.id, name: eggs.name };
    });
    vi.mocked(shoppingApi.listPendingItems).mockResolvedValue([{ ...pendingMilk, productId: eggs.id, name: eggs.name }]);
    await enqueueShoppingCommand({ kind: 'addPending', productId: milk.id });
    await enqueueShoppingCommand({ kind: 'addPending', productId: eggs.id });
    const outcome = await syncOutbox();
    expect(outcome.rejected).toEqual(['Producto inactivo.']);
    expect(shoppingApi.addPendingItem).toHaveBeenCalledTimes(2);
    expect(await readPendingOperations()).toEqual([]);
    expect((await readLocalShopping())?.pendingItems.map((item) => item.productId)).toEqual([eggs.id]);
  });

  it('keeps the outbox pending on 401 and stops sending later operations', async () => {
    await enqueueShoppingCommand({ kind: 'addPending', productId: milk.id });
    await enqueueShoppingCommand({ kind: 'addPending', productId: eggs.id });
    vi.mocked(shoppingApi.addPendingItem).mockRejectedValueOnce(new ApiRequestError('Vincula este dispositivo.', 401, 'DEVICE_UNAUTHORIZED'));
    const outcome = await syncOutbox();
    expect(outcome.unauthorized).toBe(true);
    expect(outcome.rejected).toEqual([]);
    expect(shoppingApi.addPendingItem).toHaveBeenCalledTimes(1);
    expect((await readPendingOperations()).map((operation) => operation.kind)).toEqual(['addPending', 'addPending']);
    expect((await readLocalShopping())?.pendingItems).toHaveLength(2);
  });

  it('keeps a valid local operation if the server rejects the request origin', async () => {
    await enqueueShoppingCommand({ kind: 'addPending', productId: milk.id });
    vi.mocked(shoppingApi.addPendingItem).mockRejectedValueOnce(new ApiRequestError('Origen no permitido.', 403, 'INVALID_ORIGIN'));
    const outcome = await syncOutbox();
    expect(outcome.retryableError).toBe(true);
    expect(outcome.rejected).toEqual([]);
    expect(await readPendingOperations()).toHaveLength(1);
  });
});
