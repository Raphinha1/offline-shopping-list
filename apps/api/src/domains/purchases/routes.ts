import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { lockCurrentPurchase, type PurchaseTransaction } from '../../db/currentPurchaseLock.js';
import { categories, products } from '../catalog/schema.js';
import { runMutation, sendMutationResult } from '../operations/runMutation.js';
import { shoppingListItems } from '../shopping-list/schema.js';
import { purchaseItems, purchases } from './schema.js';

const priceCents = z.number().int().min(0).max(2_147_483_647);
const addItemBody = z.strictObject({ productId: z.uuid(), priceCents: priceCents.nullable().optional() });
const changePriceBody = z.strictObject({ priceCents: priceCents.nullable() });
const productIdParams = z.object({ productId: z.uuid() });
const invalidInput = { error: { code: 'INVALID_INPUT', message: 'Revisa los datos enviados.' } };
const noActivePurchase = { error: { code: 'NO_ACTIVE_PURCHASE', message: 'No hay una compra activa.' } };
const itemNotFound = { error: { code: 'PURCHASE_ITEM_NOT_FOUND', message: 'El producto no está comprado en la compra actual.' } };

async function currentPurchaseInTransaction(tx: PurchaseTransaction) {
    const [purchase] = await tx.select({ id: purchases.id, startedAt: purchases.startedAt })
      .from(purchases).where(eq(purchases.status, 'ACTIVE'));
    if (!purchase) return {
      purchaseId: null, status: null, startedAt: null, items: [],
      totalPriceCents: 0, pricedItemCount: 0, unpricedItemCount: 0,
    };

    const items = await tx.select({
      productId: purchaseItems.productId,
      productNameSnapshot: purchaseItems.productNameSnapshot,
      priceCents: purchaseItems.priceCents,
      purchasedAt: purchaseItems.purchasedAt,
      category: { id: categories.id, name: categories.name, sortOrder: categories.sortOrder },
    }).from(purchaseItems)
      .innerJoin(products, eq(purchaseItems.productId, products.id))
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(purchaseItems.purchaseId, purchase.id))
      .orderBy(asc(purchaseItems.purchasedAt), asc(purchaseItems.id));

    const total = items.reduce((sum, item) => sum + BigInt(item.priceCents ?? 0), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('El total excede el rango entero seguro.');
    const pricedItemCount = items.filter((item) => item.priceCents !== null).length;
    return {
      purchaseId: purchase.id,
      status: 'ACTIVE' as const,
      startedAt: purchase.startedAt,
      items,
      totalPriceCents: Number(total),
      pricedItemCount,
      unpricedItemCount: items.length - pricedItemCount,
    };
}

async function currentPurchase(db: Database) {
  return db.transaction(async (tx) => {
    await lockCurrentPurchase(tx);
    return currentPurchaseInTransaction(tx);
  });
}

export function registerPurchaseRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/purchases/current', async () => currentPurchase(db));

  app.post('/api/purchases/current/items', async (request, reply) => {
    const parsed = addItemBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidInput);
    const { productId } = parsed.data;

    const result = await runMutation(db, request, JSON.stringify(['buyPending', productId, parsed.data.priceCents ?? null]), async (tx) => {
      const [product] = await tx.select({ id: products.id, name: products.name }).from(products)
        .where(eq(products.id, productId)).for('update');
      if (!product) return { status: 404, body: { error: { code: 'PRODUCT_NOT_FOUND', message: 'El producto no existe.' } } };

      const [active] = await tx.select({ id: purchases.id }).from(purchases)
        .where(eq(purchases.status, 'ACTIVE'));
      if (active) {
        const [existing] = await tx.select({ id: purchaseItems.id }).from(purchaseItems)
          .where(and(eq(purchaseItems.purchaseId, active.id), eq(purchaseItems.productId, productId)));
        if (existing) return { status: 409, body: { error: { code: 'ITEM_ALREADY_PURCHASED', message: 'El producto ya está comprado en esta compra.' } } };
      }

      const [pending] = await tx.select({ id: shoppingListItems.id }).from(shoppingListItems)
        .where(eq(shoppingListItems.productId, productId));
      if (!pending) return { status: 409, body: { error: { code: 'ITEM_NOT_PENDING', message: 'El producto no está en la lista pendiente.' } } };

      let purchaseId = active?.id;
      if (!purchaseId) {
        const [created] = await tx.insert(purchases).values({}).returning({ id: purchases.id });
        purchaseId = created.id;
      }
      await tx.insert(purchaseItems).values({
        purchaseId,
        productId,
        productNameSnapshot: product.name,
        priceCents: parsed.data.priceCents ?? null,
      });
      const [removed] = await tx.delete(shoppingListItems)
        .where(eq(shoppingListItems.productId, productId)).returning({ id: shoppingListItems.id });
      if (!removed) throw new Error('No se pudo mover el producto pendiente a la compra.');
      return { status: 201, body: await currentPurchaseInTransaction(tx) };
    });
    return sendMutationResult(reply, result);
  });

  app.patch('/api/purchases/current/items/:productId', async (request, reply) => {
    const params = productIdParams.safeParse(request.params);
    const body = changePriceBody.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send(invalidInput);

    const result = await runMutation(db, request, JSON.stringify(['changePrice', params.data.productId, body.data.priceCents]), async (tx) => {
      const [active] = await tx.select({ id: purchases.id }).from(purchases)
        .where(eq(purchases.status, 'ACTIVE'));
      if (!active) return { status: 404, body: noActivePurchase };
      const [updated] = await tx.update(purchaseItems).set({ priceCents: body.data.priceCents })
        .where(and(eq(purchaseItems.purchaseId, active.id), eq(purchaseItems.productId, params.data.productId)))
        .returning({ id: purchaseItems.id });
      if (!updated) return { status: 404, body: itemNotFound };
      return { status: 200, body: await currentPurchaseInTransaction(tx) };
    });
    return sendMutationResult(reply, result);
  });

  app.delete('/api/purchases/current/items/:productId', async (request, reply) => {
    const params = productIdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send(invalidInput);

    const result = await runMutation(db, request, JSON.stringify(['undoPurchased', params.data.productId]), async (tx) => {
      const [active] = await tx.select({ id: purchases.id }).from(purchases)
        .where(eq(purchases.status, 'ACTIVE'));
      if (!active) return { status: 404, body: noActivePurchase };
      const [item] = await tx.select({ id: purchaseItems.id }).from(purchaseItems)
        .where(and(eq(purchaseItems.purchaseId, active.id), eq(purchaseItems.productId, params.data.productId)));
      if (!item) return { status: 404, body: itemNotFound };

      await tx.insert(shoppingListItems).values({ productId: params.data.productId }).onConflictDoNothing();
      await tx.delete(purchaseItems).where(eq(purchaseItems.id, item.id));
      return { status: 200, body: await currentPurchaseInTransaction(tx) };
    });
    return sendMutationResult(reply, result);
  });

  app.post('/api/purchases/current/finish', async (request, reply) => {
    const result = await runMutation(db, request, JSON.stringify(['finishPurchase']), async (tx) => {
      const [active] = await tx.select({ id: purchases.id }).from(purchases)
        .where(eq(purchases.status, 'ACTIVE'));
      if (!active) return { status: 404, body: noActivePurchase };
      const [purchase] = await tx.update(purchases).set({ status: 'FINISHED', finishedAt: new Date() })
        .where(eq(purchases.id, active.id))
        .returning({ purchaseId: purchases.id, status: purchases.status, finishedAt: purchases.finishedAt });
      return { status: 200, body: purchase };
    });
    return sendMutationResult(reply, result);
  });
}
