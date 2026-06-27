import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  itemUnitConversions,
  items,
  outlets,
  pendingStockMovements,
  permissions,
  rolePermissions,
  roles,
  stockBalances,
  stockMovements,
  stockTransfers,
  units,
  userRoles,
  users,
} from '@egg-os/db'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import type { TestResponseBody } from '../../test/types'

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars'
const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
}

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

const COMPANY_ID = '96000000-0000-4000-8000-000000000001'
const OTHER_COMPANY_ID = '96000000-0000-4000-8000-000000000002'
const BRAND_ID = '96000000-0000-4000-8000-000000000003'
const OTHER_BRAND_ID = '96000000-0000-4000-8000-000000000004'
const OUTLET_A_ID = '96000000-0000-4000-8000-000000000005'
const OUTLET_B_ID = '96000000-0000-4000-8000-000000000006'
const OTHER_OUTLET_ID = '96000000-0000-4000-8000-000000000007'
const IN_TRANSIT_OUTLET_ID = '96000000-0000-4000-8000-000000000011'
const ADMIN_USER_ID = '96000000-0000-4000-8000-000000000008'
const READ_ONLY_USER_ID = '96000000-0000-4000-8000-000000000009'
const OTHER_ACTOR_USER_ID = '96000000-0000-4000-8000-000000000010'
const RECEIVER_USER_ID = '96000000-0000-4000-8000-000000000012'
const APPROVER_USER_ID = '96000000-0000-4000-8000-000000000013'

const ADMIN_ROLE_ID = '96100000-0000-4000-8000-000000000001'
const READ_ONLY_ROLE_ID = '96100000-0000-4000-8000-000000000002'
const RECEIVER_ROLE_ID = '96100000-0000-4000-8000-000000000003'
const APPROVER_ROLE_ID = '96100000-0000-4000-8000-000000000004'

const PCS_UNIT_ID = '96200000-0000-4000-8000-000000000001'
const KARTON_UNIT_ID = '96200000-0000-4000-8000-000000000002'
const ITEM_A_ID = '96300000-0000-4000-8000-000000000001'
const ITEM_B_ID = '96300000-0000-4000-8000-000000000002'
const ITEM_C_ID = '96300000-0000-4000-8000-000000000003'

const permissionCodes = [
  'inventory.read',
  'inventory.stock_in',
  'inventory.stock_out',
  'inventory.waste',
  'inventory.opname',
  'inventory.item_manage',
  'inventory.transfer_send',
  'inventory.transfer_receive',
  'inventory.approval_submit',
  'inventory.approval_validate',
  'inventory.approval_finalize',
]

const approverPermissionCodes = [
  'inventory.read',
  'inventory.approval_submit',
  'inventory.approval_validate',
  'inventory.approval_finalize',
]

const permissionIds = new Map<string, string>()
let adminToken = ''
let readOnlyToken = ''
let receiverToken = ''
let approverToken = ''

async function req(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: TestResponseBody }> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await app.request(
    `http://localhost${path}`,
    {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    TEST_ENV
  )
  return { status: res.status, body: await res.json() as TestResponseBody }
}

async function tokenFor(userId: string) {
  return signAccessToken(
    {
      sub: userId,
      company_id: COMPANY_ID,
      roles: [],
      scopes: [],
      first_login_required: false,
    },
    TEST_JWT_SECRET
  )
}

async function cleanupFixtures() {
  await sql`DELETE FROM pending_stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_transfers WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_balances WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM item_unit_conversions WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM items WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM units WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM item_categories WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM access_overrides WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM user_roles WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM role_permissions WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM roles WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM users WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM outlets WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM brands WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM companies WHERE id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

async function resetLedger() {
  await sql`DELETE FROM pending_stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_transfers WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_balances WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

async function resetMasterData() {
  await resetLedger()
  await sql`DELETE FROM item_unit_conversions WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM items WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM units WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM item_categories WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`

  await db.insert(units).values([
    { id: PCS_UNIT_ID, companyId: COMPANY_ID, code: 'PCS', name: 'Pieces' },
    { id: KARTON_UNIT_ID, companyId: COMPANY_ID, code: 'KARTON', name: 'Karton' },
  ])

  await db.insert(items).values([
    { id: ITEM_A_ID, companyId: COMPANY_ID, sku: 'INV-ROUTE-A', name: 'Inventory Route A', baseUnitId: PCS_UNIT_ID },
    { id: ITEM_B_ID, companyId: COMPANY_ID, sku: 'INV-ROUTE-B', name: 'Inventory Route B', baseUnitId: PCS_UNIT_ID },
    { id: ITEM_C_ID, companyId: COMPANY_ID, sku: 'INV-ROUTE-C', name: 'Inventory Route C', baseUnitId: PCS_UNIT_ID },
  ])

  await db.insert(itemUnitConversions).values({
    companyId: COMPANY_ID,
    itemId: ITEM_A_ID,
    fromUnitId: KARTON_UNIT_ID,
    factorToBase: '24',
  })
}

async function insertPermissionCatalog() {
  await db
    .insert(permissions)
    .values(
      permissionCodes.map((code) => {
        const [module, action] = code.split('.')
        return { code, module, action, description: `Inventory route test permission ${code}` }
      })
    )
    .onConflictDoNothing()

  const rows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, permissionCodes))

  for (const row of rows) {
    permissionIds.set(row.code, row.id)
  }
}

async function assignPermissions(roleId: string, codes: string[]) {
  await db.insert(rolePermissions).values(
    codes.map((code) => ({
      roleId,
      permissionId: permissionIds.get(code)!,
      companyId: COMPANY_ID,
    }))
  )
}

async function seedFixtures() {
  await insertPermissionCatalog()

  await db.insert(companies).values([
    {
      id: COMPANY_ID,
      companyCode: 'INV-ROUTE',
      companyName: 'Inventory Routes Test Company',
      status: 'active',
    },
    {
      id: OTHER_COMPANY_ID,
      companyCode: 'INV-ROUTE-B',
      companyName: 'Inventory Routes Other Company',
      status: 'active',
    },
  ])

  await db.insert(brands).values([
    { id: BRAND_ID, companyId: COMPANY_ID, brandCode: 'INV-R', brandName: 'Inventory Route Brand', status: 'active' },
    { id: OTHER_BRAND_ID, companyId: OTHER_COMPANY_ID, brandCode: 'INV-R-B', brandName: 'Inventory Other Brand', status: 'active' },
  ])

  await db.insert(outlets).values([
    { id: OUTLET_A_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'INV-R-A', outletName: 'Inventory Route A', status: 'active' },
    { id: OUTLET_B_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'INV-R-B', outletName: 'Inventory Route B', status: 'active' },
    {
      id: IN_TRANSIT_OUTLET_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_ID,
      outletCode: 'INV-R-TRANSIT',
      outletName: 'Inventory Route In Transit',
      outletType: 'in_transit',
      status: 'active',
    },
    { id: OTHER_OUTLET_ID, companyId: OTHER_COMPANY_ID, brandId: OTHER_BRAND_ID, outletCode: 'INV-R-OTHER', outletName: 'Inventory Other Outlet', status: 'active' },
  ])

  await db.insert(users).values([
    {
      id: ADMIN_USER_ID,
      companyId: COMPANY_ID,
      email: 'inventory-routes-admin@egg.test',
      fullName: 'Inventory Routes Admin',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: READ_ONLY_USER_ID,
      companyId: COMPANY_ID,
      email: 'inventory-routes-read-only@egg.test',
      fullName: 'Inventory Routes Read Only',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: OTHER_ACTOR_USER_ID,
      companyId: OTHER_COMPANY_ID,
      email: 'inventory-routes-other@egg.test',
      fullName: 'Inventory Routes Other',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: RECEIVER_USER_ID,
      companyId: COMPANY_ID,
      email: 'inventory-routes-receiver@egg.test',
      fullName: 'Inventory Routes Receiver',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: APPROVER_USER_ID,
      companyId: COMPANY_ID,
      email: 'inventory-routes-approver@egg.test',
      fullName: 'Inventory Routes Approver',
      status: 'active',
      firstLoginRequired: false,
    },
  ])

  await db.insert(roles).values([
    { id: ADMIN_ROLE_ID, companyId: COMPANY_ID, code: 'INV_ROUTE_ADMIN', name: 'Inventory Route Admin', defaultScopeType: 'outlet', isSystem: false },
    { id: READ_ONLY_ROLE_ID, companyId: COMPANY_ID, code: 'INV_ROUTE_READ_ONLY', name: 'Inventory Route Read Only', defaultScopeType: 'outlet', isSystem: false },
    { id: RECEIVER_ROLE_ID, companyId: COMPANY_ID, code: 'INV_ROUTE_RECEIVER', name: 'Inventory Route Receiver', defaultScopeType: 'outlet', isSystem: false },
    { id: APPROVER_ROLE_ID, companyId: COMPANY_ID, code: 'INV_ROUTE_APPROVER', name: 'Inventory Route Approver', defaultScopeType: 'outlet', isSystem: false },
  ])

  await assignPermissions(ADMIN_ROLE_ID, permissionCodes)
  await assignPermissions(READ_ONLY_ROLE_ID, ['inventory.read'])
  await assignPermissions(RECEIVER_ROLE_ID, ['inventory.transfer_receive'])
  await assignPermissions(APPROVER_ROLE_ID, approverPermissionCodes)

  await db.insert(userRoles).values([
    {
      userId: ADMIN_USER_ID,
      roleId: ADMIN_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'outlet',
      scopeId: OUTLET_A_ID,
      grantedBy: ADMIN_USER_ID,
    },
    {
      userId: READ_ONLY_USER_ID,
      roleId: READ_ONLY_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'outlet',
      scopeId: OUTLET_A_ID,
      grantedBy: ADMIN_USER_ID,
    },
    {
      userId: APPROVER_USER_ID,
      roleId: APPROVER_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'outlet',
      scopeId: OUTLET_A_ID,
      grantedBy: ADMIN_USER_ID,
    },
    {
      userId: RECEIVER_USER_ID,
      roleId: RECEIVER_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'outlet',
      scopeId: OUTLET_B_ID,
      grantedBy: ADMIN_USER_ID,
    },
  ])

  await db.insert(units).values([
    { id: PCS_UNIT_ID, companyId: COMPANY_ID, code: 'PCS', name: 'Pieces' },
    { id: KARTON_UNIT_ID, companyId: COMPANY_ID, code: 'KARTON', name: 'Karton' },
  ])

  await db.insert(items).values([
    { id: ITEM_A_ID, companyId: COMPANY_ID, sku: 'INV-ROUTE-A', name: 'Inventory Route A', baseUnitId: PCS_UNIT_ID },
    { id: ITEM_B_ID, companyId: COMPANY_ID, sku: 'INV-ROUTE-B', name: 'Inventory Route B', baseUnitId: PCS_UNIT_ID },
    { id: ITEM_C_ID, companyId: COMPANY_ID, sku: 'INV-ROUTE-C', name: 'Inventory Route C', baseUnitId: PCS_UNIT_ID },
  ])

  await db.insert(itemUnitConversions).values({
    companyId: COMPANY_ID,
    itemId: ITEM_A_ID,
    fromUnitId: KARTON_UNIT_ID,
    factorToBase: '24',
  })
}

function expectSuccessEnvelope(body: TestResponseBody) {
  expect(body.success).toBe(true)
  expect(body.data).toBeDefined()
}

async function seedSourceBalance(qtyBase = '60.000000') {
  await db.insert(stockBalances).values({
    companyId: COMPANY_ID,
    itemId: ITEM_A_ID,
    outletId: OUTLET_A_ID,
    qtyBase,
  })
}

async function balanceQty(outletId: string) {
  const row = await db
    .select({ qtyBase: stockBalances.qtyBase })
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.companyId, COMPANY_ID),
        eq(stockBalances.itemId, ITEM_A_ID),
        eq(stockBalances.outletId, outletId)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return row?.qtyBase ?? '0.000000'
}

async function transferRows() {
  return db
    .select()
    .from(stockTransfers)
    .where(eq(stockTransfers.companyId, COMPANY_ID))
}

async function movementRows() {
  return db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.companyId, COMPANY_ID))
}

async function createPendingTransfer(refNo = 'TRF-HTTP-001') {
  await seedSourceBalance()
  const { status, body } = await req('POST', '/api/v1/inventory/transfers', adminToken, {
    item_id: ITEM_A_ID,
    from_outlet_id: OUTLET_A_ID,
    to_outlet_id: OUTLET_B_ID,
    qty: '2',
    unit_id: KARTON_UNIT_ID,
    reason: 'route transfer',
    ref_no: refNo,
  })

  expect(status).toBe(201)
  expectSuccessEnvelope(body)

  return body.data as unknown as {
    transfer: { id: string; status: string; qty_base: string }
  }
}

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
  adminToken = await tokenFor(ADMIN_USER_ID)
  readOnlyToken = await tokenFor(READ_ONLY_USER_ID)
  receiverToken = await tokenFor(RECEIVER_USER_ID)
  approverToken = await tokenFor(APPROVER_USER_ID)
})

beforeEach(async () => {
  await resetLedger()
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('INV-CORE routes — write operations', () => {
  it('POST /stock-in converts 2 KARTON to 48 PCS and ignores client company_id/created_by', async () => {
    const { status, body } = await req('POST', '/api/v1/inventory/stock-in', adminToken, {
      company_id: OTHER_COMPANY_ID,
      created_by: OTHER_ACTOR_USER_ID,
      item_id: ITEM_A_ID,
      outlet_id: OUTLET_A_ID,
      qty: '2',
      unit_id: KARTON_UNIT_ID,
      reason: 'route stock in',
      ref_no: 'SI-001',
    })

    expect(status).toBe(201)
    expectSuccessEnvelope(body)
    const movement = body.data.movement as { company_id: string; created_by: string; qty_base: string }
    expect(movement.company_id).toBe(COMPANY_ID)
    expect(movement.created_by).toBe(ADMIN_USER_ID)
    expect(movement.qty_base).toBe('48.000000')
  })

  it('POST /stock-out decrements balance and returns movement envelope', async () => {
    await db.insert(stockBalances).values({
      companyId: COMPANY_ID,
      itemId: ITEM_A_ID,
      outletId: OUTLET_A_ID,
      qtyBase: '10.000000',
    })

    const { status, body } = await req('POST', '/api/v1/inventory/stock-out', adminToken, {
      item_id: ITEM_A_ID,
      outlet_id: OUTLET_A_ID,
      qty: '4',
      unit_id: PCS_UNIT_ID,
    })

    expect(status).toBe(201)
    expectSuccessEnvelope(body)
    const movement = body.data.movement as { movement_type: string; qty_base: string }
    const balance = body.data.balance as { qty_base: string }
    expect(movement.movement_type).toBe('stock_out')
    expect(movement.qty_base).toBe('-4.000000')
    expect(balance.qty_base).toBe('6.000000')
  })

  it('stock-out over balance returns 422 ERR_INSUFFICIENT_STOCK', async () => {
    const { status, body } = await req('POST', '/api/v1/inventory/stock-out', adminToken, {
      item_id: ITEM_A_ID,
      outlet_id: OUTLET_A_ID,
      qty: '99',
      unit_id: PCS_UNIT_ID,
    })

    expect(status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_INSUFFICIENT_STOCK')
  })
})

describe('INV-FLOW transfer routes', () => {
  it('POST /transfers sends 2 KARTON from outlet A to in-transit and creates pending transfer', async () => {
    await seedSourceBalance()

    const { status, body } = await req('POST', '/api/v1/inventory/transfers', adminToken, {
      item_id: ITEM_A_ID,
      from_outlet_id: OUTLET_A_ID,
      to_outlet_id: OUTLET_B_ID,
      qty: '2',
      unit_id: KARTON_UNIT_ID,
      reason: 'route transfer send',
      ref_no: 'TRF-HTTP-SEND',
    })

    expect(status).toBe(201)
    expectSuccessEnvelope(body)
    const data = body.data as unknown as {
      transfer: { status: string; qty_base: string; input_qty: string }
      movements: Array<{ movement_type: string; outlet_id: string; qty_base: string }>
    }

    expect(data.transfer.status).toBe('pending')
    expect(data.transfer.qty_base).toBe('48.000000')
    expect(data.transfer.input_qty).toBe('2.000000')
    expect(data.movements.map((movement) => [movement.movement_type, movement.outlet_id, movement.qty_base])).toEqual([
      ['transfer_out', OUTLET_A_ID, '-48.000000'],
      ['transfer_in', IN_TRANSIT_OUTLET_ID, '48.000000'],
    ])
    expect(await balanceQty(OUTLET_A_ID)).toBe('12.000000')
    expect(await balanceQty(IN_TRANSIT_OUTLET_ID)).toBe('48.000000')

    const transfers = await transferRows()
    expect(transfers).toHaveLength(1)
    expect(transfers[0].status).toBe('pending')
  })

  it('POST /transfers/:id/receive moves in-transit stock to destination and marks transfer received', async () => {
    const sent = await createPendingTransfer('TRF-HTTP-RECEIVE')

    const { status, body } = await req(
      'POST',
      `/api/v1/inventory/transfers/${sent.transfer.id}/receive`,
      receiverToken,
      { received_by: OTHER_ACTOR_USER_ID }
    )

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    const data = body.data as unknown as {
      transfer: { status: string; received_by: string; qty_base: string }
      movements: Array<{ movement_type: string; outlet_id: string; qty_base: string }>
    }

    expect(data.transfer.status).toBe('received')
    expect(data.transfer.received_by).toBe(RECEIVER_USER_ID)
    expect(data.transfer.qty_base).toBe('48.000000')
    expect(data.movements.map((movement) => [movement.movement_type, movement.outlet_id, movement.qty_base])).toEqual([
      ['transfer_out', IN_TRANSIT_OUTLET_ID, '-48.000000'],
      ['transfer_in', OUTLET_B_ID, '48.000000'],
    ])
    expect(await balanceQty(IN_TRANSIT_OUTLET_ID)).toBe('0.000000')
    expect(await balanceQty(OUTLET_B_ID)).toBe('48.000000')

    const transfers = await transferRows()
    expect(transfers[0].status).toBe('received')
    expect(transfers[0].receivedBy).toBe(RECEIVER_USER_ID)
  })

  it('POST /transfers/:id/receive twice returns 422 ERR_ALREADY_RECEIVED without duplicate movement', async () => {
    const sent = await createPendingTransfer('TRF-HTTP-DOUBLE')
    await req('POST', `/api/v1/inventory/transfers/${sent.transfer.id}/receive`, receiverToken)
    const movementCount = (await movementRows()).length

    const { status, body } = await req('POST', `/api/v1/inventory/transfers/${sent.transfer.id}/receive`, receiverToken)

    expect(status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_ALREADY_RECEIVED')
    expect(await movementRows()).toHaveLength(movementCount)
    expect(await balanceQty(IN_TRANSIT_OUTLET_ID)).toBe('0.000000')
    expect(await balanceQty(OUTLET_B_ID)).toBe('48.000000')
  })

  it('POST /transfers returns 422 ERR_INSUFFICIENT_STOCK when source balance is short', async () => {
    const { status, body } = await req('POST', '/api/v1/inventory/transfers', adminToken, {
      item_id: ITEM_A_ID,
      from_outlet_id: OUTLET_A_ID,
      to_outlet_id: OUTLET_B_ID,
      qty: '2',
      unit_id: KARTON_UNIT_ID,
    })

    expect(status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_INSUFFICIENT_STOCK')
    expect(await movementRows()).toHaveLength(0)
    expect(await transferRows()).toHaveLength(0)
    expect(await balanceQty(OUTLET_A_ID)).toBe('0.000000')
  })

  it('requires transfer_send for create and transfer_receive for receive', async () => {
    const createDenied = await req('POST', '/api/v1/inventory/transfers', readOnlyToken, {
      item_id: ITEM_A_ID,
      from_outlet_id: OUTLET_A_ID,
      to_outlet_id: OUTLET_B_ID,
      qty: '1',
      unit_id: PCS_UNIT_ID,
    })

    expect(createDenied.status).toBe(403)
    expect(createDenied.body.success).toBe(false)
    expect(createDenied.body.error.code).toBe('ERR_FORBIDDEN')

    const sent = await createPendingTransfer('TRF-HTTP-RBAC')
    const receiveDenied = await req('POST', `/api/v1/inventory/transfers/${sent.transfer.id}/receive`, readOnlyToken)

    expect(receiveDenied.status).toBe(403)
    expect(receiveDenied.body.success).toBe(false)
    expect(receiveDenied.body.error.code).toBe('ERR_FORBIDDEN')
  })

  it('returns 404 ERR_OUT_OF_SCOPE when transfer source outlet is outside sender scope', async () => {
    const { status, body } = await req('POST', '/api/v1/inventory/transfers', adminToken, {
      item_id: ITEM_A_ID,
      from_outlet_id: OUTLET_B_ID,
      to_outlet_id: OUTLET_A_ID,
      qty: '1',
      unit_id: PCS_UNIT_ID,
    })

    expect(status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_OUT_OF_SCOPE')
    expect(await movementRows()).toHaveLength(0)
    expect(await transferRows()).toHaveLength(0)
  })

  it('ignores client company_id and sent_by during create transfer', async () => {
    await seedSourceBalance()

    const { status, body } = await req('POST', '/api/v1/inventory/transfers', adminToken, {
      company_id: OTHER_COMPANY_ID,
      sent_by: OTHER_ACTOR_USER_ID,
      item_id: ITEM_A_ID,
      from_outlet_id: OUTLET_A_ID,
      to_outlet_id: OUTLET_B_ID,
      qty: '1',
      unit_id: PCS_UNIT_ID,
      ref_no: 'TRF-HTTP-IDENTITY',
    })

    expect(status).toBe(201)
    expectSuccessEnvelope(body)
    const data = body.data as unknown as {
      transfer: { company_id: string; sent_by: string; qty_base: string }
    }
    expect(data.transfer.company_id).toBe(COMPANY_ID)
    expect(data.transfer.sent_by).toBe(ADMIN_USER_ID)
    expect(data.transfer.qty_base).toBe('1.000000')

    const transfers = await transferRows()
    expect(transfers[0].companyId).toBe(COMPANY_ID)
    expect(transfers[0].sentBy).toBe(ADMIN_USER_ID)
  })

  it('validates transfer qty as decimal string and rejects number or invalid string', async () => {
    for (const qty of [2, 'invalid']) {
      const { status, body } = await req('POST', '/api/v1/inventory/transfers', adminToken, {
        item_id: ITEM_A_ID,
        from_outlet_id: OUTLET_A_ID,
        to_outlet_id: OUTLET_B_ID,
        qty,
        unit_id: PCS_UNIT_ID,
      })

      expect(status).toBe(422)
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('ERR_VALIDATION')
    }

    expect(await movementRows()).toHaveLength(0)
    expect(await transferRows()).toHaveLength(0)
  })
})

describe('INV-APPROVAL routes', () => {
  async function submitOpnamePending(counted = '3', unitId = PCS_UNIT_ID) {
    await db.insert(stockBalances).values({
      companyId: COMPANY_ID,
      itemId: ITEM_A_ID,
      outletId: OUTLET_A_ID,
      qtyBase: '20.000000',
    })
    const { status, body } = await req('POST', '/api/v1/inventory/opname/submit', adminToken, {
      item_id: ITEM_A_ID,
      outlet_id: OUTLET_A_ID,
      counted_qty: counted,
      unit_id: unitId,
      reason: 'route opname submit',
    })
    expect(status).toBe(201)
    expectSuccessEnvelope(body)
    return body.data.pending as { id: string; status: string; qty_base: string; submitted_by: string }
  }

  async function submitWastePending(qty = '5') {
    await db.insert(stockBalances).values({
      companyId: COMPANY_ID,
      itemId: ITEM_A_ID,
      outletId: OUTLET_A_ID,
      qtyBase: '20.000000',
    })
    const { status, body } = await req('POST', '/api/v1/inventory/waste/submit', adminToken, {
      item_id: ITEM_A_ID,
      outlet_id: OUTLET_A_ID,
      qty,
      unit_id: PCS_UNIT_ID,
      reason: 'route waste submit',
    })
    expect(status).toBe(201)
    expectSuccessEnvelope(body)
    return body.data.pending as { id: string; status: string; qty_base: string; submitted_by: string }
  }

  it('POST /opname/submit creates pending row, locks qty_base, and does not change balance or ledger', async () => {
    const pending = await submitOpnamePending('5', PCS_UNIT_ID)

    expect(pending.status).toBe('pending')
    expect(pending.submitted_by).toBe(ADMIN_USER_ID)
    expect(pending.qty_base).toBe('5.000000')
    expect(await movementRows()).toHaveLength(0)
    expect(await balanceQty(OUTLET_A_ID)).toBe('20.000000')
  })

  it('POST /waste/submit creates pending row and does not change balance', async () => {
    const pending = await submitWastePending('5')

    expect(pending.status).toBe('pending')
    expect(pending.qty_base).toBe('5.000000')
    expect(await movementRows()).toHaveLength(0)
    expect(await balanceQty(OUTLET_A_ID)).toBe('20.000000')
  })

  it('POST /approvals/:id/validate by approver (different actor) returns 200 and validated', async () => {
    const pending = await submitWastePending('5')

    const { status, body } = await req('POST', `/api/v1/inventory/approvals/${pending.id}/validate`, approverToken)

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    const updated = body.data.pending as { status: string; validated_by: string }
    expect(updated.status).toBe('validated')
    expect(updated.validated_by).toBe(APPROVER_USER_ID)
    expect(await balanceQty(OUTLET_A_ID)).toBe('20.000000')
  })

  it('POST /approvals/:id/validate by submitter (self) returns 403 ERR_SELF_APPROVAL', async () => {
    const pending = await submitWastePending('5')

    const { status, body } = await req('POST', `/api/v1/inventory/approvals/${pending.id}/validate`, adminToken)

    expect(status).toBe(403)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_SELF_APPROVAL')
  })

  it('POST /approvals/:id/finalize on validated waste decrements balance and links movement', async () => {
    const pending = await submitWastePending('5')
    await req('POST', `/api/v1/inventory/approvals/${pending.id}/validate`, approverToken)

    const { status, body } = await req('POST', `/api/v1/inventory/approvals/${pending.id}/finalize`, approverToken)

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    const result = body.data as unknown as {
      pending: { status: string; finalized_by: string; finalized_movement_id: string }
      movement: { movement_type: string; qty_base: string; id: string }
      balance: { qty_base: string }
    }
    expect(result.pending.status).toBe('finalized')
    expect(result.pending.finalized_by).toBe(APPROVER_USER_ID)
    expect(result.pending.finalized_movement_id).toBe(result.movement.id)
    expect(result.movement.movement_type).toBe('waste')
    expect(result.movement.qty_base).toBe('-5.000000')
    expect(result.balance.qty_base).toBe('15.000000')
    expect(await balanceQty(OUTLET_A_ID)).toBe('15.000000')
  })

  it('POST /approvals/:id/finalize by submitter (self) returns 403 ERR_SELF_APPROVAL and keeps status validated', async () => {
    const pending = await submitWastePending('5')
    await req('POST', `/api/v1/inventory/approvals/${pending.id}/validate`, approverToken)

    const { status, body } = await req('POST', `/api/v1/inventory/approvals/${pending.id}/finalize`, adminToken)

    expect(status).toBe(403)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_SELF_APPROVAL')
    expect(await movementRows()).toHaveLength(0)
    expect(await balanceQty(OUTLET_A_ID)).toBe('20.000000')
  })

  it('POST /approvals/:id/finalize on waste with depleted balance returns 422 ERR_INSUFFICIENT_STOCK and keeps status validated', async () => {
    const pending = await submitWastePending('15')
    await req('POST', `/api/v1/inventory/approvals/${pending.id}/validate`, approverToken)
    await sql`UPDATE stock_balances SET qty_base = '5.000000' WHERE item_id = ${ITEM_A_ID} AND outlet_id = ${OUTLET_A_ID}`

    const { status, body } = await req('POST', `/api/v1/inventory/approvals/${pending.id}/finalize`, approverToken)

    expect(status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_INSUFFICIENT_STOCK')

    const detail = await req('GET', `/api/v1/inventory/approvals/${pending.id}`, adminToken)
    expect(detail.status).toBe(200)
    expect((detail.body.data.pending as { status: string }).status).toBe('validated')
    expect(await movementRows()).toHaveLength(0)
    expect(await balanceQty(OUTLET_A_ID)).toBe('5.000000')
  })

  it('POST /approvals/:id/reject from pending returns 200 and rejected', async () => {
    const pending = await submitWastePending('5')

    const { status, body } = await req(
      'POST',
      `/api/v1/inventory/approvals/${pending.id}/reject`,
      approverToken,
      { reason: 'salah input' },
    )

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    const updated = body.data.pending as { status: string; rejected_by: string; reject_reason: string }
    expect(updated.status).toBe('rejected')
    expect(updated.rejected_by).toBe(APPROVER_USER_ID)
    expect(updated.reject_reason).toBe('salah input')
  })

  it('readOnly token cannot submit (no approval_submit) or finalize (no approval_finalize)', async () => {
    const submitDenied = await req('POST', '/api/v1/inventory/waste/submit', readOnlyToken, {
      item_id: ITEM_A_ID,
      outlet_id: OUTLET_A_ID,
      qty: '1',
      unit_id: PCS_UNIT_ID,
    })
    expect(submitDenied.status).toBe(403)
    expect(submitDenied.body.error.code).toBe('ERR_FORBIDDEN')

    const pending = await submitWastePending('3')
    await req('POST', `/api/v1/inventory/approvals/${pending.id}/validate`, approverToken)
    const finalizeDenied = await req('POST', `/api/v1/inventory/approvals/${pending.id}/finalize`, readOnlyToken)
    expect(finalizeDenied.status).toBe(403)
    expect(finalizeDenied.body.error.code).toBe('ERR_FORBIDDEN')
  })

  it('GET /approvals returns paginated meta and rows visible to the actor', async () => {
    await db.insert(stockBalances).values({
      companyId: COMPANY_ID,
      itemId: ITEM_A_ID,
      outletId: OUTLET_A_ID,
      qtyBase: '20.000000',
    })
    for (const qty of ['1', '2']) {
      const submitRes = await req('POST', '/api/v1/inventory/waste/submit', adminToken, {
        item_id: ITEM_A_ID,
        outlet_id: OUTLET_A_ID,
        qty,
        unit_id: PCS_UNIT_ID,
      })
      expect(submitRes.status).toBe(201)
    }

    const { status, body } = await req('GET', '/api/v1/inventory/approvals?page=1&page_size=1', adminToken)

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    expect(body.meta).toEqual({ page: 1, page_size: 1, total: 2 })
    expect(body.data).toHaveLength(1)
  })

  it('GET /approvals/:id for cross-company row returns 404 ERR_OUT_OF_SCOPE', async () => {
    const otherCompanyItemId = '96300000-0000-4000-8000-000000000099'
    const otherCompanyUnitId = '96200000-0000-4000-8000-000000000099'
    await db.insert(units).values({ id: otherCompanyUnitId, companyId: OTHER_COMPANY_ID, code: 'OTH-PCS', name: 'Other Pieces' })
    await db.insert(items).values({ id: otherCompanyItemId, companyId: OTHER_COMPANY_ID, sku: 'OTH-INV-1', name: 'Other Item', baseUnitId: otherCompanyUnitId })

    const otherRows = await db
      .insert(pendingStockMovements)
      .values({
        companyId: OTHER_COMPANY_ID,
        itemId: otherCompanyItemId,
        outletId: OTHER_OUTLET_ID,
        movementType: 'waste',
        inputQty: '5.000000',
        inputUnitId: otherCompanyUnitId,
        qtyBase: '5.000000',
        reason: 'cross-company',
        status: 'pending',
        submittedBy: OTHER_ACTOR_USER_ID,
      })
      .returning({ id: pendingStockMovements.id })

    const { status, body } = await req('GET', `/api/v1/inventory/approvals/${otherRows[0].id}`, adminToken)

    expect(status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_OUT_OF_SCOPE')
  })
})

describe('INV-CORE routes — RBAC and reads', () => {
  it('user without write permission gets 403 on stock-in', async () => {
    const { status, body } = await req('POST', '/api/v1/inventory/stock-in', readOnlyToken, {
      item_id: ITEM_A_ID,
      outlet_id: OUTLET_A_ID,
      qty: '1',
      unit_id: PCS_UNIT_ID,
    })

    expect(status).toBe(403)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_FORBIDDEN')
  })

  it('out-of-scope outlet returns 404 ERR_OUT_OF_SCOPE', async () => {
    const { status, body } = await req('POST', '/api/v1/inventory/stock-in', adminToken, {
      item_id: ITEM_A_ID,
      outlet_id: OUTLET_B_ID,
      qty: '1',
      unit_id: PCS_UNIT_ID,
    })

    expect(status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_OUT_OF_SCOPE')
  })

  it('GET /balances returns paginated meta and data', async () => {
    await db.insert(stockBalances).values([
      { companyId: COMPANY_ID, itemId: ITEM_A_ID, outletId: OUTLET_A_ID, qtyBase: '1.000000', updatedAt: new Date('2026-01-01T00:00:00.000Z') },
      { companyId: COMPANY_ID, itemId: ITEM_B_ID, outletId: OUTLET_A_ID, qtyBase: '2.000000', updatedAt: new Date('2026-01-02T00:00:00.000Z') },
      { companyId: COMPANY_ID, itemId: ITEM_C_ID, outletId: OUTLET_A_ID, qtyBase: '3.000000', updatedAt: new Date('2026-01-03T00:00:00.000Z') },
    ])

    const { status, body } = await req('GET', '/api/v1/inventory/balances?page=1&page_size=2', adminToken)

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    expect(body.meta).toEqual({ page: 1, page_size: 2, total: 3 })
    expect(body.data).toHaveLength(2)
  })

  it('GET /movements returns created_at desc order and paginated meta', async () => {
    await db.insert(stockMovements).values([
      {
        companyId: COMPANY_ID,
        itemId: ITEM_A_ID,
        outletId: OUTLET_A_ID,
        movementType: 'stock_in',
        qtyBase: '1.000000',
        inputQty: '1.000000',
        inputUnitId: PCS_UNIT_ID,
        refNo: 'OLD',
        createdBy: ADMIN_USER_ID,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        companyId: COMPANY_ID,
        itemId: ITEM_A_ID,
        outletId: OUTLET_A_ID,
        movementType: 'stock_in',
        qtyBase: '2.000000',
        inputQty: '2.000000',
        inputUnitId: PCS_UNIT_ID,
        refNo: 'MID',
        createdBy: ADMIN_USER_ID,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        companyId: COMPANY_ID,
        itemId: ITEM_A_ID,
        outletId: OUTLET_A_ID,
        movementType: 'stock_in',
        qtyBase: '3.000000',
        inputQty: '3.000000',
        inputUnitId: PCS_UNIT_ID,
        refNo: 'NEW',
        createdBy: ADMIN_USER_ID,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ])

    const { status, body } = await req('GET', '/api/v1/inventory/movements?page=1&page_size=2', adminToken)

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    expect(body.meta).toEqual({ page: 1, page_size: 2, total: 3 })
    const movementRows = body.data as unknown as Array<{ ref_no: string }>
    expect(movementRows.map((row) => row.ref_no)).toEqual(['NEW', 'MID'])
  })
})

describe('INV-CORE master-data routes', () => {
  beforeEach(async () => {
    await resetMasterData()
  })

  it('POST /units, /categories, and /items create master data and ignore client company_id', async () => {
    const unitResponse = await req('POST', '/api/v1/inventory/units', adminToken, {
      code: 'PACK',
      name: 'Pack',
    })
    expect(unitResponse.status).toBe(201)
    expectSuccessEnvelope(unitResponse.body)
    const unit = unitResponse.body.data as unknown as { id: string; company_id: string; code: string }
    expect(unit).toMatchObject({ company_id: COMPANY_ID, code: 'PACK' })

    const categoryResponse = await req('POST', '/api/v1/inventory/categories', adminToken, {
      code: 'RAW',
      name: 'Raw Material',
    })
    expect(categoryResponse.status).toBe(201)
    expectSuccessEnvelope(categoryResponse.body)
    const category = categoryResponse.body.data as unknown as { id: string; company_id: string; code: string }
    expect(category).toMatchObject({ company_id: COMPANY_ID, code: 'RAW' })

    const itemResponse = await req('POST', '/api/v1/inventory/items', adminToken, {
      company_id: OTHER_COMPANY_ID,
      created_by: OTHER_ACTOR_USER_ID,
      sku: 'MD-HTTP-001',
      name: 'Master Data HTTP Item',
      category_id: category.id,
      base_unit_id: unit.id,
      pawoon_ref: 'PW-MD-001',
    })
    expect(itemResponse.status).toBe(201)
    expectSuccessEnvelope(itemResponse.body)
    const item = itemResponse.body.data as unknown as {
      id: string
      company_id: string
      sku: string
      category_id: string
      base_unit_id: string
    }
    expect(item).toMatchObject({
      company_id: COMPANY_ID,
      sku: 'MD-HTTP-001',
      category_id: category.id,
      base_unit_id: unit.id,
    })

    const [row] = await db.select({ companyId: items.companyId }).from(items).where(eq(items.id, item.id)).limit(1)
    expect(row.companyId).toBe(COMPANY_ID)
  })

  it('POST /items duplicate SKU returns 409 ERR_DUPLICATE', async () => {
    const { status, body } = await req('POST', '/api/v1/inventory/items', adminToken, {
      sku: 'INV-ROUTE-A',
      name: 'Duplicate Route Item',
      category_id: null,
      base_unit_id: PCS_UNIT_ID,
    })

    expect(status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_DUPLICATE')
  })

  it('PATCH /items/:id updates mutable item fields with item_manage', async () => {
    const categoryResponse = await req('POST', '/api/v1/inventory/categories', adminToken, {
      code: 'PATCH-CAT',
      name: 'Patch Category',
    })
    const category = categoryResponse.body.data as unknown as { id: string }

    const { status, body } = await req('PATCH', `/api/v1/inventory/items/${ITEM_B_ID}`, adminToken, {
      name: 'Patched Route Item',
      category_id: category.id,
      is_active: false,
    })

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    const item = body.data as unknown as { id: string; name: string; category_id: string; is_active: boolean }
    expect(item).toMatchObject({
      id: ITEM_B_ID,
      name: 'Patched Route Item',
      category_id: category.id,
      is_active: false,
    })
  })

  it('POST /items/:id/units accepts string factor and GET /items/:id returns conversions', async () => {
    const conversionResponse = await req('POST', `/api/v1/inventory/items/${ITEM_B_ID}/units`, adminToken, {
      from_unit_id: KARTON_UNIT_ID,
      factor_to_base: '12',
    })
    expect(conversionResponse.status).toBe(201)
    expectSuccessEnvelope(conversionResponse.body)
    const conversion = conversionResponse.body.data as unknown as {
      item_id: string
      from_unit_id: string
      factor_to_base: string
    }
    expect(conversion).toMatchObject({
      item_id: ITEM_B_ID,
      from_unit_id: KARTON_UNIT_ID,
      factor_to_base: '12.000000',
    })

    const detailResponse = await req('GET', `/api/v1/inventory/items/${ITEM_B_ID}`, readOnlyToken)
    expect(detailResponse.status).toBe(200)
    expectSuccessEnvelope(detailResponse.body)
    const detail = detailResponse.body.data as unknown as {
      item: { id: string }
      conversions: Array<{ factor_to_base: string; from_unit_id: string }>
    }
    expect(detail.item.id).toBe(ITEM_B_ID)
    expect(detail.conversions).toEqual([
      expect.objectContaining({ from_unit_id: KARTON_UNIT_ID, factor_to_base: '12.000000' }),
    ])
  })

  it('POST /items/:id/units rejects zero and negative factor as 422 ERR_VALIDATION', async () => {
    for (const factor of ['0', '-5']) {
      const { status, body } = await req('POST', `/api/v1/inventory/items/${ITEM_B_ID}/units`, adminToken, {
        from_unit_id: KARTON_UNIT_ID,
        factor_to_base: factor,
      })

      expect(status).toBe(422)
      expect(body.success).toBe(false)
      expect(body.error.code).toBe('ERR_VALIDATION')
    }
  })

  it('POST /items/:id/units rejects numeric factor_to_base without coercion', async () => {
    const { status, body } = await req('POST', `/api/v1/inventory/items/${ITEM_B_ID}/units`, adminToken, {
      from_unit_id: KARTON_UNIT_ID,
      factor_to_base: 2,
    })

    expect(status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_VALIDATION')
  })

  it('GET master-data endpoints allow inventory.read and return pagination meta', async () => {
    await req('POST', '/api/v1/inventory/categories', adminToken, {
      code: 'READ-CAT',
      name: 'Read Category',
    })

    const itemsResponse = await req('GET', '/api/v1/inventory/items?page=1&page_size=2', readOnlyToken)
    expect(itemsResponse.status).toBe(200)
    expectSuccessEnvelope(itemsResponse.body)
    expect(itemsResponse.body.meta).toEqual({ page: 1, page_size: 2, total: 3 })
    expect(itemsResponse.body.data).toHaveLength(2)

    const unitsResponse = await req('GET', '/api/v1/inventory/units?page=1&page_size=1', readOnlyToken)
    expect(unitsResponse.status).toBe(200)
    expectSuccessEnvelope(unitsResponse.body)
    expect(unitsResponse.body.meta).toEqual({ page: 1, page_size: 1, total: 2 })

    const categoriesResponse = await req('GET', '/api/v1/inventory/categories', readOnlyToken)
    expect(categoriesResponse.status).toBe(200)
    expectSuccessEnvelope(categoriesResponse.body)
    expect(categoriesResponse.body.meta).toEqual({ page: 1, page_size: 50, total: 1 })
  })

  it('POST master-data endpoints require inventory.item_manage and return 403 with read only token', async () => {
    const itemDenied = await req('POST', '/api/v1/inventory/items', readOnlyToken, {
      sku: 'DENIED-ITEM',
      name: 'Denied Item',
      base_unit_id: PCS_UNIT_ID,
    })
    const unitDenied = await req('POST', '/api/v1/inventory/units', readOnlyToken, {
      code: 'DENIED-UNIT',
      name: 'Denied Unit',
    })
    const categoryDenied = await req('POST', '/api/v1/inventory/categories', readOnlyToken, {
      code: 'DENIED-CAT',
      name: 'Denied Category',
    })

    for (const denied of [itemDenied, unitDenied, categoryDenied]) {
      expect(denied.status).toBe(403)
      expect(denied.body.success).toBe(false)
      expect(denied.body.error.code).toBe('ERR_FORBIDDEN')
    }
  })

  it('GET /items/:id for cross-company item returns 404 ERR_OUT_OF_SCOPE', async () => {
    const [otherUnit] = await db
      .insert(units)
      .values({
        companyId: OTHER_COMPANY_ID,
        code: 'OTHER-PCS',
        name: 'Other Pieces',
      })
      .returning({ id: units.id })
    const [otherItem] = await db
      .insert(items)
      .values({
        companyId: OTHER_COMPANY_ID,
        sku: 'OTHER-ITEM',
        name: 'Other Company Item',
        baseUnitId: otherUnit.id,
      })
      .returning({ id: items.id })

    const { status, body } = await req('GET', `/api/v1/inventory/items/${otherItem.id}`, adminToken)

    expect(status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_OUT_OF_SCOPE')
  })
})
