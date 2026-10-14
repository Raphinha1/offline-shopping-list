import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateLocalCatalog, hydrateLocalShopping, readLocalCatalog, readLocalShopping, readLocalSnapshot } from './localData';
import { writeLocalSnapshot, type LocalSnapshot } from './localStore';
import * as catalogApi from '../features/catalog/api';
import * as shoppingApi from '../features/shopping-list/api';
import * as purchaseApi from '../features/purchases/api';

vi.mock('../features/catalog/api', () => ({ listCategories: vi.fn(), listProducts: vi.fn() }));
vi.mock('../features/shopping-list/api', () => ({ listPendingItems: vi.fn() }));
vi.mock('../features/purchases/api', () => ({ getCurrentPurchase: vi.fn() }));

const category = { id: 'pantry', name: 'Despensa', sortOrder: 0 };
const product = { id: 'rice', name: 'Arroz', active: true, category };
const snapshot: LocalSnapshot = {
  categories: [category], products: [product],
  pendingItems: [{ productId: 'rice', name: 'Arroz', active: true, category, addedAt: '2026-01-01' }],
  purchase: { purchaseId: 'purchase', status: 'ACTIVE', startedAt: '2026-01-01', items: [],
    totalPriceCents: 0, pricedItemCount: 0, unpricedItemCount: 0 },
};

beforeEach(async () => {
  vi.clearAllMocks();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('lista-domestica');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe('local data', () => {
  it('upgrades version 1 without losing the saved shopping snapshot', async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('lista-domestica', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('categories', { keyPath: 'id' });
        db.createObjectStore('products', { keyPath: 'id' });
        db.createObjectStore('pendingItems', { keyPath: 'productId' });
        db.createObjectStore('currentPurchase', { keyPath: 'key' });
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('outbox', { keyPath: 'operationId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['categories', 'products', 'pendingItems', 'currentPurchase', 'meta'], 'readwrite');
      transaction.objectStore('categories').put(category);
      transaction.objectStore('products').put(product);
      transaction.objectStore('pendingItems').put(snapshot.pendingItems[0]);
      transaction.objectStore('currentPurchase').put({ key: 'current', value: snapshot.purchase });
      transaction.objectStore('meta').put({ key: 'catalog', categoryIds: [category.id], productIds: [product.id] });
      transaction.objectStore('meta').put({ key: 'shopping', pendingIds: [product.id] });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    expect(await readLocalSnapshot()).toEqual(snapshot);
  });

  it('creates the versioned stores and persists an ordered snapshot across database connections', async () => {
    expect(await readLocalSnapshot()).toBeNull();
    const secondProduct = { ...product, id: 'milk', name: 'Leche' };
    const ordered = { ...snapshot, products: [secondProduct, product] };
    await writeLocalSnapshot(ordered);
    expect(await readLocalSnapshot()).toEqual(ordered);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('lista-domestica');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(database.version).toBe(2);
    expect(Array.from(database.objectStoreNames)).toEqual(['categories', 'currentPurchase', 'meta', 'outbox', 'pendingItems', 'products']);
    expect(Array.from(database.transaction('outbox').objectStore('outbox').indexNames)).toEqual(['sequence']);
    database.close();
  });

  it('hydrates all four collections from the API and keeps prior data on a failed refresh', async () => {
    vi.mocked(catalogApi.listCategories).mockResolvedValue(snapshot.categories);
    vi.mocked(catalogApi.listProducts).mockResolvedValue(snapshot.products);
    vi.mocked(shoppingApi.listPendingItems).mockResolvedValue(snapshot.pendingItems);
    vi.mocked(purchaseApi.getCurrentPurchase).mockResolvedValue(snapshot.purchase);

    expect(await Promise.all([hydrateLocalCatalog(), hydrateLocalShopping()])).toEqual([
      { categories: snapshot.categories, products: snapshot.products },
      { pendingItems: snapshot.pendingItems, purchase: snapshot.purchase },
    ]);
    expect(await readLocalSnapshot()).toEqual(snapshot);
    expect(catalogApi.listProducts).toHaveBeenCalledWith();

    vi.mocked(catalogApi.listProducts).mockRejectedValueOnce(new Error('Sin conexión.'));
    await expect(hydrateLocalCatalog()).rejects.toThrow('Sin conexión.');
    expect(await readLocalSnapshot()).toEqual(snapshot);
  });

  it('keeps shopping available when a first catalog load fails', async () => {
    vi.mocked(catalogApi.listCategories).mockRejectedValue(new Error('Catálogo no disponible.'));
    vi.mocked(catalogApi.listProducts).mockResolvedValue(snapshot.products);
    vi.mocked(shoppingApi.listPendingItems).mockResolvedValue(snapshot.pendingItems);
    vi.mocked(purchaseApi.getCurrentPurchase).mockResolvedValue(snapshot.purchase);

    const [catalog, shopping] = await Promise.allSettled([hydrateLocalCatalog(), hydrateLocalShopping()]);
    expect(catalog.status).toBe('rejected');
    expect(shopping.status).toBe('fulfilled');
    expect(await readLocalCatalog()).toBeNull();
    expect(await readLocalShopping()).toEqual({ pendingItems: snapshot.pendingItems, purchase: snapshot.purchase });
  });
});
