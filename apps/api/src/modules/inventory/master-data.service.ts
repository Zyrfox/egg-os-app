import { and, asc, eq, isNull, sql as drizzleSql } from 'drizzle-orm'
import { itemCategories, itemUnitConversions, items, units } from '@egg-os/db'
import type {
  AddConversionInput,
  CreateCategoryInput,
  CreateItemInput,
  CreateUnitInput,
  UpdateItemInput,
} from '@egg-os/validation'
import { ERR } from '../../lib/errors'
import type { Db } from '../../lib/db'
import {
  InventoryServiceError,
  normalizeDecimal,
  type InventoryServiceContext,
} from './service'

type ItemRow = typeof items.$inferSelect
type UnitRow = typeof units.$inferSelect
type CategoryRow = typeof itemCategories.$inferSelect
type ConversionRow = typeof itemUnitConversions.$inferSelect

export type ListItemsQuery = {
  categoryId?: string
  isActive?: boolean
  page?: number
  pageSize?: number
}

export type ListQuery = {
  page?: number
  pageSize?: number
}

function duplicate(message: string = ERR.DUPLICATE.message) {
  return new InventoryServiceError(ERR.DUPLICATE.http, ERR.DUPLICATE.code, message)
}

function outOfScope() {
  return new InventoryServiceError(ERR.OUT_OF_SCOPE.http, ERR.OUT_OF_SCOPE.code, ERR.OUT_OF_SCOPE.message)
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

function pageOf(query?: ListQuery) {
  return Math.max(1, Math.floor(query?.page ?? 1))
}

function pageSizeOf(query?: ListQuery) {
  return Math.min(100, Math.max(1, Math.floor(query?.pageSize ?? 50)))
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null
}

function itemDto(row: ItemRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    sku: row.sku,
    name: row.name,
    category_id: row.categoryId,
    base_unit_id: row.baseUnitId,
    pawoon_ref: row.pawoonRef,
    is_active: row.isActive,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: iso(row.deletedAt),
  }
}

function unitDto(row: UnitRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    code: row.code,
    name: row.name,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: iso(row.deletedAt),
  }
}

function categoryDto(row: CategoryRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    code: row.code,
    name: row.name,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: iso(row.deletedAt),
  }
}

function conversionDto(row: ConversionRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    item_id: row.itemId,
    from_unit_id: row.fromUnitId,
    factor_to_base: row.factorToBase,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    deleted_at: iso(row.deletedAt),
  }
}

async function getUnitRow(db: Db, companyId: string, unitId: string) {
  const row = await db
    .select()
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.companyId, companyId), isNull(units.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) throw outOfScope()
  return row
}

async function getCategoryRow(db: Db, companyId: string, categoryId: string) {
  const row = await db
    .select()
    .from(itemCategories)
    .where(
      and(
        eq(itemCategories.id, categoryId),
        eq(itemCategories.companyId, companyId),
        isNull(itemCategories.deletedAt),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) throw outOfScope()
  return row
}

async function getItemRow(db: Db, companyId: string, itemId: string) {
  const row = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) throw outOfScope()
  return row
}

async function assertNoItemSku(db: Db, companyId: string, sku: string) {
  const row = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.companyId, companyId), eq(items.sku, sku), isNull(items.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (row) throw duplicate('SKU sudah digunakan')
}

async function assertNoUnitCode(db: Db, companyId: string, code: string) {
  const row = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.companyId, companyId), eq(units.code, code), isNull(units.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (row) throw duplicate('Kode unit sudah digunakan')
}

async function assertNoCategoryCode(db: Db, companyId: string, code: string) {
  const row = await db
    .select({ id: itemCategories.id })
    .from(itemCategories)
    .where(and(eq(itemCategories.companyId, companyId), eq(itemCategories.code, code), isNull(itemCategories.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (row) throw duplicate('Kode kategori sudah digunakan')
}

async function assertNoConversion(db: Db, companyId: string, itemId: string, fromUnitId: string) {
  const row = await db
    .select({ id: itemUnitConversions.id })
    .from(itemUnitConversions)
    .where(
      and(
        eq(itemUnitConversions.companyId, companyId),
        eq(itemUnitConversions.itemId, itemId),
        eq(itemUnitConversions.fromUnitId, fromUnitId),
        isNull(itemUnitConversions.deletedAt),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (row) throw duplicate('Konversi unit item sudah digunakan')
}

export async function createUnit(db: Db, ctx: InventoryServiceContext, input: CreateUnitInput) {
  await assertNoUnitCode(db, ctx.companyId, input.code)

  try {
    const [unit] = await db
      .insert(units)
      .values({
        companyId: ctx.companyId,
        code: input.code,
        name: input.name,
      })
      .returning()

    return unitDto(unit)
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate('Kode unit sudah digunakan')
    throw error
  }
}

export async function listUnits(db: Db, ctx: InventoryServiceContext, query: ListQuery = {}) {
  const page = pageOf(query)
  const pageSize = pageSizeOf(query)
  const offset = (page - 1) * pageSize
  const conditions = [eq(units.companyId, ctx.companyId), isNull(units.deletedAt)]

  const [{ total }] = await db
    .select({ total: drizzleSql<number>`count(*)::int` })
    .from(units)
    .where(and(...conditions))

  const data = await db
    .select()
    .from(units)
    .where(and(...conditions))
    .orderBy(asc(units.code))
    .limit(pageSize)
    .offset(offset)

  return {
    data: data.map(unitDto),
    meta: { page, page_size: pageSize, total },
  }
}

export async function createCategory(db: Db, ctx: InventoryServiceContext, input: CreateCategoryInput) {
  await assertNoCategoryCode(db, ctx.companyId, input.code)

  try {
    const [category] = await db
      .insert(itemCategories)
      .values({
        companyId: ctx.companyId,
        code: input.code,
        name: input.name,
      })
      .returning()

    return categoryDto(category)
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate('Kode kategori sudah digunakan')
    throw error
  }
}

export async function listCategories(db: Db, ctx: InventoryServiceContext, query: ListQuery = {}) {
  const page = pageOf(query)
  const pageSize = pageSizeOf(query)
  const offset = (page - 1) * pageSize
  const conditions = [eq(itemCategories.companyId, ctx.companyId), isNull(itemCategories.deletedAt)]

  const [{ total }] = await db
    .select({ total: drizzleSql<number>`count(*)::int` })
    .from(itemCategories)
    .where(and(...conditions))

  const data = await db
    .select()
    .from(itemCategories)
    .where(and(...conditions))
    .orderBy(asc(itemCategories.code))
    .limit(pageSize)
    .offset(offset)

  return {
    data: data.map(categoryDto),
    meta: { page, page_size: pageSize, total },
  }
}

export async function createItem(db: Db, ctx: InventoryServiceContext, input: CreateItemInput) {
  await Promise.all([
    getUnitRow(db, ctx.companyId, input.baseUnitId),
    input.categoryId ? getCategoryRow(db, ctx.companyId, input.categoryId) : Promise.resolve(null),
    assertNoItemSku(db, ctx.companyId, input.sku),
  ])

  try {
    const [item] = await db
      .insert(items)
      .values({
        companyId: ctx.companyId,
        sku: input.sku,
        name: input.name,
        categoryId: input.categoryId ?? null,
        baseUnitId: input.baseUnitId,
        pawoonRef: input.pawoonRef ?? null,
      })
      .returning()

    return itemDto(item)
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate('SKU sudah digunakan')
    throw error
  }
}

export async function listItems(db: Db, ctx: InventoryServiceContext, query: ListItemsQuery = {}) {
  const page = pageOf(query)
  const pageSize = pageSizeOf(query)
  const offset = (page - 1) * pageSize

  if (query.categoryId) await getCategoryRow(db, ctx.companyId, query.categoryId)

  const conditions = [eq(items.companyId, ctx.companyId), isNull(items.deletedAt)]
  if (query.categoryId) conditions.push(eq(items.categoryId, query.categoryId))
  if (query.isActive !== undefined) conditions.push(eq(items.isActive, query.isActive))

  const [{ total }] = await db
    .select({ total: drizzleSql<number>`count(*)::int` })
    .from(items)
    .where(and(...conditions))

  const data = await db
    .select()
    .from(items)
    .where(and(...conditions))
    .orderBy(asc(items.sku))
    .limit(pageSize)
    .offset(offset)

  return {
    data: data.map(itemDto),
    meta: { page, page_size: pageSize, total },
  }
}

export async function getItem(db: Db, ctx: InventoryServiceContext, itemId: string) {
  const item = await getItemRow(db, ctx.companyId, itemId)
  const conversions = await db
    .select()
    .from(itemUnitConversions)
    .where(
      and(
        eq(itemUnitConversions.companyId, ctx.companyId),
        eq(itemUnitConversions.itemId, itemId),
        isNull(itemUnitConversions.deletedAt),
      ),
    )
    .orderBy(asc(itemUnitConversions.createdAt))

  return {
    item: itemDto(item),
    conversions: conversions.map(conversionDto),
  }
}

export async function updateItem(db: Db, ctx: InventoryServiceContext, itemId: string, input: UpdateItemInput) {
  await getItemRow(db, ctx.companyId, itemId)
  if (input.categoryId) await getCategoryRow(db, ctx.companyId, input.categoryId)

  const [item] = await db
    .update(items)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(items.id, itemId), eq(items.companyId, ctx.companyId), isNull(items.deletedAt)))
    .returning()

  if (!item) throw outOfScope()
  return itemDto(item)
}

export async function addItemUnitConversion(
  db: Db,
  ctx: InventoryServiceContext,
  itemId: string,
  input: AddConversionInput,
) {
  const factorToBase = normalizeDecimal(input.factorToBase, 'factor_to_base', { allowZero: false })
  await Promise.all([
    getItemRow(db, ctx.companyId, itemId),
    getUnitRow(db, ctx.companyId, input.fromUnitId),
    assertNoConversion(db, ctx.companyId, itemId, input.fromUnitId),
  ])

  try {
    const [conversion] = await db
      .insert(itemUnitConversions)
      .values({
        companyId: ctx.companyId,
        itemId,
        fromUnitId: input.fromUnitId,
        factorToBase,
      })
      .returning()

    return conversionDto(conversion)
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate('Konversi unit item sudah digunakan')
    throw error
  }
}
