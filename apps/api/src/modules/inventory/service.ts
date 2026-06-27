import { and, desc, eq, gte, inArray, isNull, lte, sql as drizzleSql } from 'drizzle-orm'
import {
  itemUnitConversions,
  items,
  outlets,
  stockBalances,
  stockMovements,
  units,
} from '@egg-os/db'
import { ERR } from '../../lib/errors'
import type { Db } from '../../lib/db'
import type { AccessFilter } from '../rbac/middleware'
import {
  buildOrgTree,
  scopeCovers,
  type Grant,
  type OrgTree,
  type ResolvedAccess,
  type ScopeRef,
} from '../rbac/resolve'

export type ErrorDetail = { field: string; issue: string }

export type InventoryServiceContext = {
  companyId: string
  actorUserId: string
  access?: ResolvedAccess
  accessFilter?: AccessFilter
}

export type DecimalString = string

export type MovementInput = {
  itemId: string
  outletId: string
  qty: DecimalString
  unitId: string
  reason?: string | null
  refNo?: string | null
}

export type OpnameInput = {
  itemId: string
  outletId: string
  countedQty: DecimalString
  unitId: string
  reason?: string | null
}

export type BalanceQuery = {
  outletId?: string
  itemId?: string
  categoryId?: string
  page?: number
  pageSize?: number
}

export type MovementQuery = {
  outletId?: string
  itemId?: string
  movementType?: 'stock_in' | 'stock_out' | 'opname' | 'waste'
  createdFrom?: Date
  createdTo?: Date
  page?: number
  pageSize?: number
}

type ItemRow = typeof items.$inferSelect
type OutletRow = typeof outlets.$inferSelect
type UnitRow = typeof units.$inferSelect
type StockMovementRow = typeof stockMovements.$inferSelect
type StockBalanceRow = typeof stockBalances.$inferSelect

type LockedBalanceRow = {
  qty_base: string
}

type ReconciliationRow = {
  ledger_qty: string
}

export class InventoryServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[]
  ) {
    super(message)
  }
}

function validation(details: ErrorDetail[]) {
  return new InventoryServiceError(ERR.VALIDATION.http, ERR.VALIDATION.code, ERR.VALIDATION.message, details)
}

function outOfScope() {
  return new InventoryServiceError(ERR.OUT_OF_SCOPE.http, ERR.OUT_OF_SCOPE.code, ERR.OUT_OF_SCOPE.message)
}

function insufficientStock() {
  return new InventoryServiceError(
    ERR.INSUFFICIENT_STOCK.http,
    ERR.INSUFFICIENT_STOCK.code,
    ERR.INSUFFICIENT_STOCK.message
  )
}

function iso(date: Date | null) {
  return date?.toISOString() ?? null
}

function pageOf(query: { page?: number }) {
  return query.page && query.page > 0 ? query.page : 1
}

function pageSizeOf(query: { pageSize?: number }) {
  return query.pageSize && query.pageSize > 0 ? query.pageSize : 50
}

function hasNonZeroDigit(value: string) {
  return /[1-9]/.test(value.replace('.', ''))
}

export function normalizeDecimal(value: string, field: string, options: { allowZero: boolean }) {
  const trimmed = value.trim()
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(trimmed)) {
    throw validation([{ field, issue: 'harus decimal positif dengan maksimal 6 angka di belakang koma' }])
  }

  if (!options.allowZero && !hasNonZeroDigit(trimmed)) {
    throw validation([{ field, issue: 'harus lebih besar dari 0' }])
  }

  return trimmed
}

export function negateDecimal(value: string) {
  if (!hasNonZeroDigit(value)) return value
  return value.startsWith('-') ? value.slice(1) : `-${value}`
}

function movementDto(row: StockMovementRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    item_id: row.itemId,
    outlet_id: row.outletId,
    movement_type: row.movementType,
    qty_base: row.qtyBase,
    input_qty: row.inputQty,
    input_unit_id: row.inputUnitId,
    reason: row.reason,
    ref_no: row.refNo,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
  }
}

function balanceDto(row: StockBalanceRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    item_id: row.itemId,
    outlet_id: row.outletId,
    qty_base: row.qtyBase,
    updated_at: row.updatedAt.toISOString(),
  }
}

function inventoryResult(movement: StockMovementRow, balance: StockBalanceRow) {
  return {
    movement: movementDto(movement),
    balance: balanceDto(balance),
  }
}

function rawRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (typeof result === 'object' && result !== null && 'rows' in result) {
    return (result as { rows: T[] }).rows
  }
  return []
}

async function getItem(db: Db, companyId: string, itemId: string): Promise<ItemRow> {
  const row = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) throw outOfScope()
  return row
}

async function getUnit(db: Db, companyId: string, unitId: string): Promise<UnitRow> {
  const row = await db
    .select()
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.companyId, companyId), isNull(units.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) throw outOfScope()
  return row
}

async function getOutlet(db: Db, companyId: string, outletId: string): Promise<OutletRow> {
  const row = await db
    .select()
    .from(outlets)
    .where(and(eq(outlets.id, outletId), eq(outlets.companyId, companyId), isNull(outlets.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) throw outOfScope()
  return row
}

function permissionScopes(ctx: InventoryServiceContext, permission: string): ScopeRef[] {
  if (ctx.accessFilter?.permission === permission) {
    return ctx.accessFilter.structuralScopes
  }

  if (!ctx.access) return []

  return ctx.access.grants
    .filter((grant) => grant.permission === permission)
    .map(({ scopeType, scopeId }) => ({ scopeType, scopeId }))
}

function outletVisibleWithScopes(scopes: ScopeRef[], permission: string, outletId: string, orgTree: OrgTree) {
  const target = { scopeType: 'outlet' as const, scopeId: outletId }
  return scopes.some((scope) => scopeCovers({ permission, ...scope } as Grant, target, orgTree))
}

export async function assertOutletInScope(db: Db, ctx: InventoryServiceContext, outletId: string, permission: string) {
  const orgTree = await buildOrgTree(db, ctx.companyId)
  const scopes = permissionScopes(ctx, permission)
  if (!outletVisibleWithScopes(scopes, permission, outletId, orgTree)) throw outOfScope()
}

export async function visibleOutletIdsForPermission(db: Db, ctx: InventoryServiceContext, permission: string) {
  const orgTree = await buildOrgTree(db, ctx.companyId)
  const scopes = permissionScopes(ctx, permission)
  if (scopes.length === 0) return []

  return Object.keys(orgTree.outletsById).filter((outletId) => {
    return outletVisibleWithScopes(scopes, permission, outletId, orgTree)
  })
}

async function prepareMovement(
  db: Db,
  ctx: InventoryServiceContext,
  input: MovementInput,
  permission: string
) {
  const [conversion] = await Promise.all([
    convertToBaseUnit(db, ctx.companyId, input.itemId, input.qty, input.unitId),
    getOutlet(db, ctx.companyId, input.outletId),
  ])

  await assertOutletInScope(db, ctx, input.outletId, permission)

  return conversion
}

export async function upsertIncreasedBalance(
  db: Db,
  ctx: InventoryServiceContext,
  input: { itemId: string; outletId: string; qtyBase: string }
) {
  const [balance] = await db
    .insert(stockBalances)
    .values({
      companyId: ctx.companyId,
      itemId: input.itemId,
      outletId: input.outletId,
      qtyBase: input.qtyBase,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [stockBalances.itemId, stockBalances.outletId],
      set: {
        qtyBase: drizzleSql`${stockBalances.qtyBase} + ${input.qtyBase}::numeric(18, 6)`,
        updatedAt: new Date(),
      },
    })
    .returning()

  return balance
}

export async function subtractBalanceIfSufficient(
  db: Db,
  ctx: InventoryServiceContext,
  input: { itemId: string; outletId: string; qtyBase: string }
) {
  const [balance] = await db
    .update(stockBalances)
    .set({
      qtyBase: drizzleSql`${stockBalances.qtyBase} - ${input.qtyBase}::numeric(18, 6)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(stockBalances.companyId, ctx.companyId),
        eq(stockBalances.itemId, input.itemId),
        eq(stockBalances.outletId, input.outletId),
        drizzleSql`${stockBalances.qtyBase} >= ${input.qtyBase}::numeric(18, 6)`
      )
    )
    .returning()

  if (!balance) throw insufficientStock()
  return balance
}

export async function lockBalanceRow(db: Db, ctx: InventoryServiceContext, itemId: string, outletId: string) {
  await db
    .insert(stockBalances)
    .values({
      companyId: ctx.companyId,
      itemId,
      outletId,
      qtyBase: '0',
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [stockBalances.itemId, stockBalances.outletId],
    })

  const result = await db.execute(drizzleSql`
    select qty_base
    from stock_balances
    where company_id = ${ctx.companyId}
      and item_id = ${itemId}
      and outlet_id = ${outletId}
    for update
  `)

  const rows = rawRows<LockedBalanceRow>(result)
  const row = rows[0]
  if (!row) throw outOfScope()
  return row.qty_base
}

export async function convertToBaseUnit(
  db: Db,
  companyId: string,
  itemId: string,
  inputQty: DecimalString,
  inputUnitId: string,
  options: { allowZero?: boolean } = {}
) {
  const qty = normalizeDecimal(inputQty, 'qty', { allowZero: options.allowZero ?? false })
  const [item] = await Promise.all([
    getItem(db, companyId, itemId),
    getUnit(db, companyId, inputUnitId),
  ])

  if (item.baseUnitId === inputUnitId) {
    return {
      item,
      qtyBase: qty,
    }
  }

  const conversion = await db
    .select({
      qtyBase: drizzleSql<string>`(${qty}::numeric(18, 6) * ${itemUnitConversions.factorToBase})::numeric(18, 6)`,
    })
    .from(itemUnitConversions)
    .where(
      and(
        eq(itemUnitConversions.companyId, companyId),
        eq(itemUnitConversions.itemId, itemId),
        eq(itemUnitConversions.fromUnitId, inputUnitId),
        isNull(itemUnitConversions.deletedAt)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!conversion) {
    throw validation([{ field: 'unit_id', issue: 'unit tidak dikonfigurasi untuk item ini' }])
  }

  return {
    item,
    qtyBase: conversion.qtyBase,
  }
}

export async function createStockIn(db: Db, ctx: InventoryServiceContext, input: MovementInput) {
  return db.transaction(async (tx) => {
    // Drizzle's transaction type is structurally compatible with Db but not exported as the same alias.
    const txDb = tx as unknown as Db
    const { qtyBase } = await prepareMovement(txDb, ctx, input, 'inventory.stock_in')

    const [movement] = await txDb
      .insert(stockMovements)
      .values({
        companyId: ctx.companyId,
        itemId: input.itemId,
        outletId: input.outletId,
        movementType: 'stock_in',
        qtyBase,
        inputQty: normalizeDecimal(input.qty, 'qty', { allowZero: false }),
        inputUnitId: input.unitId,
        reason: input.reason ?? null,
        refNo: input.refNo ?? null,
        createdBy: ctx.actorUserId,
      })
      .returning()

    const balance = await upsertIncreasedBalance(txDb, ctx, { itemId: input.itemId, outletId: input.outletId, qtyBase })
    return inventoryResult(movement, balance)
  })
}

async function createNegativeMovement(
  db: Db,
  ctx: InventoryServiceContext,
  input: MovementInput,
  movementType: 'stock_out' | 'waste',
  permission: 'inventory.stock_out' | 'inventory.waste'
) {
  return db.transaction(async (tx) => {
    // Drizzle's transaction type is structurally compatible with Db but not exported as the same alias.
    const txDb = tx as unknown as Db
    const { qtyBase } = await prepareMovement(txDb, ctx, input, permission)
    const balance = await subtractBalanceIfSufficient(txDb, ctx, {
      itemId: input.itemId,
      outletId: input.outletId,
      qtyBase,
    })

    const [movement] = await txDb
      .insert(stockMovements)
      .values({
        companyId: ctx.companyId,
        itemId: input.itemId,
        outletId: input.outletId,
        movementType,
        qtyBase: negateDecimal(qtyBase),
        inputQty: normalizeDecimal(input.qty, 'qty', { allowZero: false }),
        inputUnitId: input.unitId,
        reason: input.reason ?? null,
        refNo: input.refNo ?? null,
        createdBy: ctx.actorUserId,
      })
      .returning()

    return inventoryResult(movement, balance)
  })
}

export async function createStockOut(db: Db, ctx: InventoryServiceContext, input: MovementInput) {
  return createNegativeMovement(db, ctx, input, 'stock_out', 'inventory.stock_out')
}

export async function createWaste(db: Db, ctx: InventoryServiceContext, input: MovementInput) {
  return createNegativeMovement(db, ctx, input, 'waste', 'inventory.waste')
}

export async function applyOpnameToLedger(
  db: Db,
  ctx: InventoryServiceContext,
  input: {
    itemId: string
    outletId: string
    countedBase: string
    inputQty: string
    inputUnitId: string
    reason: string | null
  }
): Promise<{ movement: StockMovementRow; balance: StockBalanceRow }> {
  const currentBase = await lockBalanceRow(db, ctx, input.itemId, input.outletId)

  const [movement] = await db
    .insert(stockMovements)
    .values({
      companyId: ctx.companyId,
      itemId: input.itemId,
      outletId: input.outletId,
      movementType: 'opname',
      qtyBase: drizzleSql`(${input.countedBase}::numeric(18, 6) - ${currentBase}::numeric(18, 6))::numeric(18, 6)`,
      inputQty: input.inputQty,
      inputUnitId: input.inputUnitId,
      reason: input.reason ?? 'stock opname',
      refNo: null,
      createdBy: ctx.actorUserId,
    })
    .returning()

  const [balance] = await db
    .update(stockBalances)
    .set({
      qtyBase: input.countedBase,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(stockBalances.companyId, ctx.companyId),
        eq(stockBalances.itemId, input.itemId),
        eq(stockBalances.outletId, input.outletId)
      )
    )
    .returning()

  return { movement, balance }
}

export async function createOpname(db: Db, ctx: InventoryServiceContext, input: OpnameInput) {
  return db.transaction(async (tx) => {
    // Drizzle's transaction type is structurally compatible with Db but not exported as the same alias.
    const txDb = tx as unknown as Db
    const countedQty = normalizeDecimal(input.countedQty, 'counted_qty', { allowZero: true })
    const [{ qtyBase: countedBase }] = await Promise.all([
      convertToBaseUnit(txDb, ctx.companyId, input.itemId, countedQty, input.unitId, { allowZero: true }),
      getOutlet(txDb, ctx.companyId, input.outletId),
    ])

    await assertOutletInScope(txDb, ctx, input.outletId, 'inventory.opname')
    const { movement, balance } = await applyOpnameToLedger(txDb, ctx, {
      itemId: input.itemId,
      outletId: input.outletId,
      countedBase,
      inputQty: countedQty,
      inputUnitId: input.unitId,
      reason: input.reason ?? null,
    })

    return inventoryResult(movement, balance)
  })
}

export async function getBalances(db: Db, ctx: InventoryServiceContext, query: BalanceQuery = {}) {
  const page = pageOf(query)
  const pageSize = pageSizeOf(query)
  if (query.outletId) await getOutlet(db, ctx.companyId, query.outletId)

  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'inventory.read')

  if (query.outletId && !visibleOutletIds.includes(query.outletId)) {
    throw outOfScope()
  }

  if (visibleOutletIds.length === 0) {
    return {
      data: [],
      meta: {
        page,
        page_size: pageSize,
        total: 0,
      },
    }
  }

  const conditions = [
    eq(stockBalances.companyId, ctx.companyId),
    inArray(stockBalances.outletId, visibleOutletIds),
    isNull(items.deletedAt),
  ]

  if (query.itemId) conditions.push(eq(stockBalances.itemId, query.itemId))
  if (query.outletId) conditions.push(eq(stockBalances.outletId, query.outletId))
  if (query.categoryId) conditions.push(eq(items.categoryId, query.categoryId))

  const [rows, countRows] = await Promise.all([
    db
      .select({ balance: stockBalances })
      .from(stockBalances)
      .innerJoin(items, and(eq(stockBalances.itemId, items.id), eq(items.companyId, ctx.companyId)))
      .where(and(...conditions))
      .orderBy(desc(stockBalances.updatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(stockBalances)
      .innerJoin(items, and(eq(stockBalances.itemId, items.id), eq(items.companyId, ctx.companyId)))
      .where(and(...conditions)),
  ])

  return {
    data: rows.map((row) => balanceDto(row.balance)),
    meta: {
      page,
      page_size: pageSize,
      total: countRows[0]?.count ?? 0,
    },
  }
}

export async function getMovements(db: Db, ctx: InventoryServiceContext, query: MovementQuery = {}) {
  const page = pageOf(query)
  const pageSize = pageSizeOf(query)
  if (query.outletId) await getOutlet(db, ctx.companyId, query.outletId)

  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'inventory.read')

  if (query.outletId && !visibleOutletIds.includes(query.outletId)) {
    throw outOfScope()
  }

  if (visibleOutletIds.length === 0) {
    return {
      data: [],
      meta: {
        page,
        page_size: pageSize,
        total: 0,
      },
    }
  }

  const conditions = [
    eq(stockMovements.companyId, ctx.companyId),
    inArray(stockMovements.outletId, visibleOutletIds),
  ]

  if (query.itemId) conditions.push(eq(stockMovements.itemId, query.itemId))
  if (query.outletId) conditions.push(eq(stockMovements.outletId, query.outletId))
  if (query.movementType) conditions.push(eq(stockMovements.movementType, query.movementType))
  if (query.createdFrom) conditions.push(gte(stockMovements.createdAt, query.createdFrom))
  if (query.createdTo) conditions.push(lte(stockMovements.createdAt, query.createdTo))

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(stockMovements)
      .where(and(...conditions))
      .orderBy(desc(stockMovements.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(stockMovements)
      .where(and(...conditions)),
  ])

  return {
    data: rows.map(movementDto),
    meta: {
      page,
      page_size: pageSize,
      total: countRows[0]?.count ?? 0,
    },
  }
}

export async function reconcileBalanceWithLedger(
  db: Db,
  ctx: Pick<InventoryServiceContext, 'companyId'>,
  itemId: string,
  outletId: string
) {
  const ledgerResult = await db.execute(drizzleSql`
    select coalesce(sum(qty_base), 0)::numeric(18, 6) as ledger_qty
    from stock_movements
    where company_id = ${ctx.companyId}
      and item_id = ${itemId}
      and outlet_id = ${outletId}
  `)
  const ledgerRows = rawRows<ReconciliationRow>(ledgerResult)
  const ledgerQty = ledgerRows[0]?.ledger_qty ?? '0.000000'

  const balance = await db
    .select()
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.companyId, ctx.companyId),
        eq(stockBalances.itemId, itemId),
        eq(stockBalances.outletId, outletId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  const balanceQty = balance?.qtyBase ?? '0.000000'

  return {
    ledger_qty: ledgerQty,
    balance_qty: balanceQty,
    matches: ledgerQty === balanceQty,
  }
}
