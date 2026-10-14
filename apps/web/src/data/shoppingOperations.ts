import type { LocalCatalog, LocalShopping } from './localStore';

export type ShoppingCommand =
  | { kind: 'addPending'; productId: string }
  | { kind: 'removePending'; productId: string }
  | { kind: 'buyPending'; productId: string }
  | { kind: 'changePrice'; productId: string; priceCents: number | null }
  | { kind: 'undoPurchased'; productId: string }
  | { kind: 'finishPurchase' };

export type OutboxOperation = ShoppingCommand & {
  operationId: string;
  sequence: number;
  status: 'pending' | 'rejected';
  error?: string;
};

const emptyPurchase: LocalShopping['purchase'] = {
  purchaseId: null, status: null, startedAt: null, items: [], totalPriceCents: 0,
  pricedItemCount: 0, unpricedItemCount: 0,
};

function withPurchaseItems(shopping: LocalShopping, items: LocalShopping['purchase']['items']): LocalShopping {
  const total = items.reduce((sum, item) => sum + BigInt(item.priceCents ?? 0), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('El total excede el rango entero seguro.');
  const pricedItemCount = items.filter((item) => item.priceCents !== null).length;
  return { ...shopping, purchase: { ...shopping.purchase, items, totalPriceCents: Number(total),
    pricedItemCount, unpricedItemCount: items.length - pricedItemCount } };
}

export function applyShoppingCommand(
  shopping: LocalShopping,
  catalog: LocalCatalog,
  command: ShoppingCommand,
  now: string,
  operationId: string,
): LocalShopping {
  if (command.kind === 'addPending') {
    const product = catalog.products.find((item) => item.id === command.productId && item.active);
    if (!product) throw new Error('El producto no está activo en el catálogo local.');
    if (shopping.purchase.items.some((item) => item.productId === command.productId))
      throw new Error('El producto ya está comprado en esta compra.');
    if (shopping.pendingItems.some((item) => item.productId === command.productId)) return shopping;
    return { ...shopping, pendingItems: [...shopping.pendingItems, { productId: product.id,
      name: product.name, active: product.active, addedAt: now, category: product.category }] };
  }
  if (command.kind === 'removePending') {
    return { ...shopping, pendingItems: shopping.pendingItems.filter((item) => item.productId !== command.productId) };
  }
  if (command.kind === 'buyPending') {
    const pending = shopping.pendingItems.find((item) => item.productId === command.productId);
    if (!pending) throw new Error('El producto no está en la lista pendiente.');
    if (shopping.purchase.items.some((item) => item.productId === command.productId))
      throw new Error('El producto ya está comprado en esta compra.');
    const next = withPurchaseItems({ ...shopping, pendingItems: shopping.pendingItems.filter((item) => item.productId !== command.productId),
      purchase: { ...shopping.purchase, purchaseId: shopping.purchase.purchaseId ?? `local:${operationId}`,
        status: 'ACTIVE', startedAt: shopping.purchase.startedAt ?? now } },
    [...shopping.purchase.items, { productId: pending.productId, productNameSnapshot: pending.name,
      priceCents: null, purchasedAt: now, category: pending.category }]);
    return next;
  }
  if (command.kind === 'changePrice') {
    if (command.priceCents !== null && (!Number.isInteger(command.priceCents) || command.priceCents < 0 || command.priceCents > 2_147_483_647))
      throw new Error('Escribe un precio válido en pesos y centavos.');
    if (!shopping.purchase.items.some((item) => item.productId === command.productId))
      throw new Error('El producto no está comprado en la compra actual.');
    return withPurchaseItems(shopping, shopping.purchase.items.map((item) => item.productId === command.productId
      ? { ...item, priceCents: command.priceCents } : item));
  }
  if (command.kind === 'undoPurchased') {
    const purchased = shopping.purchase.items.find((item) => item.productId === command.productId);
    if (!purchased) throw new Error('El producto no está comprado en la compra actual.');
    const product = catalog.products.find((item) => item.id === command.productId);
    const next = withPurchaseItems(shopping, shopping.purchase.items.filter((item) => item.productId !== command.productId));
    return { ...next, pendingItems: shopping.pendingItems.some((item) => item.productId === command.productId)
      ? shopping.pendingItems : [...shopping.pendingItems, { productId: purchased.productId,
        name: product?.name ?? purchased.productNameSnapshot, active: product?.active ?? false,
        addedAt: now, category: product?.category ?? purchased.category }] };
  }
  if (!shopping.purchase.purchaseId) throw new Error('No hay una compra activa.');
  return { ...shopping, purchase: emptyPurchase };
}
