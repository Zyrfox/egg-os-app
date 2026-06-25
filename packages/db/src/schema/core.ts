import {
  boolean,
  index,
  jsonb,
  pgTable,
  time,
  uniqueIndex,
  uuid,
  varchar,
  timestamp,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyCode: varchar('company_code', { length: 30 }).notNull(),
  companyName: varchar('company_name', { length: 150 }).notNull(),
  legalName: varchar('legal_name', { length: 200 }),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  codeUq: uniqueIndex('companies_company_code_uq')
    .on(t.companyCode)
    .where(sql`${t.deletedAt} IS NULL`),
  statusIdx: index('companies_status_idx').on(t.status),
}))

export const brands = pgTable('brands', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  brandCode: varchar('brand_code', { length: 30 }).notNull(),
  brandName: varchar('brand_name', { length: 150 }).notNull(),
  brandType: varchar('brand_type', { length: 30 }).notNull().default('business_unit'),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  companyCodeUq: uniqueIndex('brands_company_code_uq')
    .on(t.companyId, t.brandCode)
    .where(sql`${t.deletedAt} IS NULL`),
  companyIdx: index('brands_company_idx').on(t.companyId),
  statusIdx: index('brands_status_idx').on(t.status),
}))

export const outlets = pgTable('outlets', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  brandId: uuid('brand_id').notNull().references(() => brands.id),
  outletCode: varchar('outlet_code', { length: 30 }).notNull(),
  outletName: varchar('outlet_name', { length: 150 }).notNull(),
  outletType: varchar('outlet_type', { length: 30 }).notNull().default('operational'),
  address: varchar('address', { length: 500 }),
  timezone: varchar('timezone', { length: 60 }).notNull().default('Asia/Jakarta'),
  openingTime: time('opening_time'),
  closingTime: time('closing_time'),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  brandCodeUq: uniqueIndex('outlets_brand_code_uq')
    .on(t.brandId, t.outletCode)
    .where(sql`${t.deletedAt} IS NULL`),
  companyIdx: index('outlets_company_idx').on(t.companyId),
  brandIdx: index('outlets_brand_idx').on(t.brandId),
  statusIdx: index('outlets_status_idx').on(t.status),
  companyInTransitUq: uniqueIndex('outlets_company_in_transit_uq')
    .on(t.companyId)
    .where(sql`${t.outletType} = 'in_transit' AND ${t.deletedAt} IS NULL`),
}))

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  brandId: uuid('brand_id').references(() => brands.id),
  outletId: uuid('outlet_id').references(() => outlets.id),
  departmentCode: varchar('department_code', { length: 30 }).notNull(),
  departmentName: varchar('department_name', { length: 150 }).notNull(),
  departmentType: varchar('department_type', { length: 30 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  outletCodeUq: uniqueIndex('departments_outlet_code_uq')
    .on(t.companyId, t.outletId, t.departmentCode)
    .where(sql`${t.deletedAt} IS NULL`),
  companyIdx: index('departments_company_idx').on(t.companyId),
  brandIdx: index('departments_brand_idx').on(t.brandId),
  outletIdx: index('departments_outlet_idx').on(t.outletId),
  statusIdx: index('departments_status_idx').on(t.status),
}))
