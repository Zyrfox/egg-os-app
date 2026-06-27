import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, sql as drizzleSql } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  itemUnitConversions,
  items,
  outlets,
  pendingStockMovements,
  stockBalances,
  stockMovements,
  units,
  users,
} from '@egg-os/db'
import type { Db } from '../../lib/db'
import type { AccessFilter } from '../rbac/middleware'
import {
  finalizeApproval,
  rejectApproval,
  submitApproval,
  validateApproval,
} from './approval.service'
import type { InventoryServiceContext } from './service'

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema }) as unknown as Db

const COMPANY_ID = '98000000-0000-4000-8000-000000000001'
const OTHER_COMPANY_ID = '98000000-0000-4000-8000-000000000002'
const BRAND_ID = '98000000-0000-4000-8000-000000000003'
const OTHER_BRAND_ID = '98000000-0000-4000-8000-000000000004'
const OUTLET_A_ID = '98000000-0000-4000-8000-000000000005'
const OUTLET_OUT_OF_SCOPE_ID = '98000000-0000-4000-8000-000000000006'
const OTHER_OUTLET_ID = '98000000-0000-4000-8000-000000000007'

const SUBMITTER_USER_ID = '98000000-0000-4000-8000-000000000010'
const VALIDATOR_USER_ID = '98000000-0000-4000-8000-000000000011'
const FINALIZER_USER_ID = '98000000-0000-4000-8000-000000000012'
const OTHER_COMPANY_USER_ID = '98000000-0000-4000-8000-000000000013'

const PCS_UNIT_ID = '98100000-0000-4000-8000-000000000001'
const KARTON_UNIT_ID = '98100000-0000-4000-8000-000000000002'
const OTHER_UNIT_ID = '98100000-0000-4000-8000-000000000003'

const ITEM_ID = '98200000-0000-4000-8000-000000000001'
const OTHER_ITEM_ID = '98200000-0000-4000-8000-000000000002'

type ApprovalPermission =
  | 'inventory.approval_submit'
  | 'inventory.approval_validate'
  | 'inventory.approval_finalize'

function accessFilter(permission: ApprovalPermission, outletId = OUTLET_A_ID): AccessFilter {
  return {
    permission,
    ownOnly: false,
    assignedOnly: false,
    rowLevelScopes: [],
    structuralScopes: [{ scopeType: 'outlet', scopeId: outletId }],
  }
}

function ctx(
  userId: string,
  permission: ApprovalPermission,
  outletId = OUTLET_A_ID,
  companyId = COMPANY_ID,
): InventoryServiceContext {
  return {
    companyId,
    actorUserId: userId,
    accessFilter: accessFilter(permission, outletId),
  }
}

async function cleanupFixtures() {
  await sql`DELETE FROM pending_stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_balances WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM item_unit_conversions WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM items WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM units WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM users WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM outlets WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM brands WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM companies WHERE id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

async function seedFixtures() {
  await db.insert(companies).values([
    { id: COMPANY_ID, companyCode: 'APV', companyName: 'Approval Test', status: 'active' },
    { id: OTHER_COMPANY_ID, companyCode: 'APV-OTH', companyName: 'Approval Other', status: 'active' },
  ])

  await db.insert(brands).values([
    { id: BRAND_ID, companyId: COMPANY_ID, brandCode: 'APV-B', brandName: 'Brand', status: 'active' },
    { id: OTHER_BRAND_ID, companyId: OTHER_COMPANY_ID, brandCode: 'APV-OB', brandName: 'Other Brand', status: 'active' },
  ])

  await db.insert(outlets).values([
    { id: OUTLET_A_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'APV-A', outletName: 'Outlet A', status: 'active' },
    { id: OUTLET_OUT_OF_SCOPE_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'APV-OOS', outletName: 'Outlet Out Of Scope', status: 'active' },
    { id: OTHER_OUTLET_ID, companyId: OTHER_COMPANY_ID, brandId: OTHER_BRAND_ID, outletCode: 'APV-OTH', outletName: 'Other Outlet', status: 'active' },
  ])

  await db.insert(users).values([
    { id: SUBMITTER_USER_ID, companyId: COMPANY_ID, email: 'apv-submitter@egg.test', fullName: 'Submitter', status: 'active', firstLoginRequired: false },
    { id: VALIDATOR_USER_ID, companyId: COMPANY_ID, email: 'apv-validator@egg.test', fullName: 'Validator', status: 'active', firstLoginRequired: false },
    { id: FINALIZER_USER_ID, companyId: COMPANY_ID, email: 'apv-finalizer@egg.test', fullName: 'Finalizer', status: 'active', firstLoginRequired: false },
    { id: OTHER_COMPANY_USER_ID, companyId: OTHER_COMPANY_ID, email: 'apv-other@egg.test', fullName: 'Other', status: 'active', firstLoginRequired: false },
  ])

  await db.insert(units).values([
    { id: PCS_UNIT_ID, companyId: COMPANY_ID, code: 'PCS', name: 'Pieces' },
    { id: KARTON_UNIT_ID, companyId: COMPANY_ID, code: 'KARTON', name: 'Karton' },
    { id: OTHER_UNIT_ID, companyId: OTHER_COMPANY_ID, code: 'PCS', name: 'Other Pieces' },
  ])

  await db.insert(items).values([
    { id: ITEM_ID, companyId: COMPANY_ID, sku: 'APV-1', name: 'Approval Item', baseUnitId: PCS_UNIT_ID },
    { id: OTHER_ITEM_ID, companyId: OTHER_COMPANY_ID, sku: 'APV-OTH-1', name: 'Other Item', baseUnitId: OTHER_UNIT_ID },
  ])

  await db.insert(itemUnitConversions).values({
    companyId: COMPANY_ID,
    itemId: ITEM_ID,
    fromUnitId: KARTON_UNIT_ID,
    factorToBase: '24',
  })
}

async function resetState() {
  await sql`DELETE FROM pending_stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_balances WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

async function seedBalance(qtyBase: string) {
  await db.insert(stockBalances).values({
    companyId: COMPANY_ID,
    itemId: ITEM_ID,
    outletId: OUTLET_A_ID,
    qtyBase,
  })
}

async function pendingRow(id: string) {
  return db
    .select()
    .from(pendingStockMovements)
    .where(eq(pendingStockMovements.id, id))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function movementRows() {
  return db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.companyId, COMPANY_ID))
}

async function balanceQty() {
  const row = await db
    .select({ qtyBase: stockBalances.qtyBase })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.companyId, COMPANY_ID),
        eq(stockBalances.itemId, ITEM_ID),
        eq(stockBalances.outletId, OUTLET_A_ID),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return row?.qtyBase ?? null
}

async function submitOpname(counted: string, unitId = PCS_UNIT_ID) {
  const { pending } = await submitApproval(db, ctx(SUBMITTER_USER_ID, 'inventory.approval_submit'), {
    movementType: 'opname',
    itemId: ITEM_ID,
    outletId: OUTLET_A_ID,
    qty: counted,
    unitId,
    reason: 'opname submit',
  })
  return pending
}

async function submitWaste(qty: string, unitId = PCS_UNIT_ID) {
  const { pending } = await submitApproval(db, ctx(SUBMITTER_USER_ID, 'inventory.approval_submit'), {
    movementType: 'waste',
    itemId: ITEM_ID,
    outletId: OUTLET_A_ID,
    qty,
    unitId,
    reason: 'waste submit',
  })
  return pending
}

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
})

beforeEach(async () => {
  await resetState()
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('INV-APPROVAL service', () => {
  it('A1 — submit opname stores pending row with qty_base locked and no ledger touch', async () => {
    await seedBalance('10.000000')

    const pending = await submitOpname('2', KARTON_UNIT_ID)

    expect(pending.status).toBe('pending')
    expect(pending.movement_type).toBe('opname')
    expect(pending.input_qty).toBe('2.000000')
    expect(pending.qty_base).toBe('48.000000')
    expect(pending.submitted_by).toBe(SUBMITTER_USER_ID)
    expect(pending.validated_by).toBeNull()
    expect(pending.finalized_by).toBeNull()
    expect(pending.finalized_movement_id).toBeNull()

    expect(await movementRows()).toHaveLength(0)
    expect(await balanceQty()).toBe('10.000000')
  })

  it('A2 — submit waste stores pending row and does not touch balance', async () => {
    await seedBalance('20.000000')

    const pending = await submitWaste('5')

    expect(pending.status).toBe('pending')
    expect(pending.movement_type).toBe('waste')
    expect(pending.qty_base).toBe('5.000000')

    expect(await movementRows()).toHaveLength(0)
    expect(await balanceQty()).toBe('20.000000')
  })

  it('A3 — validate by different user moves status to validated and keeps balance untouched', async () => {
    await seedBalance('20.000000')
    const submitted = await submitWaste('5')

    const { pending } = await validateApproval(
      db,
      ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'),
      submitted.id,
    )

    expect(pending.status).toBe('validated')
    expect(pending.validated_by).toBe(VALIDATOR_USER_ID)
    expect(pending.validated_at).not.toBeNull()
    expect(await movementRows()).toHaveLength(0)
    expect(await balanceQty()).toBe('20.000000')
  })

  it('A4 — SoD: validator == submitter is rejected with ERR_SELF_APPROVAL and status stays pending', async () => {
    await seedBalance('20.000000')
    const submitted = await submitWaste('5')

    await expect(
      validateApproval(db, ctx(SUBMITTER_USER_ID, 'inventory.approval_validate'), submitted.id),
    ).rejects.toMatchObject({ status: 403, code: 'ERR_SELF_APPROVAL' })

    const after = await pendingRow(submitted.id)
    expect(after?.status).toBe('pending')
    expect(after?.validatedBy).toBeNull()
    expect(after?.validatedAt).toBeNull()
  })

  it('A5 — finalize waste decrements balance, inserts stock_movements, and links finalized_movement_id', async () => {
    await seedBalance('20.000000')
    const submitted = await submitWaste('5')
    await validateApproval(db, ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'), submitted.id)

    const result = await finalizeApproval(
      db,
      ctx(FINALIZER_USER_ID, 'inventory.approval_finalize'),
      submitted.id,
    )

    expect(result.pending.status).toBe('finalized')
    expect(result.pending.finalized_by).toBe(FINALIZER_USER_ID)
    expect(result.pending.finalized_movement_id).toBe(result.movement.id)
    expect(result.movement.movement_type).toBe('waste')
    expect(result.movement.qty_base).toBe('-5.000000')
    expect(result.movement.created_by).toBe(FINALIZER_USER_ID)
    expect(result.balance.qty_base).toBe('15.000000')

    const ledger = await movementRows()
    expect(ledger).toHaveLength(1)
    expect(ledger[0].id).toBe(result.movement.id)
  })

  it('A6 — finalize opname creates delta movement against current balance and sets balance to counted', async () => {
    await seedBalance('10.000000')
    const submitted = await submitOpname('7')
    await validateApproval(db, ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'), submitted.id)

    const result = await finalizeApproval(
      db,
      ctx(FINALIZER_USER_ID, 'inventory.approval_finalize'),
      submitted.id,
    )

    expect(result.pending.status).toBe('finalized')
    expect(result.pending.finalized_movement_id).toBe(result.movement.id)
    expect(result.movement.movement_type).toBe('opname')
    expect(result.movement.qty_base).toBe('-3.000000')
    expect(result.balance.qty_base).toBe('7.000000')
    expect(await balanceQty()).toBe('7.000000')
  })

  it('A6b — finalize opname on item without existing stock_balances row creates row and full delta', async () => {
    // No seedBalance — item has never had a balance row at this outlet.
    const submitted = await submitOpname('20')
    await validateApproval(db, ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'), submitted.id)

    const result = await finalizeApproval(
      db,
      ctx(FINALIZER_USER_ID, 'inventory.approval_finalize'),
      submitted.id,
    )

    expect(result.pending.status).toBe('finalized')
    expect(result.pending.finalized_movement_id).toBe(result.movement.id)
    expect(result.movement.movement_type).toBe('opname')
    expect(result.movement.qty_base).toBe('20.000000')
    expect(result.balance.qty_base).toBe('20.000000')
    expect(await balanceQty()).toBe('20.000000')

    const ledger = await movementRows()
    expect(ledger).toHaveLength(1)
    expect(ledger[0].id).toBe(result.movement.id)
  })

  it('A7 — SoD finalize: finalizer == submitter is rejected and status stays validated', async () => {
    await seedBalance('20.000000')
    const submitted = await submitWaste('5')
    await validateApproval(db, ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'), submitted.id)

    await expect(
      finalizeApproval(db, ctx(SUBMITTER_USER_ID, 'inventory.approval_finalize'), submitted.id),
    ).rejects.toMatchObject({ status: 403, code: 'ERR_SELF_APPROVAL' })

    const after = await pendingRow(submitted.id)
    expect(after?.status).toBe('validated')
    expect(after?.finalizedBy).toBeNull()
    expect(after?.finalizedAt).toBeNull()
    expect(after?.finalizedMovementId).toBeNull()
    expect(await movementRows()).toHaveLength(0)
    expect(await balanceQty()).toBe('20.000000')
  })

  it('A8 — finalize waste with depleted balance throws ERR_INSUFFICIENT_STOCK and rolls back status to validated', async () => {
    await seedBalance('20.000000')
    const submitted = await submitWaste('15')
    await validateApproval(db, ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'), submitted.id)

    // Drain balance between submit and finalize (e.g. another waste/stock-out)
    await sql`UPDATE stock_balances SET qty_base = '5.000000' WHERE item_id = ${ITEM_ID} AND outlet_id = ${OUTLET_A_ID}`

    await expect(
      finalizeApproval(db, ctx(FINALIZER_USER_ID, 'inventory.approval_finalize'), submitted.id),
    ).rejects.toMatchObject({ status: 422, code: 'ERR_INSUFFICIENT_STOCK' })

    const after = await pendingRow(submitted.id)
    expect(after?.status).toBe('validated')
    expect(after?.finalizedBy).toBeNull()
    expect(after?.finalizedAt).toBeNull()
    expect(after?.finalizedMovementId).toBeNull()
    expect(await movementRows()).toHaveLength(0)
    expect(await balanceQty()).toBe('5.000000')
  })

  it('A9 — double finalize on already-finalized row is rejected with ERR_CONFLICT and no second movement', async () => {
    await seedBalance('20.000000')
    const submitted = await submitWaste('5')
    await validateApproval(db, ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'), submitted.id)
    await finalizeApproval(db, ctx(FINALIZER_USER_ID, 'inventory.approval_finalize'), submitted.id)

    await expect(
      finalizeApproval(db, ctx(FINALIZER_USER_ID, 'inventory.approval_finalize'), submitted.id),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })

    expect(await movementRows()).toHaveLength(1)
    expect(await balanceQty()).toBe('15.000000')
  })

  it('A10 — reject from pending and from validated both transition to rejected with no balance change', async () => {
    await seedBalance('20.000000')
    const pendingRowSubmitted = await submitWaste('5')

    const fromPending = await rejectApproval(
      db,
      ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'),
      pendingRowSubmitted.id,
      'salah input',
    )
    expect(fromPending.pending.status).toBe('rejected')
    expect(fromPending.pending.rejected_by).toBe(VALIDATOR_USER_ID)
    expect(fromPending.pending.reject_reason).toBe('salah input')

    const validatedSubmitted = await submitWaste('3')
    await validateApproval(db, ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'), validatedSubmitted.id)

    const fromValidated = await rejectApproval(
      db,
      ctx(FINALIZER_USER_ID, 'inventory.approval_validate'),
      validatedSubmitted.id,
      'revisi',
    )
    expect(fromValidated.pending.status).toBe('rejected')
    expect(fromValidated.pending.rejected_by).toBe(FINALIZER_USER_ID)

    expect(await movementRows()).toHaveLength(0)
    expect(await balanceQty()).toBe('20.000000')
  })

  it('A11 — validate a row that is already validated returns ERR_CONFLICT', async () => {
    await seedBalance('20.000000')
    const submitted = await submitWaste('5')
    await validateApproval(db, ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'), submitted.id)

    await expect(
      validateApproval(db, ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'), submitted.id),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
  })

  it('A12 — submit to an outlet outside scope returns ERR_OUT_OF_SCOPE', async () => {
    await expect(
      submitApproval(db, ctx(SUBMITTER_USER_ID, 'inventory.approval_submit'), {
        movementType: 'waste',
        itemId: ITEM_ID,
        outletId: OUTLET_OUT_OF_SCOPE_ID,
        qty: '5',
        unitId: PCS_UNIT_ID,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'ERR_OUT_OF_SCOPE' })

    const rows = await db
      .select()
      .from(pendingStockMovements)
      .where(eq(pendingStockMovements.companyId, COMPANY_ID))
    expect(rows).toHaveLength(0)
  })

  it('A13 — reconcile after finalize: sum(stock_movements) == stock_balances per (item,outlet)', async () => {
    await seedBalance('20.000000')

    const wasteSubmitted = await submitWaste('4')
    await validateApproval(db, ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'), wasteSubmitted.id)
    await finalizeApproval(db, ctx(FINALIZER_USER_ID, 'inventory.approval_finalize'), wasteSubmitted.id)

    const opnameSubmitted = await submitOpname('10')
    await validateApproval(db, ctx(VALIDATOR_USER_ID, 'inventory.approval_validate'), opnameSubmitted.id)
    await finalizeApproval(db, ctx(FINALIZER_USER_ID, 'inventory.approval_finalize'), opnameSubmitted.id)

    // Seed the +20 history that produced the starting balance so the ledger sum equals the balance.
    await db.insert(stockMovements).values({
      companyId: COMPANY_ID,
      itemId: ITEM_ID,
      outletId: OUTLET_A_ID,
      movementType: 'stock_in',
      qtyBase: '20.000000',
      inputQty: '20.000000',
      inputUnitId: PCS_UNIT_ID,
      reason: 'seed history',
      refNo: null,
      createdBy: SUBMITTER_USER_ID,
    })

    const result = await sql`
      SELECT
        COALESCE(SUM(m.qty_base), 0)::numeric(18, 6) AS ledger_qty,
        (
          SELECT qty_base FROM stock_balances
          WHERE company_id = ${COMPANY_ID} AND item_id = ${ITEM_ID} AND outlet_id = ${OUTLET_A_ID}
        ) AS balance_qty
      FROM stock_movements m
      WHERE m.company_id = ${COMPANY_ID} AND m.item_id = ${ITEM_ID} AND m.outlet_id = ${OUTLET_A_ID}
    `
    const row = result[0] as { ledger_qty: string; balance_qty: string }
    expect(row.balance_qty).toBe('10.000000')
    expect(row.ledger_qty).toBe(row.balance_qty)
  })

  it('A14 — cross-company access to a pending row returns ERR_OUT_OF_SCOPE', async () => {
    await seedBalance('20.000000')
    const submitted = await submitWaste('5')

    const otherCtx: InventoryServiceContext = {
      companyId: OTHER_COMPANY_ID,
      actorUserId: OTHER_COMPANY_USER_ID,
      accessFilter: {
        permission: 'inventory.approval_validate',
        ownOnly: false,
        assignedOnly: false,
        rowLevelScopes: [],
        structuralScopes: [{ scopeType: 'outlet', scopeId: OTHER_OUTLET_ID }],
      },
    }

    await expect(validateApproval(db, otherCtx, submitted.id)).rejects.toMatchObject({
      status: 404,
      code: 'ERR_OUT_OF_SCOPE',
    })
    await expect(finalizeApproval(db, otherCtx, submitted.id)).rejects.toMatchObject({
      status: 404,
      code: 'ERR_OUT_OF_SCOPE',
    })
    await expect(rejectApproval(db, otherCtx, submitted.id, 'cross')).rejects.toMatchObject({
      status: 404,
      code: 'ERR_OUT_OF_SCOPE',
    })

    const after = await pendingRow(submitted.id)
    expect(after?.status).toBe('pending')
  })
})

// Hint to keep the drizzle-orm import "used" if codepaths trim references later.
void drizzleSql
