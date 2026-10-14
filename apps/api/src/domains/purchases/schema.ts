import { sql } from 'drizzle-orm';
import { check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { products } from '../catalog/schema.js';

export const purchaseStatus = pgEnum('purchase_status', ['ACTIVE', 'FINISHED']);

export const purchases = pgTable('purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: purchaseStatus('status').notNull().default('ACTIVE'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('purchases_finished_at_matches_status', sql`(${table.status} = 'ACTIVE' and ${table.finishedAt} is null) or (${table.status} = 'FINISHED' and ${table.finishedAt} is not null)`),
  uniqueIndex('purchases_one_active_unique').on(table.status).where(sql`${table.status} = 'ACTIVE'`),
]);

export const purchaseItems = pgTable('purchase_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseId: uuid('purchase_id').notNull().references(() => purchases.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  productNameSnapshot: text('product_name_snapshot').notNull(),
  priceCents: integer('price_cents'),
  purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('purchase_items_name_snapshot_not_blank', sql`length(btrim(${table.productNameSnapshot})) > 0`),
  check('purchase_items_price_cents_nonnegative', sql`${table.priceCents} >= 0`),
  index('purchase_items_purchase_id_idx').on(table.purchaseId),
  index('purchase_items_product_id_idx').on(table.productId),
  uniqueIndex('purchase_items_purchase_product_unique').on(table.purchaseId, table.productId),
]);
