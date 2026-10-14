import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import type { PurchaseTransaction } from '../../db/currentPurchaseLock.js';
import { categories, products } from '../catalog/schema.js';
import { runMutation, sendMutationResult } from '../operations/runMutation.js';
import { purchaseItems, purchases } from '../purchases/schema.js';
import { shoppingListItems } from './schema.js';

const productIdBody = z.strictObject({ productId: z.uuid() });
const productIdParams = z.object({ productId: z.uuid() });
const invalidInput = { error: { code: 'INVALID_INPUT', message: 'Revisa los datos enviados.' } };

function selectPendingItem() {
  return {
    productId: shoppingListItems.productId,
    name: products.name,
    active: products.active,
    addedAt: shoppingListItems.createdAt,
    category: {
      id: categories.id,
      name: categories.name,
      sortOrder: categories.sortOrder,
    },
  };
}

async function findPendingItem(tx: PurchaseTransaction, productId: string) {
  const [item] = await tx.select(selectPendingItem()).from(shoppingListItems)
    .innerJoin(products, eq(shoppingListItems.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(shoppingListItems.productId, productId));
  return item;
}

export function registerShoppingListRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/shopping-list', async () => db.select(selectPendingItem()).from(shoppingListItems)
    .innerJoin(products, eq(shoppingListItems.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .orderBy(asc(categories.sortOrder), asc(categories.name), asc(products.name), asc(shoppingListItems.createdAt), asc(shoppingListItems.id)));

  app.post('/api/shopping-list/items', async (request, reply) => {
    const parsed = productIdBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidInput);
    const { productId } = parsed.data;

    const result = await runMutation(db, request, JSON.stringify(['addPending', productId]), async (tx) => {
      const [product] = await tx.select({ id: products.id, active: products.active }).from(products)
        .where(eq(products.id, productId)).for('update');
      if (!product) return { status: 404, body: { error: { code: 'PRODUCT_NOT_FOUND', message: 'El producto no existe.' } } };

      const [purchased] = await tx.select({ id: purchaseItems.id }).from(purchaseItems)
        .innerJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
        .where(and(eq(purchases.status, 'ACTIVE'), eq(purchaseItems.productId, productId)));
      if (purchased) return { status: 409, body: { error: { code: 'PRODUCT_ALREADY_PURCHASED', message: 'El producto ya está comprado en esta compra.' } } };

      const [existing] = await tx.select({ id: shoppingListItems.id }).from(shoppingListItems)
        .where(eq(shoppingListItems.productId, productId));
      if (existing) return { status: 200, body: await findPendingItem(tx, productId) };
      if (!product.active) return { status: 409, body: { error: { code: 'PRODUCT_INACTIVE', message: 'El producto está desactivado.' } } };

      await tx.insert(shoppingListItems).values({ productId });
      return { status: 201, body: await findPendingItem(tx, productId) };
    });
    return sendMutationResult(reply, result);
  });

  app.delete('/api/shopping-list/items/:productId', async (request, reply) => {
    const parsed = productIdParams.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(invalidInput);
    const result = await runMutation(db, request, JSON.stringify(['removePending', parsed.data.productId]), async (tx) => {
      await tx.delete(shoppingListItems).where(eq(shoppingListItems.productId, parsed.data.productId));
      return { status: 204, body: null };
    });
    return sendMutationResult(reply, result);
  });
}
