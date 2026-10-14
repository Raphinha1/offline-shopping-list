import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { buildApp } from '../src/app.js';
import { getDatabaseUrl } from '../src/config/databaseUrl.js';
import * as schema from '../src/db/schema.js';
import { seedCategories } from '../src/domains/catalog/seed.js';
import { authenticatedInject, createTestDeviceCookie } from './authenticatedInject.js';

const sourceUrl = new URL(getDatabaseUrl());
if (!['127.0.0.1', 'localhost'].includes(sourceUrl.hostname)) throw new Error('Las pruebas requieren PostgreSQL local.');
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

beforeAll(async () => {
  await adminClient.unsafe(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  testCookie = await createTestDeviceCookie(db);
  await seedCategories(db);
  const category = (await db.select().from(schema.categories))[0];
  const [milk, eggs] = await db.insert(schema.products).values([
    { name: 'Leche', categoryId: category.id }, { name: 'Huevos', categoryId: category.id },
  ]).returning();
  milkId = milk.id;
  eggsId = eggs.id;
});

afterAll(async () => {
  await app.close();
  await testClient.end();
  await adminClient.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await adminClient.end();
});

describe('operaciones idempotentes', () => {
  it('repite la respuesta original sin volver a aplicar lista, precio ni finalización', async () => {
    const addId = randomUUID();
    const add = await inject({ method: 'POST', url: '/api/shopping-list/items',
      headers: { 'x-operation-id': addId }, payload: { productId: milkId } });
    expect(add.statusCode).toBe(201);
    const remove = await inject({ method: 'DELETE', url: `/api/shopping-list/items/${milkId}`,
      headers: { 'x-operation-id': randomUUID() } });
    expect(remove.statusCode).toBe(204);
    const lostResponseRetry = await inject({ method: 'POST', url: '/api/shopping-list/items',
      headers: { 'x-operation-id': addId }, payload: { productId: milkId } });
    expect(lostResponseRetry.statusCode).toBe(201);
    expect(lostResponseRetry.json()).toEqual(add.json());
    expect((await inject({ method: 'GET', url: '/api/shopping-list' })).json()).toEqual([]);

    await inject({ method: 'POST', url: '/api/shopping-list/items',
      headers: { 'x-operation-id': randomUUID() }, payload: { productId: milkId } });
    const buyId = randomUUID();
    const buy = await inject({ method: 'POST', url: '/api/purchases/current/items',
      headers: { 'x-operation-id': buyId }, payload: { productId: milkId } });
    expect(buy.statusCode).toBe(201);
    const priceId = randomUUID();
    const price = await inject({ method: 'PATCH', url: `/api/purchases/current/items/${milkId}`,
      headers: { 'x-operation-id': priceId }, payload: { priceCents: 3150 } });
    expect(price.json().totalPriceCents).toBe(3150);
    const repeatedBuy = await inject({ method: 'POST', url: '/api/purchases/current/items',
      headers: { 'x-operation-id': buyId }, payload: { productId: milkId } });
    expect(repeatedBuy.statusCode).toBe(201);
    expect(repeatedBuy.json()).toEqual(buy.json());
    expect((await inject({ method: 'GET', url: '/api/purchases/current' })).json()).toMatchObject({
      totalPriceCents: 3150, pricedItemCount: 1,
    });
    await inject({ method: 'PATCH', url: `/api/purchases/current/items/${milkId}`,
      headers: { 'x-operation-id': randomUUID() }, payload: { priceCents: 4000 } });
    const repeatedPrice = await inject({ method: 'PATCH', url: `/api/purchases/current/items/${milkId}`,
      headers: { 'x-operation-id': priceId }, payload: { priceCents: 3150 } });
    expect(repeatedPrice.json()).toEqual(price.json());
    expect((await inject({ method: 'GET', url: '/api/purchases/current' })).json().totalPriceCents).toBe(4000);

    const finishId = randomUUID();
    const finish = await inject({ method: 'POST', url: '/api/purchases/current/finish',
      headers: { 'x-operation-id': finishId } });
    expect(finish.statusCode).toBe(200);
    await inject({ method: 'POST', url: '/api/shopping-list/items', payload: { productId: eggsId } });
    await inject({ method: 'POST', url: '/api/purchases/current/items', payload: { productId: eggsId } });
    const repeatedFinish = await inject({ method: 'POST', url: '/api/purchases/current/finish',
      headers: { 'x-operation-id': finishId } });
    expect(repeatedFinish.json()).toEqual(finish.json());
    expect((await inject({ method: 'GET', url: '/api/purchases/current' })).json().items).toHaveLength(1);

    const undoId = randomUUID();
    const undo = await inject({ method: 'DELETE', url: `/api/purchases/current/items/${eggsId}`,
      headers: { 'x-operation-id': undoId } });
    expect(undo.statusCode).toBe(200);
    await inject({ method: 'POST', url: '/api/purchases/current/items', payload: { productId: eggsId } });
    const repeatedUndo = await inject({ method: 'DELETE', url: `/api/purchases/current/items/${eggsId}`,
      headers: { 'x-operation-id': undoId } });
    expect(repeatedUndo.json()).toEqual(undo.json());
    expect((await inject({ method: 'GET', url: '/api/purchases/current' })).json().items).toHaveLength(1);

    const reused = await inject({ method: 'DELETE', url: `/api/shopping-list/items/${eggsId}`,
      headers: { 'x-operation-id': finishId } });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe('OPERATION_ID_REUSED');
  });

  it('serializa duplicados concurrentes con el mismo operationId', async () => {
    const category = (await db.select().from(schema.categories))[0];
    const [bread] = await db.insert(schema.products).values({ name: 'Pan', categoryId: category.id }).returning();
    const operationId = randomUUID();
    const requests = await Promise.all([0, 1].map(() => inject({ method: 'POST', url: '/api/shopping-list/items',
      headers: { 'x-operation-id': operationId }, payload: { productId: bread.id } })));
    expect(requests.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(requests[0].json()).toEqual(requests[1].json());
    expect((await inject({ method: 'GET', url: '/api/shopping-list' })).json()
      .filter((item: { productId: string }) => item.productId === bread.id)).toHaveLength(1);
  });
});
