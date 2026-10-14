import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { categories } from './schema.js';
import type * as schema from '../../db/schema.js';

const initialCategories = [
  { name: 'Despensa', sortOrder: 0 },
  { name: 'Refrigerador', sortOrder: 1 },
  { name: 'Limpieza', sortOrder: 2 },
  { name: 'Higiene', sortOrder: 3 },
  { name: 'Otros', sortOrder: 4 },
];

export async function seedCategories(db: PostgresJsDatabase<typeof schema>) {
  await db.insert(categories).values(initialCategories).onConflictDoNothing({ target: categories.name });
}
