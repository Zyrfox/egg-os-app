import {
  boolean,
  check,
  index,
  numeric,
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

const movementTypes = sql`('stock_in', 'stock_out', 'opname', 'waste')`

export const itemCategories = pgTable('item_categories', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  ...auditColumns,
}, (t) => ({
  companyCodeUq: uniqueIndex('item_categories_company_code_uq')
    .on(t.companyId, t.code)
    .where(sql`${t.deletedAt} IS NULL`),
  companyIdx: index('item_categories_company_idx').on(t.companyId),
}))

export const units = pgTable('units', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  code: varchar('code', { length: 30 }).notNull(),
  name: varchar('name', { length: 60 }).notNull(),
  ...auditColumns,
}, (t) => ({
  companyCodeUq: uniqueIndex('units_company_code_uq')
    .on(t.companyId, t.code)
    .where(sql`${t.deletedAt} IS NULL`),
}))

export const items = pgTable('items', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  sku: varchar('sku', { length: 60 }).notNull(),
  name: varchar('name', { length: 150 }).notNull(),
  categoryId: uuid('category_id').references(() => itemCategories.id),
  baseUnitId: uuid('base_unit_id').notNull().references(() => units.id),
  pawoonRef: varchar('pawoon_ref', { length: 120 }),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
}, (t) => ({
  companySkuUq: uniqueIndex('items_company_sku_uq')
    .on(t.companyId, t.sku)
    .where(sql`${t.deletedAt} IS NULL`),
  companyIdx: index('items_company_idx').on(t.companyId),
}))

export const itemUnitConversions = pgTable('item_unit_conversions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  fromUnitId: uuid('from_unit_id').notNull().references(() => units.id),
  factorToBase: numeric('factor_to_base', { precision: 18, scale: 6 }).notNull(),
  ...auditColumns,
}, (t) => ({
  itemFromUnitUq: uniqueIndex('item_unit_conv_uq')
    .on(t.itemId, t.fromUnitId)
    .where(sql`${t.deletedAt} IS NULL`),
  factorPositiveCheck: check('item_unit_conv_factor_positive', sql`${t.factorToBase} > 0`),
}))

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),
  movementType: varchar('movement_type', { length: 20 }).notNull(),
  qtyBase: numeric('qty_base', { precision: 18, scale: 6 }).notNull(),
  inputQty: numeric('input_qty', { precision: 18, scale: 6 }).notNull(),
  inputUnitId: uuid('input_unit_id').notNull().references(() => units.id),
  reason: text('reason'),
  refNo: varchar('ref_no', { length: 80 }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  movementTypeCheck: check('stock_movements_type_check', sql`${t.movementType} IN ${movementTypes}`),
  itemOutletIdx: index('stock_movements_item_outlet_idx').on(t.itemId, t.outletId),
  companyIdx: index('stock_movements_company_idx').on(t.companyId),
  createdAtIdx: index('stock_movements_created_at_idx').on(t.createdAt),
}))

export const stockBalances = pgTable('stock_balances', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  itemId: uuid('item_id').notNull().references(() => items.id),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),
  qtyBase: numeric('qty_base', { precision: 18, scale: 6 }).notNull().default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  itemOutletUq: uniqueIndex('stock_balances_item_outlet_uq').on(t.itemId, t.outletId),
  outletIdx: index('stock_balances_outlet_idx').on(t.outletId),
}))
