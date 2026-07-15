import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './auth'
import { companies, outlets } from './core'

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  recordType: varchar('record_type', { length: 40 }),
  recordId: uuid('record_id'),
  outletId: uuid('outlet_id').references(() => outlets.id),
  meta: jsonb('meta'),
  ip: varchar('ip', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyIdx: index('audit_logs_company_idx').on(t.companyId),
  actorIdx: index('audit_logs_actor_idx').on(t.actorUserId),
  actionIdx: index('audit_logs_action_idx').on(t.action),
  recordIdx: index('audit_logs_record_idx').on(t.recordType, t.recordId),
  createdAtIdx: index('audit_logs_created_at_idx').on(t.createdAt),
}))
