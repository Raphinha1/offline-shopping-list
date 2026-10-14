import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { buildApp } from '../src/app.js';
import { getDatabaseUrl } from '../src/config/databaseUrl.js';
import * as schema from '../src/db/schema.js';
import { categories } from '../src/domains/catalog/schema.js';
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
let pantryId: string;
let fridgeId: string;
let productId: string;

beforeAll(async () => {
  await adminClient.unsafe(`CREATE DATABASE "${databaseName}"`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  testCookie = await createTestDeviceCookie(db);
  await seedCategories(db);
  const rows = await db.select().from(categories);
  pantryId = rows.find(({ name }) => name === 'Despensa')!.id;
  fridgeId = rows.find(({ name }) => name === 'Refrigerador')!.id;
});

afterAll(async () => {
  await app.close();
  await testClient.end();
  await adminClient.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  await adminClient.end();
});

describe('API de catálogo', () => {
  it('lista categorías por orden y después por nombre', async () => {
    await db.insert(categories).values({ name: 'Abarrotes', sortOrder: 0 });
    const response = await inject({ method: 'GET', url: '/api/categories' });
    expect(response.statusCode).toBe(200);
    expect(response.json().map(({ name }: { name: string }) => name)).toEqual([
      'Abarrotes', 'Despensa', 'Refrigerador', 'Limpieza', 'Higiene', 'Otros',
    ]);
  });

  it('crea un producto normalizado y lo lista con su categoría', async () => {
    const empty = await inject({ method: 'GET', url: '/api/products' });
    expect(empty.json()).toEqual([]);
    const created = await inject({ method: 'POST', url: '/api/products', payload: {
      name: '  Leche   Entera  ', categoryId: fridgeId,
    } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Leche Entera', active: true, category: { id: fridgeId, name: 'Refrigerador' } });
    productId = created.json().id;
    const listed = await inject({ method: 'GET', url: '/api/products' });
    expect(listed.json()).toContainEqual(created.json());
  });

  it('busca sin distinguir mayúsculas y admite coincidencias parciales y espacios externos', async () => {
    for (const search of ['leche', 'ENTER', '  eChE  ']) {
      const response = await inject({ method: 'GET', url: `/api/products?search=${encodeURIComponent(search)}` });
      expect(response.json().map(({ id }: { id: string }) => id)).toContain(productId);
    }
    const emptySearch = await inject({ method: 'GET', url: '/api/products?search=%20%20' });
    expect(emptySearch.json()).toHaveLength(1);
  });

  it('rechaza datos inválidos, nombres vacíos y categorías inexistentes', async () => {
    const emptyName = await inject({ method: 'POST', url: '/api/products', payload: { name: '   ', categoryId: pantryId } });
    expect(emptyName.statusCode).toBe(400);
    expect(emptyName.json().error.code).toBe('INVALID_INPUT');
    const missingCategory = await inject({ method: 'POST', url: '/api/products', payload: { name: 'Pan', categoryId: randomUUID() } });
    expect(missingCategory.statusCode).toBe(400);
    expect(missingCategory.json().error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('evita duplicados activos de la misma categoría incluso con escrituras simultáneas', async () => {
    for (const name of [' leche entera ', 'LECHE ENTERA']) {
      const response = await inject({ method: 'POST', url: '/api/products', payload: { name, categoryId: fridgeId } });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('PRODUCT_DUPLICATE');
    }
    const otherCategory = await inject({ method: 'POST', url: '/api/products', payload: { name: 'Leche Entera', categoryId: pantryId } });
    expect(otherCategory.statusCode).toBe(201);
    const simultaneous = await Promise.all(['Pan', ' pan '].map((name) => inject({
      method: 'POST', url: '/api/products', payload: { name, categoryId: pantryId },
    })));
    expect(simultaneous.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409]);
  });

  it('edita nombre y categoría, y excluye productos desactivados del listado', async () => {
    const conflict = await inject({ method: 'PATCH', url: `/api/products/${productId}`, payload: { categoryId: pantryId } });
    expect(conflict.statusCode).toBe(409);
    const updated = await inject({ method: 'PATCH', url: `/api/products/${productId}`, payload: {
      name: 'Leche Deslactosada', categoryId: pantryId,
    } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: 'Leche Deslactosada', category: { id: pantryId } });
    const disabled = await inject({ method: 'PATCH', url: `/api/products/${productId}`, payload: { active: false } });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().active).toBe(false);
    const listed = await inject({ method: 'GET', url: '/api/products' });
    expect(listed.json().map(({ id }: { id: string }) => id)).not.toContain(productId);
    const searched = await inject({ method: 'GET', url: '/api/products?search=deslactosada' });
    expect(searched.json()).toEqual([]);
    const replacement = await inject({ method: 'POST', url: '/api/products', payload: {
      name: 'Leche Deslactosada', categoryId: pantryId,
    } });
    expect(replacement.statusCode).toBe(201);
    const reactivation = await inject({ method: 'PATCH', url: `/api/products/${productId}`, payload: { active: true } });
    expect(reactivation.statusCode).toBe(409);
  });

  it('responde con errores seguros para PATCH inválido o producto inexistente', async () => {
    const invalid = await inject({ method: 'PATCH', url: `/api/products/${productId}`, payload: {} });
    expect(invalid.statusCode).toBe(400);
    const absent = await inject({ method: 'PATCH', url: `/api/products/${randomUUID()}`, payload: { name: 'Otro' } });
    expect(absent.statusCode).toBe(404);
    expect(JSON.stringify(absent.json())).not.toMatch(/SQL|stack|password/i);
    const malformed = await inject({
      method: 'POST', url: '/api/products', headers: { 'content-type': 'application/json' }, payload: '{',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe('INVALID_REQUEST');
    const unknownRoute = await inject({ method: 'GET', url: '/api/unknown' });
    expect(unknownRoute.statusCode).toBe(404);
    expect(unknownRoute.json().error.code).toBe('ROUTE_NOT_FOUND');
  });
});
