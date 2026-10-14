import { pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { products } from '../catalog/schema.js';

export const shoppingListItems = pgTable('shopping_list_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('shopping_list_items_product_id_unique').on(table.productId),
]);
