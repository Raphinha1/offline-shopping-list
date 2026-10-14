import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
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
let riceId: string;
let inactiveId: string;

beforeAll(async () => {
  await adminClient.unsafe(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  testCookie = await createTestDeviceCookie(db);
  await seedCategories(db);
  const categoryRows = await db.select().from(schema.categories);
  const fridgeId = categoryRows.find(({ name }) => name === 'Refrigerador')!.id;
  const pantryId = categoryRows.find(({ name }) => name === 'Despensa')!.id;
  const [milk] = await db.insert(schema.products).values({ name: 'Leche', categoryId: fridgeId }).returning();
  const [rice] = await db.insert(schema.products).values({ name: 'Arroz', categoryId: pantryId }).returning();
  const [inactive] = await db.insert(schema.products).values({ name: 'Harina', categoryId: pantryId, active: false }).returning();
  milkId = milk.id;
  riceId = rice.id;
  inactiveId = inactive.id;
});

afterAll(async () => {
  await app.close();
  await testClient.end();
  await adminClient.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await adminClient.end();
});

describe('API de pendientes', () => {
  it('comienza con una lista vacía', async () => {
    const response = await inject({ method: 'GET', url: '/api/shopping-list' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('añade un producto una vez y repite la petición sin duplicarlo', async () => {
    const first = await inject({ method: 'POST', url: '/api/shopping-list/items', payload: { productId: milkId } });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ productId: milkId, name: 'Leche', active: true, category: { name: 'Refrigerador' } });
    expect(first.json().addedAt).toBeTruthy();
    const repeated = await inject({ method: 'POST', url: '/api/shopping-list/items', payload: { productId: milkId } });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().addedAt).toBe(first.json().addedAt);
    const list = await inject({ method: 'GET', url: '/api/shopping-list' });
    expect(list.json()).toHaveLength(1);
  });

  it('rechaza un producto inexistente o inactivo como nuevo pendiente', async () => {
    const missing = await inject({ method: 'POST', url: '/api/shopping-list/items', payload: { productId: randomUUID() } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('PRODUCT_NOT_FOUND');
    const inactive = await inject({ method: 'POST', url: '/api/shopping-list/items', payload: { productId: inactiveId } });
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json().error.code).toBe('PRODUCT_INACTIVE');
  });

  it('lista pendientes con categoría y orden determinista', async () => {
    const added = await inject({ method: 'POST', url: '/api/shopping-list/items', payload: { productId: riceId } });
    expect(added.statusCode).toBe(201);
    const response = await inject({ method: 'GET', url: '/api/shopping-list' });
    expect(response.json().map(({ productId }: { productId: string }) => productId)).toEqual([riceId, milkId]);
    expect(response.json()[0].category.name).toBe('Despensa');
  });

  it('conserva visible un pendiente cuyo producto se desactiva', async () => {
    const updated = await inject({ method: 'PATCH', url: `/api/products/${milkId}`, payload: { active: false } });
    expect(updated.statusCode).toBe(200);
    const list = await inject({ method: 'GET', url: '/api/shopping-list' });
    expect(list.json()).toContainEqual(expect.objectContaining({ productId: milkId, active: false }));
    const repeated = await inject({ method: 'POST', url: '/api/shopping-list/items', payload: { productId: milkId } });
    expect(repeated.statusCode).toBe(200);
    const products = await inject({ method: 'GET', url: '/api/products' });
    expect(products.json().map(({ id }: { id: string }) => id)).not.toContain(milkId);
  });

  it('quita el pendiente de forma segura sin eliminar el producto', async () => {
    const first = await inject({ method: 'DELETE', url: `/api/shopping-list/items/${milkId}` });
    const repeated = await inject({ method: 'DELETE', url: `/api/shopping-list/items/${milkId}` });
    expect(first.statusCode).toBe(204);
    expect(repeated.statusCode).toBe(204);
    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, milkId));
    expect(product.name).toBe('Leche');
    const list = await inject({ method: 'GET', url: '/api/shopping-list' });
    expect(list.json().map(({ productId }: { productId: string }) => productId)).toEqual([riceId]);
  });

  it('valida los identificadores de entrada', async () => {
    const add = await inject({ method: 'POST', url: '/api/shopping-list/items', payload: { productId: 'x' } });
    const remove = await inject({ method: 'DELETE', url: '/api/shopping-list/items/x' });
    expect(add.statusCode).toBe(400);
    expect(remove.statusCode).toBe(400);
  });
});
