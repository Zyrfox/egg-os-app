import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './auth'
import { companies, outlets } from './core'

const evidenceRecordTypes = sql`('daily_report','task')`
const evidenceContentTypes = sql`('image/jpeg', 'image/png', 'application/pdf')`
const evidenceStatuses = sql`('pending', 'confirmed')`

export const evidence = pgTable('evidence', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  outletId: uuid('outlet_id').references(() => outlets.id),
  recordType: varchar('record_type', { length: 40 }).notNull(),
  recordId: uuid('record_id').notNull(),
  storageKey: varchar('storage_key', { length: 1024 }).notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  contentType: varchar('content_type', { length: 100 }).notNull(),
  fileSize: integer('file_size').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  recordTypeCheck: check('evidence_record_type_check', sql`${t.recordType} IN ${evidenceRecordTypes}`),
  contentTypeCheck: check('evidence_content_type_check', sql`${t.contentType} IN ${evidenceContentTypes}`),
  statusCheck: check('evidence_status_check', sql`${t.status} IN ${evidenceStatuses}`),
  recordIdx: index('evidence_record_idx').on(t.recordType, t.recordId),
  companyIdx: index('evidence_company_idx').on(t.companyId),
  outletIdx: index('evidence_outlet_idx').on(t.outletId),
}))
