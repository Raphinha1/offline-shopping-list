import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { buildApp } from '../src/app.js';
import { getDatabaseUrl } from '../src/config/databaseUrl.js';
import * as schema from '../src/db/schema.js';
import { seedCategories } from '../src/domains/catalog/seed.js';
import { authenticatedInject, createTestDeviceCookie } from './authenticatedInject.js';

const sourceUrl = new URL(getDatabaseUrl());
if (!['127.0.0.1', 'localhost'].includes(sourceUrl.hostname)) {
  throw new Error('Las pruebas de integración requieren PostgreSQL local.');
}
const databaseName = `lista_test_${randomUUID().replaceAll('-', '')}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;
const adminClient = postgres(adminUrl.toString(), { max: 1 });
const testClient = postgres(testUrl.toString());
const db = drizzle(testClient, { schema });
const app = buildApp({ databaseUrl: testUrl.toString() });
let testCookie = '';
const inject = authenticatedInject(app, () => testCookie);
let milkId: string;
let eggsId: string;
let detergentId: string;
let soapId: string;
let purchaseId: string;

async function current() {
  const response = await inject({ method: 'GET', url: '/api/purchases/current' });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function pendingIds() {
  const response = await inject({ method: 'GET', url: '/api/shopping-list' });
  return response.json().map(({ productId }: { productId: string }) => productId);
}

beforeAll(async () => {
  await adminClient.unsafe(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  testCookie = await createTestDeviceCookie(db);
  await seedCategories(db);
  const category = (await db.select().from(schema.categories)).find(({ name }) => name === 'Despensa')!;
  const [milk, eggs, detergent, soap] = await db.insert(schema.products).values([
    { name: 'Leche', categoryId: category.id },
    { name: 'Huevos', categoryId: category.id },
    { name: 'Detergente', categoryId: category.id },
    { name: 'Jabón', categoryId: category.id },
  ]).returning();
  milkId = milk.id;
  eggsId = eggs.id;
  detergentId = detergent.id;
  soapId = soap.id;
  for (const productId of [milkId, eggsId, detergentId, soapId]) {
    const response = await inject({ method: 'POST', url: '/api/shopping-list/items', payload: { productId } });
    expect(response.statusCode).toBe(201);
  }
});

afterAll(async () => {
  await app.close();
  await testClient.end();
  await adminClient.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await adminClient.end();
});

describe('compra actual', () => {
  it('no crea una compra antes del primer producto comprado', async () => {
    expect(await current()).toEqual({
      purchaseId: null, status: null, startedAt: null, items: [],
      totalPriceCents: 0, pricedItemCount: 0, unpricedItemCount: 0,
    });
    const finish = await inject({ method: 'POST', url: '/api/purchases/current/finish' });
    expect(finish.statusCode).toBe(404);
    expect(finish.json().error.code).toBe('NO_ACTIVE_PURCHASE');
  });

  it('crea automáticamente una sola compra y mueve Leche sin precio', async () => {
    const response = await inject({ method: 'POST', url: '/api/purchases/current/items', payload: { productId: milkId } });
    expect(response.statusCode).toBe(201);
    const state = response.json();
    purchaseId = state.purchaseId;
    expect(state).toMatchObject({ status: 'ACTIVE', totalPriceCents: 0, pricedItemCount: 0, unpricedItemCount: 1 });
    expect(state.items[0]).toMatchObject({ productId: milkId, productNameSnapshot: 'Leche', priceCents: null, category: { name: 'Despensa' } });
    expect(state.items[0].purchasedAt).toBeTruthy();
    expect(await pendingIds()).not.toContain(milkId);
    const duplicate = await inject({ method: 'POST', url: '/api/purchases/current/items', payload: { productId: milkId } });
    expect(duplicate.statusCode).toBe(409);
    const readd = await inject({ method: 'POST', url: '/api/shopping-list/items', payload: { productId: milkId } });
    expect(readd.statusCode).toBe(409);
    await expect(db.insert(schema.purchases).values({})).rejects.toThrow();
    expect((await db.select().from(schema.purchases).where(eq(schema.purchases.status, 'ACTIVE')))).toHaveLength(1);
  });

  it('registra Huevos con precio y calcula total y conteos desde backend', async () => {
    const response = await inject({ method: 'POST', url: '/api/purchases/current/items', payload: { productId: eggsId, priceCents: 3150 } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ totalPriceCents: 3150, pricedItemCount: 1, unpricedItemCount: 1 });
    expect(await pendingIds()).not.toContain(eggsId);
    await expect(db.insert(schema.purchaseItems).values({ purchaseId, productId: milkId, productNameSnapshot: 'Leche' })).rejects.toThrow();
  });

  it('acepta cero, cambia precio y permite volver a null sin float', async () => {
    const setZero = await inject({ method: 'PATCH', url: `/api/purchases/current/items/${milkId}`, payload: { priceCents: 0 } });
    expect(setZero.statusCode).toBe(200);
    expect(setZero.json()).toMatchObject({ totalPriceCents: 3150, pricedItemCount: 2, unpricedItemCount: 0 });
    const changed = await inject({ method: 'PATCH', url: `/api/purchases/current/items/${milkId}`, payload: { priceCents: 3300 } });
    expect(changed.json()).toMatchObject({ totalPriceCents: 6450, pricedItemCount: 2, unpricedItemCount: 0 });
    const cleared = await inject({ method: 'PATCH', url: `/api/purchases/current/items/${milkId}`, payload: { priceCents: null } });
    expect(cleared.json()).toMatchObject({ totalPriceCents: 3150, pricedItemCount: 1, unpricedItemCount: 1 });
  });

  it('rechaza precios negativos, fraccionarios y fuera del rango de PostgreSQL', async () => {
    for (const priceCents of [-1, 12.5, 2_147_483_648]) {
      const add = await inject({ method: 'POST', url: '/api/purchases/current/items', payload: { productId: detergentId, priceCents } });
      const change = await inject({ method: 'PATCH', url: `/api/purchases/current/items/${milkId}`, payload: { priceCents } });
      expect(add.statusCode).toBe(400);
      expect(change.statusCode).toBe(400);
    }
    expect(await pendingIds()).toContain(detergentId);
    expect((await current()).totalPriceCents).toBe(3150);
  });

  it('serializa dos intentos simultáneos para el mismo producto', async () => {
    const category = (await db.select().from(schema.categories)).find(({ name }) => name === 'Despensa')!;
    const [bread] = await db.insert(schema.products).values({ name: 'Pan', categoryId: category.id }).returning();
    await inject({ method: 'POST', url: '/api/shopping-list/items', payload: { productId: bread.id } });
    const responses = await Promise.all([0, 1].map(() => inject({
      method: 'POST', url: '/api/purchases/current/items', payload: { productId: bread.id },
    })));
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409]);
    const items = await db.select().from(schema.purchaseItems)
      .where(and(eq(schema.purchaseItems.purchaseId, purchaseId), eq(schema.purchaseItems.productId, bread.id)));
    expect(items).toHaveLength(1);
    await inject({ method: 'DELETE', url: `/api/purchases/current/items/${bread.id}` });
    await inject({ method: 'DELETE', url: `/api/shopping-list/items/${bread.id}` });
  });

  it('deshace Huevos y lo devuelve a pendientes antes de comprarlo otra vez', async () => {
    const undone = await inject({ method: 'DELETE', url: `/api/purchases/current/items/${eggsId}` });
    expect(undone.statusCode).toBe(200);
    expect(undone.json()).toMatchObject({ totalPriceCents: 0, pricedItemCount: 0, unpricedItemCount: 1 });
    expect(await pendingIds()).toContain(eggsId);
    const rebought = await inject({ method: 'POST', url: '/api/purchases/current/items', payload: { productId: eggsId, priceCents: 4200 } });
    expect(rebought.statusCode).toBe(201);
    expect(rebought.json()).toMatchObject({ totalPriceCents: 4200, pricedItemCount: 1, unpricedItemCount: 1 });
  });

  it('revierte toda la transacción cuando falla la inserción de un comprado', async () => {
    await testClient.unsafe(`ALTER TABLE purchase_items ADD CONSTRAINT test_reject_detergent CHECK (product_id <> '${detergentId}')`);
    try {
      const response = await inject({ method: 'POST', url: '/api/purchases/current/items', payload: { productId: detergentId } });
      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
      expect(await pendingIds()).toContain(detergentId);
      const items = await db.select().from(schema.purchaseItems).where(eq(schema.purchaseItems.productId, detergentId));
      expect(items).toHaveLength(0);
    } finally {
      await testClient.unsafe('ALTER TABLE purchase_items DROP CONSTRAINT test_reject_detergent');
    }
  });

  it('permite comprar un producto que era pendiente antes de desactivarse', async () => {
    const disabled = await inject({ method: 'PATCH', url: `/api/products/${soapId}`, payload: { active: false } });
    expect(disabled.statusCode).toBe(200);
    const bought = await inject({ method: 'POST', url: '/api/purchases/current/items', payload: { productId: soapId, priceCents: 0 } });
    expect(bought.statusCode).toBe(201);
    expect(bought.json().items).toContainEqual(expect.objectContaining({ productId: soapId, priceCents: 0 }));
    await inject({ method: 'DELETE', url: `/api/purchases/current/items/${soapId}` });
    await inject({ method: 'DELETE', url: `/api/shopping-list/items/${soapId}` });
  });

  it('finaliza solo la compra activa y conserva los pendientes no comprados', async () => {
    expect(await pendingIds()).toEqual([detergentId]);
    const finished = await inject({ method: 'POST', url: '/api/purchases/current/finish' });
    expect(finished.statusCode).toBe(200);
    expect(finished.json()).toMatchObject({ purchaseId, status: 'FINISHED' });
    expect(finished.json().finishedAt).toBeTruthy();
    expect((await current()).purchaseId).toBeNull();
    expect(await pendingIds()).toEqual([detergentId]);
    const [historical] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, purchaseId));
    expect(historical.status).toBe('FINISHED');
    expect(historical.finishedAt).toBeInstanceOf(Date);
    const historicalItems = await db.select().from(schema.purchaseItems).where(eq(schema.purchaseItems.purchaseId, purchaseId));
    expect(historicalItems.map(({ productId }) => productId).sort()).toEqual([milkId, eggsId].sort());
    const edit = await inject({ method: 'PATCH', url: `/api/purchases/current/items/${eggsId}`, payload: { priceCents: 1 } });
    const undo = await inject({ method: 'DELETE', url: `/api/purchases/current/items/${eggsId}` });
    const finishAgain = await inject({ method: 'POST', url: '/api/purchases/current/finish' });
    expect([edit.statusCode, undo.statusCode, finishAgain.statusCode]).toEqual([404, 404, 404]);
    expect(await pendingIds()).toEqual([detergentId]);
  });
});
