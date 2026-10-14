import type { FastifyInstance } from 'fastify';
import { asc } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { categories } from './schema.js';

export function registerCategoryRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/categories', async () => db.select({
    id: categories.id,
    name: categories.name,
    sortOrder: categories.sortOrder,
  }).from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)));
}
