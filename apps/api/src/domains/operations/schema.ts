import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const mutationOperations = pgTable('mutation_operations', {
  operationId: uuid('operation_id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: jsonb('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
