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
  stockBalances,
  stockMovements,
  units,
  users,
} from '@egg-os/db'
import type { Db } from '../../lib/db'
import type { AccessFilter } from '../rbac/middleware'
import {
  createOpname,
  createStockIn,
  createStockOut,
  createWaste,
  getBalances,
  InventoryServiceError,
  reconcileBalanceWithLedger,
  type InventoryServiceContext,
} from './service'

const sql = postgres(process.env.DATABASE_URL!)
// The schema-aware drizzle test client is structurally compatible with the app Db alias.
const db = drizzle(sql, { schema }) as unknown as Db

const COMPANY_ID = '94000000-0000-4000-8000-000000000001'
const OTHER_COMPANY_ID = '94000000-0000-4000-8000-000000000002'
const BRAND_ID = '94000000-0000-4000-8000-000000000003'
const OTHER_BRAND_ID = '94000000-0000-4000-8000-000000000004'
const OUTLET_A_ID = '94000000-0000-4000-8000-000000000005'
const OUTLET_B_ID = '94000000-0000-4000-8000-000000000006'
const OTHER_OUTLET_ID = '94000000-0000-4000-8000-000000000007'
const ACTOR_USER_ID = '94000000-0000-4000-8000-000000000008'
const OTHER_ACTOR_USER_ID = '94000000-0000-4000-8000-000000000009'

const PCS_UNIT_ID = '94100000-0000-4000-8000-000000000001'
const KARTON_UNIT_ID = '94100000-0000-4000-8000-000000000002'
const GRAM_UNIT_ID = '94100000-0000-4000-8000-000000000003'
const KG_UNIT_ID = '94100000-0000-4000-8000-000000000004'
const OTHER_UNIT_ID = '94100000-0000-4000-8000-000000000005'

const PCS_ITEM_ID = '94200000-0000-4000-8000-000000000001'
const GRAM_ITEM_ID = '94200000-0000-4000-8000-000000000002'
const OTHER_ITEM_ID = '94200000-0000-4000-8000-000000000003'

type PermissionCode =
  | 'inventory.read'
  | 'inventory.stock_in'
  | 'inventory.stock_out'
  | 'inventory.opname'
  | 'inventory.waste'

function accessFilter(permission: PermissionCode, outletId = OUTLET_A_ID): AccessFilter {
  return {
    permission,
    ownOnly: false,
    assignedOnly: false,
    rowLevelScopes: [],
    structuralScopes: [{ scopeType: 'outlet', scopeId: outletId }],
  }
}

function ctx(permission: PermissionCode, outletId = OUTLET_A_ID): InventoryServiceContext {
  return {
    companyId: COMPANY_ID,
    actorUserId: ACTOR_USER_ID,
    accessFilter: accessFilter(permission, outletId),
  }
}

async function cleanupFixtures() {
  await sql`DELETE FROM stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_balances WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM item_unit_conversions WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM items WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM units WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM item_categories WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM users WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM outlets WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM brands WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM companies WHERE id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

async function seedFixtures() {
  await db.insert(companies).values([
    {
      id: COMPANY_ID,
      companyCode: 'INV-SVC',
      companyName: 'Inventory Service Company',
      status: 'active',
    },
    {
      id: OTHER_COMPANY_ID,
      companyCode: 'INV-SVC-B',
      companyName: 'Inventory Service Other Company',
      status: 'active',
    },
  ])

  await db.insert(brands).values([
    {
      id: BRAND_ID,
      companyId: COMPANY_ID,
      brandCode: 'INV-BRAND',
      brandName: 'Inventory Brand',
      status: 'active',
    },
    {
      id: OTHER_BRAND_ID,
      companyId: OTHER_COMPANY_ID,
      brandCode: 'INV-BRAND-B',
      brandName: 'Inventory Brand B',
      status: 'active',
    },
  ])

  await db.insert(outlets).values([
    {
      id: OUTLET_A_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_ID,
      outletCode: 'INV-A',
      outletName: 'Inventory Outlet A',
      status: 'active',
    },
    {
      id: OUTLET_B_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_ID,
      outletCode: 'INV-B',
      outletName: 'Inventory Outlet B',
      status: 'active',
    },
    {
      id: OTHER_OUTLET_ID,
      companyId: OTHER_COMPANY_ID,
      brandId: OTHER_BRAND_ID,
      outletCode: 'INV-OTHER',
      outletName: 'Inventory Other Outlet',
      status: 'active',
    },
  ])

  await db.insert(users).values([
    {
      id: ACTOR_USER_ID,
      companyId: COMPANY_ID,
      email: 'inventory-service-actor@egg.test',
      fullName: 'Inventory Service Actor',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: OTHER_ACTOR_USER_ID,
      companyId: OTHER_COMPANY_ID,
      email: 'inventory-service-other@egg.test',
      fullName: 'Inventory Service Other Actor',
      status: 'active',
      firstLoginRequired: false,
    },
  ])

  await db.insert(units).values([
    { id: PCS_UNIT_ID, companyId: COMPANY_ID, code: 'PCS', name: 'Pieces' },
    { id: KARTON_UNIT_ID, companyId: COMPANY_ID, code: 'KARTON', name: 'Karton' },
    { id: GRAM_UNIT_ID, companyId: COMPANY_ID, code: 'GRAM', name: 'Gram' },
    { id: KG_UNIT_ID, companyId: COMPANY_ID, code: 'KG', name: 'Kilogram' },
    { id: OTHER_UNIT_ID, companyId: OTHER_COMPANY_ID, code: 'PCS', name: 'Other Pieces' },
  ])

  await db.insert(items).values([
    {
      id: PCS_ITEM_ID,
      companyId: COMPANY_ID,
      sku: 'INV-PCS',
      name: 'PCS Item',
      baseUnitId: PCS_UNIT_ID,
    },
    {
      id: GRAM_ITEM_ID,
      companyId: COMPANY_ID,
      sku: 'INV-GRAM',
      name: 'Gram Item',
      baseUnitId: GRAM_UNIT_ID,
    },
    {
      id: OTHER_ITEM_ID,
      companyId: OTHER_COMPANY_ID,
      sku: 'INV-OTHER',
      name: 'Other Item',
      baseUnitId: OTHER_UNIT_ID,
    },
  ])

  await db.insert(itemUnitConversions).values([
    {
      companyId: COMPANY_ID,
      itemId: PCS_ITEM_ID,
      fromUnitId: KARTON_UNIT_ID,
      factorToBase: '24',
    },
    {
      companyId: COMPANY_ID,
      itemId: GRAM_ITEM_ID,
      fromUnitId: KG_UNIT_ID,
      factorToBase: '1000',
    },
  ])
}

async function movementRows(itemId = PCS_ITEM_ID, outletId = OUTLET_A_ID) {
  return db
    .select()
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.companyId, COMPANY_ID),
        eq(stockMovements.itemId, itemId),
        eq(stockMovements.outletId, outletId)
      )
    )
}

async function balanceRow(itemId = PCS_ITEM_ID, outletId = OUTLET_A_ID) {
  return db
    .select()
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
}

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
})

beforeEach(async () => {
  await sql`DELETE FROM stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_balances WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('INV-CORE service ledger logic', () => {
  it('N5 — stock-in 2 KARTON converts to 48 PCS and updates balance', async () => {
    const result = await createStockIn(db, ctx('inventory.stock_in'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      qty: '2',
      unitId: KARTON_UNIT_ID,
    })

    expect(result.movement.movement_type).toBe('stock_in')
    expect(result.movement.qty_base).toBe('48.000000')
    expect(result.balance.qty_base).toBe('48.000000')
  })

  it('N7 — decimal precision converts 1.5 KG to exactly 1500 GRAM', async () => {
    const result = await createStockIn(db, ctx('inventory.stock_in'), {
      itemId: GRAM_ITEM_ID,
      outletId: OUTLET_A_ID,
      qty: '1.5',
      unitId: KG_UNIT_ID,
    })

    expect(result.movement.qty_base).toBe('1500.000000')
    expect(result.balance.qty_base).toBe('1500.000000')
    expect(result.movement.qty_base).not.toContain('0000000000000004')
  })

  it('N9 — stock-out over balance returns ERR_INSUFFICIENT_STOCK and rolls back cleanly', async () => {
    await createStockIn(db, ctx('inventory.stock_in'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      qty: '5',
      unitId: PCS_UNIT_ID,
    })
    const beforeMovements = await movementRows()

    await expect(
      createStockOut(db, ctx('inventory.stock_out'), {
        itemId: PCS_ITEM_ID,
        outletId: OUTLET_A_ID,
        qty: '10',
        unitId: PCS_UNIT_ID,
      })
    ).rejects.toMatchObject({
      status: 422,
      code: 'ERR_INSUFFICIENT_STOCK',
    })

    const afterMovements = await movementRows()
    const balance = await balanceRow()
    expect(afterMovements).toHaveLength(beforeMovements.length)
    expect(balance?.qtyBase).toBe('5.000000')
  })

  it('N11 — opname stores counted-current delta and sets balance to counted qty', async () => {
    await createStockIn(db, ctx('inventory.stock_in'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      qty: '10',
      unitId: PCS_UNIT_ID,
    })

    const result = await createOpname(db, ctx('inventory.opname'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      countedQty: '7',
      unitId: PCS_UNIT_ID,
    })

    expect(result.movement.movement_type).toBe('opname')
    expect(result.movement.qty_base).toBe('-3.000000')
    expect(result.balance.qty_base).toBe('7.000000')
  })

  it('N11b — opname ke 0 catat full negative delta dan kosongin balance', async () => {
    await createStockIn(db, ctx('inventory.stock_in'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      qty: '10',
      unitId: PCS_UNIT_ID,
    })

    const result = await createOpname(db, ctx('inventory.opname'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      countedQty: '0',
      unitId: PCS_UNIT_ID,
    })

    expect(result.movement.qty_base).toBe('-10.000000')
    expect(result.balance.qty_base).toBe('0.000000')
  })

  it('N13 — sum(stock_movements.qty_base) equals stock_balances.qty_base', async () => {
    await createStockIn(db, ctx('inventory.stock_in'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      qty: '2',
      unitId: KARTON_UNIT_ID,
    })
    await createStockOut(db, ctx('inventory.stock_out'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      qty: '10',
      unitId: PCS_UNIT_ID,
    })
    await createWaste(db, ctx('inventory.waste'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      qty: '3',
      unitId: PCS_UNIT_ID,
      reason: 'damaged',
    })
    await createOpname(db, ctx('inventory.opname'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      countedQty: '30',
      unitId: PCS_UNIT_ID,
    })

    const reconciliation = await reconcileBalanceWithLedger(db, { companyId: COMPANY_ID }, PCS_ITEM_ID, OUTLET_A_ID)
    expect(reconciliation).toEqual({
      ledger_qty: '30.000000',
      balance_qty: '30.000000',
      matches: true,
    })
  })

  it('N15 — outlet outside access scope returns 404 ERR_OUT_OF_SCOPE and leaves no movement', async () => {
    await expect(
      createStockIn(db, ctx('inventory.stock_in', OUTLET_A_ID), {
        itemId: PCS_ITEM_ID,
        outletId: OUTLET_B_ID,
        qty: '1',
        unitId: PCS_UNIT_ID,
      })
    ).rejects.toMatchObject({
      status: 404,
      code: 'ERR_OUT_OF_SCOPE',
    })

    await expect(
      createStockIn(db, ctx('inventory.stock_in', OUTLET_A_ID), {
        itemId: OTHER_ITEM_ID,
        outletId: OUTLET_A_ID,
        qty: '1',
        unitId: PCS_UNIT_ID,
      })
    ).rejects.toMatchObject({
      status: 404,
      code: 'ERR_OUT_OF_SCOPE',
    })

    expect(await movementRows()).toHaveLength(0)
  })

  it('rejects missing unit conversion with 422 ERR_VALIDATION before writing movement', async () => {
    await expect(
      createStockIn(db, ctx('inventory.stock_in'), {
        itemId: GRAM_ITEM_ID,
        outletId: OUTLET_A_ID,
        qty: '1',
        unitId: KARTON_UNIT_ID,
      })
    ).rejects.toMatchObject({
      status: 422,
      code: 'ERR_VALIDATION',
    })

    expect(await movementRows(GRAM_ITEM_ID)).toHaveLength(0)
  })

  it('waste decrements balance and rolls back on insufficient stock', async () => {
    await createStockIn(db, ctx('inventory.stock_in'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      qty: '8',
      unitId: PCS_UNIT_ID,
    })

    const waste = await createWaste(db, ctx('inventory.waste'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      qty: '3',
      unitId: PCS_UNIT_ID,
      reason: 'spoilage',
    })
    expect(waste.movement.qty_base).toBe('-3.000000')
    expect(waste.balance.qty_base).toBe('5.000000')

    const beforeMovements = await movementRows()
    await expect(
      createWaste(db, ctx('inventory.waste'), {
        itemId: PCS_ITEM_ID,
        outletId: OUTLET_A_ID,
        qty: '6',
        unitId: PCS_UNIT_ID,
      })
    ).rejects.toBeInstanceOf(InventoryServiceError)

    expect(await movementRows()).toHaveLength(beforeMovements.length)
    expect((await balanceRow())?.qtyBase).toBe('5.000000')
  })

  it('getBalances filters visible outlets by accessFilter scope', async () => {
    await createStockIn(db, ctx('inventory.stock_in'), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_A_ID,
      qty: '5',
      unitId: PCS_UNIT_ID,
    })
    await createStockIn(db, ctx('inventory.stock_in', OUTLET_B_ID), {
      itemId: PCS_ITEM_ID,
      outletId: OUTLET_B_ID,
      qty: '9',
      unitId: PCS_UNIT_ID,
    })

    const result = await getBalances(db, ctx('inventory.read', OUTLET_A_ID))
    expect(result.data.map((row) => row.outlet_id)).toEqual([OUTLET_A_ID])
    expect(result.data[0]?.qty_base).toBe('5.000000')
  })
})
