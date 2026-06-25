import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  itemUnitConversions,
  items,
  outlets,
  stockBalances,
  stockMovements,
  stockTransfers,
  units,
  users,
} from '@egg-os/db'
import type { Db } from '../../lib/db'
import type { AccessFilter } from '../rbac/middleware'
import type { InventoryServiceContext } from './service'
import { createTransfer, receiveTransfer } from './transfer.service'

const sql = postgres(process.env.DATABASE_URL!)
// The schema-aware drizzle test client is structurally compatible with the app Db alias.
const db = drizzle(sql, { schema }) as unknown as Db

const COMPANY_ID = '97000000-0000-4000-8000-000000000001'
const OTHER_COMPANY_ID = '97000000-0000-4000-8000-000000000002'
const BRAND_ID = '97000000-0000-4000-8000-000000000003'
const OTHER_BRAND_ID = '97000000-0000-4000-8000-000000000004'
const OUTLET_A_ID = '97000000-0000-4000-8000-000000000005'
const OUTLET_B_ID = '97000000-0000-4000-8000-000000000006'
const IN_TRANSIT_OUTLET_ID = '97000000-0000-4000-8000-000000000007'
const OTHER_OUTLET_ID = '97000000-0000-4000-8000-000000000008'
const ACTOR_USER_ID = '97000000-0000-4000-8000-000000000009'
const RECEIVER_USER_ID = '97000000-0000-4000-8000-000000000010'
const MISSING_USER_ID = '97000000-0000-4000-8000-000000000099'

const PCS_UNIT_ID = '97100000-0000-4000-8000-000000000001'
const KARTON_UNIT_ID = '97100000-0000-4000-8000-000000000002'
const OTHER_UNIT_ID = '97100000-0000-4000-8000-000000000003'

const ITEM_ID = '97200000-0000-4000-8000-000000000001'
const OTHER_ITEM_ID = '97200000-0000-4000-8000-000000000002'

function accessFilter(permission: string, outletId: string): AccessFilter {
  return {
    permission,
    ownOnly: false,
    assignedOnly: false,
    rowLevelScopes: [],
    structuralScopes: [{ scopeType: 'outlet', scopeId: outletId }],
  }
}

function ctx(permission: string, outletId: string, actorUserId = ACTOR_USER_ID): InventoryServiceContext {
  return {
    companyId: COMPANY_ID,
    actorUserId,
    accessFilter: accessFilter(permission, outletId),
  }
}

async function cleanupFixtures() {
  await sql`DELETE FROM stock_transfers WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
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
    {
      id: COMPANY_ID,
      companyCode: 'INV-XFER',
      companyName: 'Inventory Transfer Company',
      status: 'active',
    },
    {
      id: OTHER_COMPANY_ID,
      companyCode: 'INV-XFER-B',
      companyName: 'Inventory Transfer Other Company',
      status: 'active',
    },
  ])

  await db.insert(brands).values([
    {
      id: BRAND_ID,
      companyId: COMPANY_ID,
      brandCode: 'XFER-BRAND',
      brandName: 'Transfer Brand',
      status: 'active',
    },
    {
      id: OTHER_BRAND_ID,
      companyId: OTHER_COMPANY_ID,
      brandCode: 'XFER-BRAND-B',
      brandName: 'Transfer Brand B',
      status: 'active',
    },
  ])

  await db.insert(outlets).values([
    {
      id: OUTLET_A_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_ID,
      outletCode: 'XFER-A',
      outletName: 'Transfer Outlet A',
      status: 'active',
    },
    {
      id: OUTLET_B_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_ID,
      outletCode: 'XFER-B',
      outletName: 'Transfer Outlet B',
      status: 'active',
    },
    {
      id: IN_TRANSIT_OUTLET_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_ID,
      outletCode: 'XFER-IN-TRANSIT',
      outletName: 'Transfer In-Transit',
      outletType: 'in_transit',
      status: 'active',
      metadata: { system: true, virtual: 'in_transit' },
    },
    {
      id: OTHER_OUTLET_ID,
      companyId: OTHER_COMPANY_ID,
      brandId: OTHER_BRAND_ID,
      outletCode: 'XFER-OTHER',
      outletName: 'Transfer Other Outlet',
      status: 'active',
    },
  ])

  await db.insert(users).values([
    {
      id: ACTOR_USER_ID,
      companyId: COMPANY_ID,
      email: 'inventory-transfer-sender@egg.test',
      fullName: 'Inventory Transfer Sender',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: RECEIVER_USER_ID,
      companyId: COMPANY_ID,
      email: 'inventory-transfer-receiver@egg.test',
      fullName: 'Inventory Transfer Receiver',
      status: 'active',
      firstLoginRequired: false,
    },
  ])

  await db.insert(units).values([
    { id: PCS_UNIT_ID, companyId: COMPANY_ID, code: 'PCS', name: 'Pieces' },
    { id: KARTON_UNIT_ID, companyId: COMPANY_ID, code: 'KARTON', name: 'Karton' },
    { id: OTHER_UNIT_ID, companyId: OTHER_COMPANY_ID, code: 'PCS', name: 'Other Pieces' },
  ])

  await db.insert(items).values([
    {
      id: ITEM_ID,
      companyId: COMPANY_ID,
      sku: 'XFER-PCS',
      name: 'Transfer PCS Item',
      baseUnitId: PCS_UNIT_ID,
    },
    {
      id: OTHER_ITEM_ID,
      companyId: OTHER_COMPANY_ID,
      sku: 'XFER-OTHER',
      name: 'Transfer Other Item',
      baseUnitId: OTHER_UNIT_ID,
    },
  ])

  await db.insert(itemUnitConversions).values({
    companyId: COMPANY_ID,
    itemId: ITEM_ID,
    fromUnitId: KARTON_UNIT_ID,
    factorToBase: '24',
  })
}

async function clearLedger() {
  await sql`DELETE FROM stock_transfers WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_balances WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

async function setBalance(outletId: string, qtyBase: string, itemId = ITEM_ID) {
  await db.insert(stockBalances).values({
    companyId: COMPANY_ID,
    itemId,
    outletId,
    qtyBase,
    updatedAt: new Date(),
  })
}

async function balanceQty(outletId: string, itemId = ITEM_ID) {
  const row = await db
    .select({ qtyBase: stockBalances.qtyBase })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.companyId, COMPANY_ID),
        eq(stockBalances.itemId, itemId),
        eq(stockBalances.outletId, outletId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return row?.qtyBase ?? '0.000000'
}

async function movements() {
  return db
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.companyId, COMPANY_ID), eq(stockMovements.itemId, ITEM_ID)))
}

async function transfers() {
  return db
    .select()
    .from(stockTransfers)
    .where(and(eq(stockTransfers.companyId, COMPANY_ID), eq(stockTransfers.itemId, ITEM_ID)))
}

async function transferRow(id: string) {
  return db
    .select()
    .from(stockTransfers)
    .where(and(eq(stockTransfers.companyId, COMPANY_ID), eq(stockTransfers.id, id)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function systemQty() {
  const [row] = await sql<{ total: string }[]>`
    select coalesce(sum(qty_base), 0)::numeric(18, 6) as total
    from stock_balances
    where company_id = ${COMPANY_ID}
      and item_id = ${ITEM_ID}
      and outlet_id in (${OUTLET_A_ID}, ${OUTLET_B_ID}, ${IN_TRANSIT_OUTLET_ID})
  `
  return row?.total ?? '0.000000'
}

async function transferInput(refNo = 'TRF-001') {
  return {
    itemId: ITEM_ID,
    fromOutletId: OUTLET_A_ID,
    toOutletId: OUTLET_B_ID,
    qty: '2',
    unitId: KARTON_UNIT_ID,
    refNo,
    reason: 'transfer test',
  }
}

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
})

beforeEach(async () => {
  await clearLedger()
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('INV-FLOW transfer service', () => {
  it('T1 — kirim sukses moves 2 KARTON from outlet A into in-transit', async () => {
    await setBalance(OUTLET_A_ID, '100.000000')

    const result = await createTransfer(db, ctx('inventory.transfer_send', OUTLET_A_ID), await transferInput())

    expect(result.transfer.status).toBe('pending')
    expect(result.transfer.qty_base).toBe('48.000000')
    expect(result.transfer.sent_by).toBe(ACTOR_USER_ID)
    expect(result.movements.map((movement) => [movement.movement_type, movement.outlet_id, movement.qty_base])).toEqual([
      ['transfer_out', OUTLET_A_ID, '-48.000000'],
      ['transfer_in', IN_TRANSIT_OUTLET_ID, '48.000000'],
    ])
    expect(await balanceQty(OUTLET_A_ID)).toBe('52.000000')
    expect(await balanceQty(IN_TRANSIT_OUTLET_ID)).toBe('48.000000')
  })

  it('T2 — terima sukses moves transfer from in-transit into outlet B', async () => {
    await setBalance(OUTLET_A_ID, '100.000000')
    const sent = await createTransfer(db, ctx('inventory.transfer_send', OUTLET_A_ID), await transferInput())

    const received = await receiveTransfer(
      db,
      ctx('inventory.transfer_receive', OUTLET_B_ID, RECEIVER_USER_ID),
      sent.transfer.id
    )

    expect(received.transfer.status).toBe('received')
    expect(received.transfer.received_by).toBe(RECEIVER_USER_ID)
    expect(received.transfer.received_at).not.toBeNull()
    expect(received.movements.map((movement) => [movement.movement_type, movement.outlet_id, movement.qty_base])).toEqual([
      ['transfer_out', IN_TRANSIT_OUTLET_ID, '-48.000000'],
      ['transfer_in', OUTLET_B_ID, '48.000000'],
    ])
    expect(await balanceQty(IN_TRANSIT_OUTLET_ID)).toBe('0.000000')
    expect(await balanceQty(OUTLET_B_ID)).toBe('48.000000')
  })

  it('T3 — invariant total qty stays constant while pending and after received', async () => {
    await setBalance(OUTLET_A_ID, '100.000000')
    await setBalance(OUTLET_B_ID, '5.000000')
    const before = await systemQty()

    const sent = await createTransfer(db, ctx('inventory.transfer_send', OUTLET_A_ID), await transferInput())
    expect(await systemQty()).toBe(before)

    await receiveTransfer(db, ctx('inventory.transfer_receive', OUTLET_B_ID, RECEIVER_USER_ID), sent.transfer.id)
    expect(await systemQty()).toBe(before)
    expect(await balanceQty(IN_TRANSIT_OUTLET_ID)).toBe('0.000000')
  })

  it('T4 — saldo kurang saat kirim rolls back movement, balance, and transfer rows', async () => {
    await setBalance(OUTLET_A_ID, '10.000000')

    await expect(
      createTransfer(db, ctx('inventory.transfer_send', OUTLET_A_ID), await transferInput())
    ).rejects.toMatchObject({
      status: 422,
      code: 'ERR_INSUFFICIENT_STOCK',
    })

    expect(await movements()).toHaveLength(0)
    expect(await transfers()).toHaveLength(0)
    expect(await balanceQty(OUTLET_A_ID)).toBe('10.000000')
    expect(await balanceQty(IN_TRANSIT_OUTLET_ID)).toBe('0.000000')
  })

  it('T5 — double receive returns ERR_ALREADY_RECEIVED without duplicate movement or balance', async () => {
    await setBalance(OUTLET_A_ID, '100.000000')
    const sent = await createTransfer(db, ctx('inventory.transfer_send', OUTLET_A_ID), await transferInput())
    await receiveTransfer(db, ctx('inventory.transfer_receive', OUTLET_B_ID, RECEIVER_USER_ID), sent.transfer.id)
    const movementCount = (await movements()).length

    await expect(
      receiveTransfer(db, ctx('inventory.transfer_receive', OUTLET_B_ID, RECEIVER_USER_ID), sent.transfer.id)
    ).rejects.toMatchObject({
      status: 422,
      code: 'ERR_ALREADY_RECEIVED',
    })

    expect(await movements()).toHaveLength(movementCount)
    expect(await balanceQty(OUTLET_B_ID)).toBe('48.000000')
    expect(await balanceQty(IN_TRANSIT_OUTLET_ID)).toBe('0.000000')
  })

  it('T6 — scope and tenant checks reject unauthorized or cross-company transfer operations', async () => {
    await setBalance(OUTLET_A_ID, '100.000000')

    await expect(
      createTransfer(db, ctx('inventory.transfer_send', OUTLET_B_ID), await transferInput())
    ).rejects.toMatchObject({
      status: 404,
      code: 'ERR_OUT_OF_SCOPE',
    })

    const sent = await createTransfer(db, ctx('inventory.transfer_send', OUTLET_A_ID), await transferInput('TRF-SCOPE'))
    await expect(
      receiveTransfer(db, ctx('inventory.transfer_receive', OUTLET_A_ID, RECEIVER_USER_ID), sent.transfer.id)
    ).rejects.toMatchObject({
      status: 404,
      code: 'ERR_OUT_OF_SCOPE',
    })
    expect((await transferRow(sent.transfer.id))?.status).toBe('pending')
    expect(await movements()).toHaveLength(2)

    await expect(
      createTransfer(db, ctx('inventory.transfer_send', OUTLET_A_ID), {
        ...(await transferInput('TRF-CROSS')),
        toOutletId: OTHER_OUTLET_ID,
      })
    ).rejects.toMatchObject({
      status: 404,
      code: 'ERR_OUT_OF_SCOPE',
    })
  })

  it('T7 — fase kirim is atomic when a later movement insert fails', async () => {
    await setBalance(OUTLET_A_ID, '60.000000')

    await expect(
      createTransfer(db, ctx('inventory.transfer_send', OUTLET_A_ID, MISSING_USER_ID), await transferInput())
    ).rejects.toBeTruthy()

    expect(await movements()).toHaveLength(0)
    expect(await transfers()).toHaveLength(0)
    expect(await balanceQty(OUTLET_A_ID)).toBe('60.000000')
    expect(await balanceQty(IN_TRANSIT_OUTLET_ID)).toBe('0.000000')
  })

  it('T8 — same-outlet and in-transit-as-input are rejected', async () => {
    await setBalance(OUTLET_A_ID, '100.000000')

    await expect(
      createTransfer(db, ctx('inventory.transfer_send', OUTLET_A_ID), {
        ...(await transferInput('TRF-SAME')),
        toOutletId: OUTLET_A_ID,
      })
    ).rejects.toMatchObject({
      status: 422,
      code: 'ERR_VALIDATION',
    })

    await expect(
      createTransfer(db, ctx('inventory.transfer_send', IN_TRANSIT_OUTLET_ID), {
        ...(await transferInput('TRF-INTERNAL')),
        fromOutletId: IN_TRANSIT_OUTLET_ID,
      })
    ).rejects.toMatchObject({
      status: 422,
      code: 'ERR_VALIDATION',
    })

    expect(await movements()).toHaveLength(0)
    expect(await transfers()).toHaveLength(0)
  })
})
