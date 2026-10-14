import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  sortOrder: integer('sort_order').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('categories_name_not_blank', sql`length(btrim(${table.name})) > 0`),
]);

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('products_name_not_blank', sql`length(btrim(${table.name})) > 0`),
  index('products_category_id_idx').on(table.categoryId),
  uniqueIndex('products_active_category_name_unique')
    .on(table.categoryId, sql`lower(btrim(${table.name}))`)
    .where(sql`${table.active} = true`),
]);
