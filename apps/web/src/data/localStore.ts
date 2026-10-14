import type { Category, Product } from '../features/catalog/api';
import type { CurrentPurchase } from '../features/purchases/api';
import type { PendingItem } from '../features/shopping-list/api';
import { applyShoppingCommand, type OutboxOperation, type ShoppingCommand } from './shoppingOperations';

const databaseName = 'lista-domestica';
const databaseVersion = 2;

export type LocalCatalog = { categories: Category[]; products: Product[] };
export type LocalShopping = { pendingItems: PendingItem[]; purchase: CurrentPurchase };
export type LocalSnapshot = LocalCatalog & LocalShopping;

export async function readLocalAuthorization(): Promise<boolean> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction('meta', 'readonly');
    const done = transactionDone(transaction);
    const marker = await requestResult(transaction.objectStore('meta').get('deviceAuthorization') as IDBRequest<{ authorized: boolean } | undefined>);
    await done;
    return marker?.authorized === true;
  } finally {
    database.close();
  }
}

export async function writeLocalAuthorization(authorized: boolean): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction('meta', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('meta').put({ key: 'deviceAuthorization', authorized });
    await done;
  } finally {
    database.close();
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('No se pudo guardar la información local.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      // Migration 0 → 1. Add future migrations with a new databaseVersion.
      if (event.oldVersion < 1) {
        database.createObjectStore('categories', { keyPath: 'id' });
        database.createObjectStore('products', { keyPath: 'id' });
        database.createObjectStore('pendingItems', { keyPath: 'productId' });
        database.createObjectStore('currentPurchase', { keyPath: 'key' });
        database.createObjectStore('meta', { keyPath: 'key' });
        // Reserved for a later sync phase. Its primary key will be a UUID operationId.
        database.createObjectStore('outbox', { keyPath: 'operationId' });
      }
      // Migration 1 → 2. UUID keys stay intact; insertion sequence drives ordered delivery.
      if (event.oldVersion < 2) {
        request.transaction!.objectStore('outbox').createIndex('sequence', 'sequence', { unique: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('La base de datos local está bloqueada por otra pestaña.'));
  });
}

function inSavedOrder<T>(items: T[], ids: string[], key: (item: T) => string): T[] {
  const byId = new Map(items.map((item) => [key(item), item]));
  return ids.flatMap((id) => { const item = byId.get(id); return item ? [item] : []; });
}

export async function readLocalCatalog(): Promise<LocalCatalog | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['categories', 'products', 'meta'], 'readonly');
    const [, [marker, categories, products]] = await Promise.all([transactionDone(transaction), Promise.all([
      requestResult(transaction.objectStore('meta').get('catalog') as IDBRequest<{ categoryIds: string[]; productIds: string[] } | undefined>),
      requestResult(transaction.objectStore('categories').getAll() as IDBRequest<Category[]>),
      requestResult(transaction.objectStore('products').getAll() as IDBRequest<Product[]>),
    ])]);
    if (!marker) return null;
    return { categories: inSavedOrder(categories, marker.categoryIds, (item) => item.id),
      products: inSavedOrder(products, marker.productIds, (item) => item.id) };
  } finally {
    database.close();
  }
}

export async function readLocalShopping(): Promise<LocalShopping | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['pendingItems', 'currentPurchase', 'meta'], 'readonly');
    const [, [marker, pendingItems, savedPurchase]] = await Promise.all([transactionDone(transaction), Promise.all([
      requestResult(transaction.objectStore('meta').get('shopping') as IDBRequest<{ pendingIds: string[] } | undefined>),
      requestResult(transaction.objectStore('pendingItems').getAll() as IDBRequest<PendingItem[]>),
      requestResult(transaction.objectStore('currentPurchase').get('current') as IDBRequest<{ key: string; value: CurrentPurchase } | undefined>),
    ])]);
    if (!marker || !savedPurchase) return null;
    return { pendingItems: inSavedOrder(pendingItems, marker.pendingIds, (item) => item.productId),
      purchase: savedPurchase.value };
  } finally {
    database.close();
  }
}

export async function readLocalSnapshot(): Promise<LocalSnapshot | null> {
  const [catalog, shopping] = await Promise.all([readLocalCatalog(), readLocalShopping()]);
  return catalog && shopping ? { ...catalog, ...shopping } : null;
}

export async function writeLocalCatalog(catalog: LocalCatalog): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['categories', 'products', 'meta'], 'readwrite');
    const done = transactionDone(transaction);
    for (const storeName of ['categories', 'products'] as const) {
      const store = transaction.objectStore(storeName);
      store.clear();
      for (const item of catalog[storeName]) store.put(item);
    }
    transaction.objectStore('meta').put({ key: 'catalog', categoryIds: catalog.categories.map((item) => item.id),
      productIds: catalog.products.map((item) => item.id) });
    await done;
  } finally {
    database.close();
  }
}

export async function writeLocalShopping(shopping: LocalShopping): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['pendingItems', 'currentPurchase', 'meta'], 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore('pendingItems');
    store.clear();
    for (const item of shopping.pendingItems) store.put(item);
    transaction.objectStore('currentPurchase').put({ key: 'current', value: shopping.purchase });
    transaction.objectStore('meta').put({ key: 'shopping', pendingIds: shopping.pendingItems.map((item) => item.productId) });
    await done;
  } finally {
    database.close();
  }
}

export async function writeLocalSnapshot(snapshot: LocalSnapshot): Promise<void> {
  await Promise.all([writeLocalCatalog(snapshot), writeLocalShopping(snapshot)]);
}

export async function enqueueShoppingCommand(command: ShoppingCommand): Promise<{ shopping: LocalShopping; operation: OutboxOperation }> {
  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['products', 'pendingItems', 'currentPurchase', 'meta', 'outbox'], 'readwrite');
    const done = transactionDone(transaction);
    const [catalogMarker, shoppingMarker, products, pendingItems, savedPurchase, sequenceMarker] = await Promise.all([
      requestResult(transaction.objectStore('meta').get('catalog') as IDBRequest<{ productIds: string[] } | undefined>),
      requestResult(transaction.objectStore('meta').get('shopping') as IDBRequest<{ pendingIds: string[] } | undefined>),
      requestResult(transaction.objectStore('products').getAll() as IDBRequest<Product[]>),
      requestResult(transaction.objectStore('pendingItems').getAll() as IDBRequest<PendingItem[]>),
      requestResult(transaction.objectStore('currentPurchase').get('current') as IDBRequest<{ value: CurrentPurchase } | undefined>),
      requestResult(transaction.objectStore('meta').get('nextSequence') as IDBRequest<{ value: number } | undefined>),
    ]);
    if (!shoppingMarker || !savedPurchase) throw new Error('No hay una lista local disponible.');
    const shopping: LocalShopping = {
      pendingItems: inSavedOrder(pendingItems, shoppingMarker.pendingIds, (item) => item.productId),
      purchase: savedPurchase.value,
    };
    const catalog: LocalCatalog = { categories: [], products: catalogMarker
      ? inSavedOrder(products, catalogMarker.productIds, (item) => item.id) : [] };
    const sequence = sequenceMarker?.value ?? 1;
    const operation: OutboxOperation = { ...command, operationId, sequence, status: 'pending' };
    const updated = applyShoppingCommand(shopping, catalog, command, now, operationId);
    const pendingStore = transaction.objectStore('pendingItems');
    pendingStore.clear();
    for (const item of updated.pendingItems) pendingStore.put(item);
    transaction.objectStore('currentPurchase').put({ key: 'current', value: updated.purchase });
    transaction.objectStore('meta').put({ key: 'shopping', pendingIds: updated.pendingItems.map((item) => item.productId) });
    transaction.objectStore('meta').put({ key: 'nextSequence', value: sequence + 1 });
    transaction.objectStore('outbox').put(operation);
    await done;
    return { shopping: updated, operation };
  } finally {
    database.close();
  }
}

export async function readPendingOperations(): Promise<OutboxOperation[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction('outbox', 'readonly');
    const [, operations] = await Promise.all([transactionDone(transaction),
      requestResult(transaction.objectStore('outbox').index('sequence').getAll() as IDBRequest<OutboxOperation[]>)]);
    return operations.filter((operation) => operation.status === 'pending');
  } finally {
    database.close();
  }
}

export async function confirmOperation(operationId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction('outbox', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('outbox').delete(operationId);
    await done;
  } finally {
    database.close();
  }
}

export async function rejectOperation(operation: OutboxOperation, error: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction('outbox', 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore('outbox').put({ ...operation, status: 'rejected', error });
    await done;
  } finally {
    database.close();
  }
}

export async function replaceShoppingWhenQueueEmpty(shopping: LocalShopping): Promise<boolean> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(['pendingItems', 'currentPurchase', 'meta', 'outbox'], 'readwrite');
    const done = transactionDone(transaction);
    const operations = await requestResult(transaction.objectStore('outbox').getAll() as IDBRequest<OutboxOperation[]>);
    if (operations.some((operation) => operation.status === 'pending')) {
      await done;
      return false;
    }
    const store = transaction.objectStore('pendingItems');
    store.clear();
    for (const item of shopping.pendingItems) store.put(item);
    transaction.objectStore('currentPurchase').put({ key: 'current', value: shopping.purchase });
    transaction.objectStore('meta').put({ key: 'shopping', pendingIds: shopping.pendingItems.map((item) => item.productId) });
    await done;
    return true;
  } finally {
    database.close();
  }
}
