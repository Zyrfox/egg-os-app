import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { companies, outlets } from './core'
import { users } from './auth'

const taskStatusValues = sql`('open','in_progress','done','rejected','verified','cancelled')`

export const tasks = pgTable('tasks', {
  id:             uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId:      uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  outletId:       uuid('outlet_id').notNull().references(() => outlets.id, { onDelete: 'restrict' }),
  templateId:     uuid('template_id'),
  title:          text('title').notNull(),
  description:    text('description'),
  assignerUserId: uuid('assigner_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  assigneeUserId: uuid('assignee_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  status:         text('status').notNull().default('open'),
  dueAt:          timestamp('due_at', { withTimezone: true }),
  doneAt:         timestamp('done_at', { withTimezone: true }),
  verifiedAt:     timestamp('verified_at', { withTimezone: true }),
  verifiedBy:     uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
  rejectReason:   text('reject_reason'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusCheck:          check('tasks_status_check', sql`${t.status} IN ${taskStatusValues}`),
  companyOutletStatusIdx: index('tasks_company_outlet_status_idx').on(t.companyId, t.outletId, t.status),
  assigneeStatusIdx:    index('tasks_assignee_status_idx').on(t.assigneeUserId, t.status),
  dueAtPartialIdx:      index('tasks_due_at_partial_idx').on(t.dueAt).where(sql`${t.dueAt} IS NOT NULL`),
}))
