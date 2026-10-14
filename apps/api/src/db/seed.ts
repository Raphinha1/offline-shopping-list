import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { getDatabaseUrl } from '../config/databaseUrl.js';
import { seedCategories } from '../domains/catalog/seed.js';

const client = postgres(getDatabaseUrl());

try {
  await seedCategories(drizzle(client, { schema }));
  console.log('Categorías iniciales listas.');
} finally {
  await client.end();
}
