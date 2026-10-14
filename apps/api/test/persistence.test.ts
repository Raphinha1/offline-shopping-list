import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { getDatabaseUrl } from '../src/config/databaseUrl.js';
import * as schema from '../src/db/schema.js';
import { seedCategories } from '../src/domains/catalog/seed.js';

const databaseUrl = new URL(getDatabaseUrl());
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
  throw new Error('Las pruebas de integración requieren PostgreSQL local.');
}

const testDatabaseName = `lista_test_${randomUUID().replaceAll('-', '')}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = '/postgres';
const testUrl = new URL(databaseUrl);
testUrl.pathname = `/${testDatabaseName}`;

const adminClient = postgres(adminUrl.toString(), { max: 1 });
const testClient = postgres(testUrl.toString());
const db = drizzle(testClient, { schema });
let categoryId: string;
let productId: string;
let purchaseId: string;

beforeAll(async () => {
  await adminClient.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  await seedCategories(db);
  const [category] = await db.select().from(schema.categories).where(eq(schema.categories.name, 'Despensa'));
  if (!category) throw new Error('El seed no creó Despensa.');
  categoryId = category.id;

  const [product] = await db.insert(schema.products).values({ name: 'Arroz', categoryId }).returning();
  const [purchase] = await db.insert(schema.purchases).values({}).returning();
  productId = product.id;
  purchaseId = purchase.id;
});

afterAll(async () => {
  await testClient.end();
  await adminClient.unsafe(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
  await adminClient.end();
});

describe('persistencia de compras', () => {
  it('mantiene el seed de categorías idempotente', async () => {
    await seedCategories(db);
    await seedCategories(db);
    const rows = await db.select().from(schema.categories);
    expect(rows.map(({ name, sortOrder }) => [name, sortOrder]).sort((a, b) => Number(a[1]) - Number(b[1]))).toEqual([
      ['Despensa', 0], ['Refrigerador', 1], ['Limpieza', 2], ['Higiene', 3], ['Otros', 4],
    ]);
  });

  it('rechaza nombres vacíos y categorías inexistentes', async () => {
    await expect(db.insert(schema.categories).values({ name: '  ', sortOrder: 9 })).rejects.toThrow();
    await expect(db.insert(schema.products).values({ name: '', categoryId })).rejects.toThrow();
    await expect(db.insert(schema.products).values({ name: 'Leche', categoryId: randomUUID() })).rejects.toThrow();
  });

  it('solo permite un elemento pendiente por producto y exige una relación válida', async () => {
    await db.insert(schema.shoppingListItems).values({ productId });
    await expect(db.insert(schema.shoppingListItems).values({ productId })).rejects.toThrow();
    await expect(db.insert(schema.shoppingListItems).values({ productId: randomUUID() })).rejects.toThrow();
  });

  it('conserva un precio nulo y el nombre comprado aunque cambie el catálogo', async () => {
    const [item] = await db.insert(schema.purchaseItems).values({
      purchaseId, productId, productNameSnapshot: 'Arroz', priceCents: null,
    }).returning();
    await db.update(schema.products).set({ name: 'Arroz integral' }).where(eq(schema.products.id, productId));
    const [stored] = await db.select().from(schema.purchaseItems).where(eq(schema.purchaseItems.id, item.id));
    expect(stored.priceCents).toBeNull();
    expect(stored.productNameSnapshot).toBe('Arroz');
  });

  it('rechaza precios negativos y relaciones de compra inexistentes', async () => {
    await expect(db.insert(schema.purchaseItems).values({
      purchaseId, productId, productNameSnapshot: 'Arroz', priceCents: -1,
    })).rejects.toThrow();
    await expect(db.insert(schema.purchaseItems).values({
      purchaseId, productId, productNameSnapshot: 'Arroz', priceCents: 12.5,
    })).rejects.toThrow();
    await expect(db.insert(schema.purchaseItems).values({
      purchaseId: randomUUID(), productId, productNameSnapshot: 'Arroz', priceCents: 100,
    })).rejects.toThrow();
    await expect(db.insert(schema.purchaseItems).values({
      purchaseId, productId: randomUUID(), productNameSnapshot: 'Arroz', priceCents: 100,
    })).rejects.toThrow();
  });

  it('acepta los estados definidos y exige finishedAt al finalizar', async () => {
    const [active] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, purchaseId));
    expect(active.status).toBe('ACTIVE');
    expect(active.finishedAt).toBeNull();
    await expect(testClient.unsafe("INSERT INTO purchases (status) VALUES ('UNKNOWN')")).rejects.toThrow();
    await expect(db.update(schema.purchases).set({ status: 'FINISHED' }).where(eq(schema.purchases.id, purchaseId))).rejects.toThrow();
    const [finished] = await db.update(schema.purchases)
      .set({ status: 'FINISHED', finishedAt: new Date() })
      .where(eq(schema.purchases.id, purchaseId)).returning();
    expect(finished.status).toBe('FINISHED');
    expect(finished.finishedAt).toBeInstanceOf(Date);
  });
});
