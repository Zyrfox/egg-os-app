import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { inArray } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  itemUnitConversions,
  items,
  outlets,
  permissions,
  rolePermissions,
  roles,
  stockBalances,
  stockMovements,
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
const ADMIN_USER_ID = '96000000-0000-4000-8000-000000000008'
const READ_ONLY_USER_ID = '96000000-0000-4000-8000-000000000009'
const OTHER_ACTOR_USER_ID = '96000000-0000-4000-8000-000000000010'

const ADMIN_ROLE_ID = '96100000-0000-4000-8000-000000000001'
const READ_ONLY_ROLE_ID = '96100000-0000-4000-8000-000000000002'

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
]

const permissionIds = new Map<string, string>()
let adminToken = ''
let readOnlyToken = ''

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
  await sql`DELETE FROM stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_balances WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM item_unit_conversions WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM items WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM units WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
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
  await sql`DELETE FROM stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_balances WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
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
  ])

  await db.insert(roles).values([
    { id: ADMIN_ROLE_ID, companyId: COMPANY_ID, code: 'INV_ROUTE_ADMIN', name: 'Inventory Route Admin', defaultScopeType: 'outlet', isSystem: false },
    { id: READ_ONLY_ROLE_ID, companyId: COMPANY_ID, code: 'INV_ROUTE_READ_ONLY', name: 'Inventory Route Read Only', defaultScopeType: 'outlet', isSystem: false },
  ])

  await assignPermissions(ADMIN_ROLE_ID, permissionCodes)
  await assignPermissions(READ_ONLY_ROLE_ID, ['inventory.read'])

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

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
  adminToken = await tokenFor(ADMIN_USER_ID)
  readOnlyToken = await tokenFor(READ_ONLY_USER_ID)
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

  it('POST /waste decrements balance and returns movement envelope', async () => {
    await db.insert(stockBalances).values({
      companyId: COMPANY_ID,
      itemId: ITEM_A_ID,
      outletId: OUTLET_A_ID,
      qtyBase: '8.000000',
    })

    const { status, body } = await req('POST', '/api/v1/inventory/waste', adminToken, {
      item_id: ITEM_A_ID,
      outlet_id: OUTLET_A_ID,
      qty: '3',
      unit_id: PCS_UNIT_ID,
      reason: 'route waste',
    })

    expect(status).toBe(201)
    expectSuccessEnvelope(body)
    const movement = body.data.movement as { movement_type: string; qty_base: string }
    expect(movement.movement_type).toBe('waste')
    expect(movement.qty_base).toBe('-3.000000')
  })

  it('POST /opname accepts counted_qty "0" and records negative delta', async () => {
    await db.insert(stockBalances).values({
      companyId: COMPANY_ID,
      itemId: ITEM_A_ID,
      outletId: OUTLET_A_ID,
      qtyBase: '5.000000',
    })

    const { status, body } = await req('POST', '/api/v1/inventory/opname', adminToken, {
      item_id: ITEM_A_ID,
      outlet_id: OUTLET_A_ID,
      counted_qty: '0',
      unit_id: PCS_UNIT_ID,
    })

    expect(status).toBe(201)
    expectSuccessEnvelope(body)
    const movement = body.data.movement as { movement_type: string; qty_base: string }
    const balance = body.data.balance as { qty_base: string }
    expect(movement.movement_type).toBe('opname')
    expect(movement.qty_base).toBe('-5.000000')
    expect(balance.qty_base).toBe('0.000000')
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
