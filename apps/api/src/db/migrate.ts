import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { getDatabaseUrl } from '../config/databaseUrl.js';

const client = postgres(getDatabaseUrl(), { max: 1 });

try {
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL('../../drizzle/', import.meta.url)),
  });
  console.log('Migraciones aplicadas.');
} finally {
  await client.end();
}
