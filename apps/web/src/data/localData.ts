import { listCategories, listProducts } from '../features/catalog/api';
import { getCurrentPurchase } from '../features/purchases/api';
import { listPendingItems } from '../features/shopping-list/api';
import { readLocalCatalog, readLocalShopping, readPendingOperations, replaceShoppingWhenQueueEmpty, writeLocalCatalog,
  type LocalCatalog, type LocalShopping } from './localStore';

export { readLocalCatalog, readLocalShopping, readLocalSnapshot } from './localStore';
export type { LocalCatalog, LocalShopping, LocalSnapshot } from './localStore';

// The server stays authoritative. UI consumers read only committed IndexedDB data.
let catalogHydration: Promise<unknown> = Promise.resolve();
let shoppingHydration: Promise<unknown> = Promise.resolve();

export function hydrateLocalCatalog(): Promise<LocalCatalog> {
  const hydration = catalogHydration.catch(() => undefined).then(async () => {
    const [categories, products] = await Promise.all([listCategories(), listProducts()]);
    await writeLocalCatalog({ categories, products });
    const catalog = await readLocalCatalog();
    if (!catalog) throw new Error('No se pudo leer el catálogo local.');
    return catalog;
  });
  catalogHydration = hydration;
  return hydration;
}

export function hydrateLocalShopping(): Promise<LocalShopping> {
  const hydration = shoppingHydration.catch(() => undefined).then(async () => {
    if ((await readPendingOperations()).length > 0) {
      const cached = await readLocalShopping();
      if (cached) return cached;
    }
    const [pendingItems, purchase] = await Promise.all([listPendingItems(), getCurrentPurchase()]);
    await replaceShoppingWhenQueueEmpty({ pendingItems, purchase });
    const shopping = await readLocalShopping();
    if (!shopping) throw new Error('No se pudo leer la lista local.');
    return shopping;
  });
  shoppingHydration = hydration;
  return hydration;
}
