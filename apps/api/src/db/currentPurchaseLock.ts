import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

export type PurchaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// Serializa los cambios de la lista y la compra actual dentro de cada transacción.
export async function lockCurrentPurchase(tx: PurchaseTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(73122026)`);
}
