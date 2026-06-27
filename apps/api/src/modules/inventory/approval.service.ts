import { and, eq, sql as drizzleSql } from 'drizzle-orm'
import { pendingStockMovements, stockBalances, stockMovements } from '@egg-os/db'
import { ERR } from '../../lib/errors'
import type { Db } from '../../lib/db'
import {
  assertOutletInScope,
  convertToBaseUnit,
  InventoryServiceError,
  lockBalanceRow,
  negateDecimal,
  normalizeDecimal,
  subtractBalanceIfSufficient,
  type InventoryServiceContext,
} from './service'

export type PendingMovementType = 'opname' | 'waste'

export type SubmitApprovalInput = {
  movementType: PendingMovementType
  itemId: string
  outletId: string
  qty: string
  unitId: string
  reason?: string | null
}

type PendingRow = typeof pendingStockMovements.$inferSelect
type StockMovementRow = typeof stockMovements.$inferSelect
type StockBalanceRow = typeof stockBalances.$inferSelect

function outOfScope() {
  return new InventoryServiceError(ERR.OUT_OF_SCOPE.http, ERR.OUT_OF_SCOPE.code, ERR.OUT_OF_SCOPE.message)
}

function conflict(message: string) {
  return new InventoryServiceError(ERR.CONFLICT.http, ERR.CONFLICT.code, message)
}

function selfApproval() {
  return new InventoryServiceError(ERR.SELF_APPROVAL.http, ERR.SELF_APPROVAL.code, ERR.SELF_APPROVAL.message)
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null
}

function pendingDto(row: PendingRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    item_id: row.itemId,
    outlet_id: row.outletId,
    movement_type: row.movementType,
    input_qty: row.inputQty,
    input_unit_id: row.inputUnitId,
    qty_base: row.qtyBase,
    reason: row.reason,
    status: row.status,
    submitted_by: row.submittedBy,
    submitted_at: row.submittedAt.toISOString(),
    validated_by: row.validatedBy,
    validated_at: iso(row.validatedAt),
    finalized_by: row.finalizedBy,
    finalized_at: iso(row.finalizedAt),
    rejected_by: row.rejectedBy,
    rejected_at: iso(row.rejectedAt),
    reject_reason: row.rejectReason,
    finalized_movement_id: row.finalizedMovementId,
    created_at: row.createdAt.toISOString(),
  }
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

async function lockPendingRow(db: Db, ctx: InventoryServiceContext, id: string) {
  const row = await db
    .select()
    .from(pendingStockMovements)
    .where(and(eq(pendingStockMovements.id, id), eq(pendingStockMovements.companyId, ctx.companyId)))
    .for('update')
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) throw outOfScope()
  return row
}

export async function submitApproval(db: Db, ctx: InventoryServiceContext, input: SubmitApprovalInput) {
  if (input.movementType !== 'opname' && input.movementType !== 'waste') {
    throw new InventoryServiceError(
      ERR.VALIDATION.http,
      ERR.VALIDATION.code,
      ERR.VALIDATION.message,
      [{ field: 'movement_type', issue: 'harus opname atau waste' }],
    )
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const allowZero = input.movementType === 'opname'
    const qtyField = input.movementType === 'opname' ? 'counted_qty' : 'qty'
    const inputQty = normalizeDecimal(input.qty, qtyField, { allowZero })

    const { qtyBase } = await convertToBaseUnit(
      txDb,
      ctx.companyId,
      input.itemId,
      inputQty,
      input.unitId,
      { allowZero },
    )

    await assertOutletInScope(txDb, ctx, input.outletId, 'inventory.approval_submit')

    const [pending] = await txDb
      .insert(pendingStockMovements)
      .values({
        companyId: ctx.companyId,
        itemId: input.itemId,
        outletId: input.outletId,
        movementType: input.movementType,
        inputQty,
        inputUnitId: input.unitId,
        qtyBase,
        reason: input.reason ?? null,
        status: 'pending',
        submittedBy: ctx.actorUserId,
      })
      .returning()

    return { pending: pendingDto(pending) }
  })
}

export async function validateApproval(db: Db, ctx: InventoryServiceContext, id: string) {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const row = await lockPendingRow(txDb, ctx, id)

    await assertOutletInScope(txDb, ctx, row.outletId, 'inventory.approval_validate')

    if (row.submittedBy === ctx.actorUserId) throw selfApproval()
    if (row.status !== 'pending') throw conflict('Status bukan pending')

    const [updated] = await txDb
      .update(pendingStockMovements)
      .set({
        status: 'validated',
        validatedBy: ctx.actorUserId,
        validatedAt: new Date(),
      })
      .where(
        and(
          eq(pendingStockMovements.id, id),
          eq(pendingStockMovements.companyId, ctx.companyId),
          eq(pendingStockMovements.status, 'pending'),
        ),
      )
      .returning()

    if (!updated) throw conflict('Status bukan pending')
    return { pending: pendingDto(updated) }
  })
}

export async function finalizeApproval(db: Db, ctx: InventoryServiceContext, id: string) {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const row = await lockPendingRow(txDb, ctx, id)

    await assertOutletInScope(txDb, ctx, row.outletId, 'inventory.approval_finalize')

    if (row.submittedBy === ctx.actorUserId) throw selfApproval()
    if (row.status !== 'validated') throw conflict('Status bukan validated')

    let movement: StockMovementRow
    let balance: StockBalanceRow

    if (row.movementType === 'waste') {
      balance = await subtractBalanceIfSufficient(txDb, ctx, {
        itemId: row.itemId,
        outletId: row.outletId,
        qtyBase: row.qtyBase,
      })

      ;[movement] = await txDb
        .insert(stockMovements)
        .values({
          companyId: ctx.companyId,
          itemId: row.itemId,
          outletId: row.outletId,
          movementType: 'waste',
          qtyBase: negateDecimal(row.qtyBase),
          inputQty: row.inputQty,
          inputUnitId: row.inputUnitId,
          reason: row.reason,
          refNo: null,
          createdBy: ctx.actorUserId,
        })
        .returning()
    } else {
      const currentBase = await lockBalanceRow(txDb, ctx, row.itemId, row.outletId)

      ;[movement] = await txDb
        .insert(stockMovements)
        .values({
          companyId: ctx.companyId,
          itemId: row.itemId,
          outletId: row.outletId,
          movementType: 'opname',
          qtyBase: drizzleSql`(${row.qtyBase}::numeric(18, 6) - ${currentBase}::numeric(18, 6))::numeric(18, 6)`,
          inputQty: row.inputQty,
          inputUnitId: row.inputUnitId,
          reason: row.reason ?? 'stock opname',
          refNo: null,
          createdBy: ctx.actorUserId,
        })
        .returning()

      ;[balance] = await txDb
        .update(stockBalances)
        .set({ qtyBase: row.qtyBase, updatedAt: new Date() })
        .where(
          and(
            eq(stockBalances.companyId, ctx.companyId),
            eq(stockBalances.itemId, row.itemId),
            eq(stockBalances.outletId, row.outletId),
          ),
        )
        .returning()
    }

    const [updated] = await txDb
      .update(pendingStockMovements)
      .set({
        status: 'finalized',
        finalizedBy: ctx.actorUserId,
        finalizedAt: new Date(),
        finalizedMovementId: movement.id,
      })
      .where(
        and(
          eq(pendingStockMovements.id, id),
          eq(pendingStockMovements.companyId, ctx.companyId),
          eq(pendingStockMovements.status, 'validated'),
        ),
      )
      .returning()

    if (!updated) throw conflict('Status bukan validated')

    return {
      pending: pendingDto(updated),
      movement: movementDto(movement),
      balance: balanceDto(balance),
    }
  })
}

export async function rejectApproval(
  db: Db,
  ctx: InventoryServiceContext,
  id: string,
  reason: string | null,
) {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const row = await lockPendingRow(txDb, ctx, id)

    await assertOutletInScope(txDb, ctx, row.outletId, 'inventory.approval_validate')

    if (row.status !== 'pending' && row.status !== 'validated') {
      throw conflict('Status tidak bisa direject')
    }

    const [updated] = await txDb
      .update(pendingStockMovements)
      .set({
        status: 'rejected',
        rejectedBy: ctx.actorUserId,
        rejectedAt: new Date(),
        rejectReason: reason,
      })
      .where(
        and(
          eq(pendingStockMovements.id, id),
          eq(pendingStockMovements.companyId, ctx.companyId),
          drizzleSql`${pendingStockMovements.status} IN ('pending', 'validated')`,
        ),
      )
      .returning()

    if (!updated) throw conflict('Status tidak bisa direject')
    return { pending: pendingDto(updated) }
  })
}
