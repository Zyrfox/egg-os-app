import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './auth'
import { companies, outlets } from './core'

const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}

const reportTypes = sql`('opening', 'closing', 'issue')`
const reportStatuses = sql`('draft', 'submitted', 'validated', 'rejected')`

export const reportChecklistItems = pgTable('report_checklist_items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  outletId: uuid('outlet_id').references(() => outlets.id),
  reportType: varchar('report_type', { length: 20 }).notNull(),
  label: varchar('label', { length: 200 }).notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
}, (t) => ({
  typeCheck: check('report_checklist_items_type_check', sql`${t.reportType} IN ${reportTypes}`),
  companyIdx: index('report_checklist_items_company_idx').on(t.companyId),
  lookupIdx: index('report_checklist_items_lookup_idx').on(t.companyId, t.reportType, t.outletId),
}))

export const dailyReports = pgTable('daily_reports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),
  reportType: varchar('report_type', { length: 20 }).notNull(),
  reportDate: date('report_date').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  notes: text('notes'),
  submittedBy: uuid('submitted_by').references(() => users.id),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  validatedBy: uuid('validated_by').references(() => users.id),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  rejectedBy: uuid('rejected_by').references(() => users.id),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectReason: text('reject_reason'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...auditColumns,
}, (t) => ({
  statusCheck: check('daily_reports_status_check', sql`${t.status} IN ${reportStatuses}`),
  typeCheck: check('daily_reports_type_check', sql`${t.reportType} IN ${reportTypes}`),
  outletTypeDateUq: uniqueIndex('daily_reports_outlet_type_date_uq')
    .on(t.outletId, t.reportType, t.reportDate)
    .where(sql`${t.deletedAt} IS NULL`),
  outletIdx: index('daily_reports_outlet_idx').on(t.outletId),
  statusIdx: index('daily_reports_status_idx').on(t.status),
  dateIdx: index('daily_reports_date_idx').on(t.reportDate),
}))

export const reportChecklistAnswers = pgTable('report_checklist_answers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  reportId: uuid('report_id').notNull().references(() => dailyReports.id),
  checklistItemId: uuid('checklist_item_id').notNull().references(() => reportChecklistItems.id),
  isChecked: boolean('is_checked').notNull().default(false),
  value: text('value'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  reportItemUq: uniqueIndex('report_checklist_answers_uq').on(t.reportId, t.checklistItemId),
  reportIdx: index('report_checklist_answers_report_idx').on(t.reportId),
}))
