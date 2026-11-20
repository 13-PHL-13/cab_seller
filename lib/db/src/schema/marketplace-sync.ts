import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { marketplaceConnectionsTable } from './marketplace-connections';

// Include durable sync tables in schema push so subsequent deployments retain
// queued jobs, completed pages and provider cooldowns.
export const marketplaceSyncJobsTable = pgTable('marketplace_sync_jobs', {
  id: text('id').primaryKey(),
  connectionId: integer('connection_id').notNull().references(() => marketplaceConnectionsTable.id, {onDelete:'cascade'}),
  revision: text('revision').notNull(), kind: text('kind').notNull(), params: jsonb('params').notNull(),
  state: text('state').notNull().default('queued'), result: text('result'), partialResult: text('partial_result'),
  generation: timestamp('generation',{withTimezone:true}).notNull().defaultNow(),
  updatedAt: timestamp('updated_at',{withTimezone:true}),
  nextAttemptAt: timestamp('next_attempt_at',{withTimezone:true}).notNull().defaultNow(),
  leaseUntil: timestamp('lease_until',{withTimezone:true}), leaseToken: text('lease_token'),
  failures: integer('failures').notNull().default(0), lastError: text('last_error'),
  accessedAt: timestamp('accessed_at',{withTimezone:true}).notNull().defaultNow(),
}, table => [index('marketplace_sync_due').on(table.nextAttemptAt).where(sql`${table.state} IN ('queued','waiting','running')`)]);

export const marketplaceSyncPagesTable = pgTable('marketplace_sync_pages', {
  id: text('id').primaryKey(),
  connectionId: integer('connection_id').notNull().references(() => marketplaceConnectionsTable.id,{onDelete:'cascade'}),
  revision: text('revision').notNull(), payload: text('payload').notNull(), status: integer('status').notNull(),
  fetchedAt: timestamp('fetched_at',{withTimezone:true}).notNull().defaultNow(),
  expiresAt: timestamp('expires_at',{withTimezone:true}).notNull(),
});
export const marketplaceSyncBudgetsTable = pgTable('marketplace_sync_budgets', {
  id: text('id').primaryKey(), nextAllowedAt: timestamp('next_allowed_at',{withTimezone:true}).notNull().defaultNow(),
  requestDay:text('request_day'),requestCount:integer('request_count').notNull().default(0),
});
