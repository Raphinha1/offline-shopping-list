import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { categories, products } from './schema.js';

const name = z.string().transform((value) => value.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(120));
const createProduct = z.strictObject({ name, categoryId: z.uuid() });
const updateProduct = z.strictObject({
  name: name.optional(),
  categoryId: z.uuid().optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0);
const productIdParams = z.object({ id: z.uuid() });
const searchQuery = z.object({ search: z.string().max(120).optional() });

const invalidInput = { error: { code: 'INVALID_INPUT', message: 'Revisa los datos enviados.' } };
const missingCategory = { error: { code: 'CATEGORY_NOT_FOUND', message: 'La categoría seleccionada no existe.' } };
const duplicateProduct = { error: { code: 'PRODUCT_DUPLICATE', message: 'Ya existe un producto activo con ese nombre en esta categoría.' } };

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  if ('cause' in error) return databaseErrorCode(error.cause);
  return undefined;
}

async function categoryExists(db: Database, id: string) {
  const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, id));
  return Boolean(category);
}

function productSelection() {
  return {
    id: products.id,
    name: products.name,
    active: products.active,
    category: {
      id: categories.id,
      name: categories.name,
      sortOrder: categories.sortOrder,
    },
  };
}

async function findProduct(db: Database, id: string) {
  const [product] = await db.select(productSelection()).from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.id, id));
  return product;
}

export function registerProductRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/products', async (request, reply) => {
    const parsed = searchQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(invalidInput);
    const search = parsed.data.search?.trim() ?? '';
    const matches = search
      ? sql`position(lower(${search}) in lower(${products.name})) > 0`
      : undefined;
    return db.select(productSelection()).from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(and(eq(products.active, true), matches))
      .orderBy(asc(categories.sortOrder), asc(categories.name), asc(products.name));
  });

  app.post('/api/products', async (request, reply) => {
    const parsed = createProduct.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(invalidInput);
    const { name, categoryId } = parsed.data;
    if (!(await categoryExists(db, categoryId))) return reply.code(400).send(missingCategory);
    try {
      const [created] = await db.insert(products).values({ name, categoryId }).returning({ id: products.id });
      return reply.code(201).send(await findProduct(db, created.id));
    } catch (error) {
      if (databaseErrorCode(error) === '23505') return reply.code(409).send(duplicateProduct);
      if (databaseErrorCode(error) === '23503') return reply.code(400).send(missingCategory);
      throw error;
    }
  });

  app.patch('/api/products/:id', async (request, reply) => {
    const params = productIdParams.safeParse(request.params);
    const body = updateProduct.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send(invalidInput);
    if (body.data.categoryId && !(await categoryExists(db, body.data.categoryId))) {
      return reply.code(400).send(missingCategory);
    }
    try {
      const [updated] = await db.update(products).set({ ...body.data, updatedAt: new Date() })
        .where(eq(products.id, params.data.id)).returning({ id: products.id });
      if (!updated) return reply.code(404).send({ error: { code: 'PRODUCT_NOT_FOUND', message: 'El producto no existe.' } });
      return await findProduct(db, updated.id);
    } catch (error) {
      if (databaseErrorCode(error) === '23505') return reply.code(409).send(duplicateProduct);
      if (databaseErrorCode(error) === '23503') return reply.code(400).send(missingCategory);
      throw error;
    }
  });
}
