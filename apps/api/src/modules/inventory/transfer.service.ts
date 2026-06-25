import { and, eq, isNull } from 'drizzle-orm'
import { outlets, stockBalances, stockMovements, stockTransfers } from '@egg-os/db'
import { ERR } from '../../lib/errors'
import type { Db } from '../../lib/db'
import {
  assertOutletInScope,
  convertToBaseUnit,
  InventoryServiceError,
  negateDecimal,
  normalizeDecimal,
  subtractBalanceIfSufficient,
  upsertIncreasedBalance,
  type ErrorDetail,
  type InventoryServiceContext,
} from './service'

export type TransferInput = {
  itemId: string
  fromOutletId: string
  toOutletId: string
  qty: string
  unitId: string
  refNo?: string | null
  reason?: string | null
}

type OutletRow = typeof outlets.$inferSelect
type StockTransferRow = typeof stockTransfers.$inferSelect
type StockMovementRow = typeof stockMovements.$inferSelect
type StockBalanceRow = typeof stockBalances.$inferSelect

function validation(details: ErrorDetail[]) {
  return new InventoryServiceError(ERR.VALIDATION.http, ERR.VALIDATION.code, ERR.VALIDATION.message, details)
}

function outOfScope() {
  return new InventoryServiceError(404, 'ERR_OUT_OF_SCOPE', 'Data di luar cakupan Anda')
}

function alreadyReceived() {
  return new InventoryServiceError(
    ERR.ALREADY_RECEIVED.http,
    ERR.ALREADY_RECEIVED.code,
    ERR.ALREADY_RECEIVED.message
  )
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

function transferDto(row: StockTransferRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    from_outlet_id: row.fromOutletId,
    to_outlet_id: row.toOutletId,
    item_id: row.itemId,
    qty_base: row.qtyBase,
    input_qty: row.inputQty,
    input_unit_id: row.inputUnitId,
    status: row.status,
    ref_no: row.refNo,
    reason: row.reason,
    sent_by: row.sentBy,
    sent_at: row.sentAt.toISOString(),
    received_by: row.receivedBy,
    received_at: row.receivedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  }
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

async function getRealOutlet(db: Db, companyId: string, outletId: string, field: string) {
  const outlet = await getOutlet(db, companyId, outletId)
  if (outlet.outletType === 'in_transit') {
    throw validation([{ field, issue: 'outlet in-transit hanya untuk proses internal transfer' }])
  }
  return outlet
}

async function getTransfer(db: Db, companyId: string, transferId: string) {
  const row = await db
    .select()
    .from(stockTransfers)
    .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.companyId, companyId)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) throw outOfScope()
  return row
}

export async function resolveInTransitOutlet(db: Db, companyId: string) {
  const row = await db
    .select({ id: outlets.id })
    .from(outlets)
    .where(and(eq(outlets.companyId, companyId), eq(outlets.outletType, 'in_transit'), isNull(outlets.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) {
    throw validation([{ field: 'in_transit_outlet', issue: 'outlet in-transit company belum tersedia' }])
  }

  return row.id
}

function assertDifferentOutlets(fromOutletId: string, toOutletId: string) {
  if (fromOutletId === toOutletId) {
    throw validation([{ field: 'to_outlet_id', issue: 'tujuan transfer harus berbeda dari outlet asal' }])
  }
}

export async function createTransfer(db: Db, ctx: InventoryServiceContext, input: TransferInput) {
  return db.transaction(async (tx) => {
    // Drizzle's transaction type is structurally compatible with Db but not exported as the same alias.
    const txDb = tx as unknown as Db
    assertDifferentOutlets(input.fromOutletId, input.toOutletId)

    const [{ qtyBase }, fromOutlet, toOutlet] = await Promise.all([
      convertToBaseUnit(txDb, ctx.companyId, input.itemId, input.qty, input.unitId),
      getRealOutlet(txDb, ctx.companyId, input.fromOutletId, 'from_outlet_id'),
      getRealOutlet(txDb, ctx.companyId, input.toOutletId, 'to_outlet_id'),
    ])
    await assertOutletInScope(txDb, ctx, fromOutlet.id, 'inventory.transfer_send')
    const inTransitOutletId = await resolveInTransitOutlet(txDb, ctx.companyId)

    const fromBalance = await subtractBalanceIfSufficient(txDb, ctx, {
      itemId: input.itemId,
      outletId: fromOutlet.id,
      qtyBase,
    })
    const inTransitBalance = await upsertIncreasedBalance(txDb, ctx, {
      itemId: input.itemId,
      outletId: inTransitOutletId,
      qtyBase,
    })
    const inputQty = normalizeDecimal(input.qty, 'qty', { allowZero: false })
    const now = new Date()

    const [fromMovement, inTransitMovement] = await txDb
      .insert(stockMovements)
      .values([
        {
          companyId: ctx.companyId,
          itemId: input.itemId,
          outletId: fromOutlet.id,
          movementType: 'transfer_out',
          qtyBase: negateDecimal(qtyBase),
          inputQty,
          inputUnitId: input.unitId,
          reason: input.reason ?? null,
          refNo: input.refNo ?? null,
          createdBy: ctx.actorUserId,
        },
        {
          companyId: ctx.companyId,
          itemId: input.itemId,
          outletId: inTransitOutletId,
          movementType: 'transfer_in',
          qtyBase,
          inputQty,
          inputUnitId: input.unitId,
          reason: input.reason ?? null,
          refNo: input.refNo ?? null,
          createdBy: ctx.actorUserId,
        },
      ])
      .returning()

    const [transfer] = await txDb
      .insert(stockTransfers)
      .values({
        companyId: ctx.companyId,
        fromOutletId: fromOutlet.id,
        toOutletId: toOutlet.id,
        itemId: input.itemId,
        qtyBase,
        inputQty,
        inputUnitId: input.unitId,
        status: 'pending',
        refNo: input.refNo ?? null,
        reason: input.reason ?? null,
        sentBy: ctx.actorUserId,
        sentAt: now,
        createdAt: now,
      })
      .returning()

    return {
      transfer: transferDto(transfer),
      movements: [movementDto(fromMovement), movementDto(inTransitMovement)],
      balances: {
        from: balanceDto(fromBalance),
        in_transit: balanceDto(inTransitBalance),
      },
    }
  })
}

export async function receiveTransfer(db: Db, ctx: InventoryServiceContext, transferId: string) {
  return db.transaction(async (tx) => {
    // Drizzle's transaction type is structurally compatible with Db but not exported as the same alias.
    const txDb = tx as unknown as Db
    const transferBefore = await getTransfer(txDb, ctx.companyId, transferId)
    await getRealOutlet(txDb, ctx.companyId, transferBefore.toOutletId, 'to_outlet_id')
    await assertOutletInScope(txDb, ctx, transferBefore.toOutletId, 'inventory.transfer_receive')
    const inTransitOutletId = await resolveInTransitOutlet(txDb, ctx.companyId)
    const receivedAt = new Date()

    const [transfer] = await txDb
      .update(stockTransfers)
      .set({
        status: 'received',
        receivedBy: ctx.actorUserId,
        receivedAt,
      })
      .where(
        and(
          eq(stockTransfers.id, transferId),
          eq(stockTransfers.companyId, ctx.companyId),
          eq(stockTransfers.status, 'pending')
        )
      )
      .returning()

    if (!transfer) throw alreadyReceived()

    const inTransitBalance = await subtractBalanceIfSufficient(txDb, ctx, {
      itemId: transfer.itemId,
      outletId: inTransitOutletId,
      qtyBase: transfer.qtyBase,
    })
    const toBalance = await upsertIncreasedBalance(txDb, ctx, {
      itemId: transfer.itemId,
      outletId: transfer.toOutletId,
      qtyBase: transfer.qtyBase,
    })

    const [inTransitMovement, toMovement] = await txDb
      .insert(stockMovements)
      .values([
        {
          companyId: ctx.companyId,
          itemId: transfer.itemId,
          outletId: inTransitOutletId,
          movementType: 'transfer_out',
          qtyBase: negateDecimal(transfer.qtyBase),
          inputQty: transfer.inputQty,
          inputUnitId: transfer.inputUnitId,
          reason: transfer.reason,
          refNo: transfer.refNo,
          createdBy: ctx.actorUserId,
        },
        {
          companyId: ctx.companyId,
          itemId: transfer.itemId,
          outletId: transfer.toOutletId,
          movementType: 'transfer_in',
          qtyBase: transfer.qtyBase,
          inputQty: transfer.inputQty,
          inputUnitId: transfer.inputUnitId,
          reason: transfer.reason,
          refNo: transfer.refNo,
          createdBy: ctx.actorUserId,
        },
      ])
      .returning()

    return {
      transfer: transferDto(transfer),
      movements: [movementDto(inTransitMovement), movementDto(toMovement)],
      balances: {
        in_transit: balanceDto(inTransitBalance),
        to: balanceDto(toBalance),
      },
    }
  })
}
