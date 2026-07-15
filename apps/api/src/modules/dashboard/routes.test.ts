import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { inArray } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  dailyReports,
  items,
  outlets,
  pendingStockMovements,
  permissions,
  rolePermissions,
  roles,
  units,
  userRoles,
  users,
} from '@egg-os/db'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import type { TestResponseBody } from '../../test/types'

// UUID prefix: 9d000000-... (93-99=older tests, 9a=report routes, 9b=evidence service, 9c=evidence routes, 9d=dashboard routes)

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars'
const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
}

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

const COMPANY_ID    = '9d000000-0000-4000-8000-000000000001'
const BRAND_ID      = '9d000000-0000-4000-8000-000000000002'
const OUTLET_A_ID   = '9d000000-0000-4000-8000-000000000003'
const OUTLET_B_ID   = '9d000000-0000-4000-8000-000000000004'

const EXEC_USER_ID      = '9d000000-0000-4000-8000-000000000010'
const SPV_USER_ID       = '9d000000-0000-4000-8000-000000000011'
const MANAGER_USER_ID   = '9d000000-0000-4000-8000-000000000012'
const INV_USER_ID       = '9d000000-0000-4000-8000-000000000013'
const NO_DASH_USER_ID   = '9d000000-0000-4000-8000-000000000014'
const SUBMITTER_USER_ID = '9d000000-0000-4000-8000-000000000015'

const EXEC_ROLE_ID    = '9d100000-0000-4000-8000-000000000001'
const SPV_ROLE_ID     = '9d100000-0000-4000-8000-000000000002'
const MANAGER_ROLE_ID = '9d100000-0000-4000-8000-000000000003'
const INV_ROLE_ID     = '9d100000-0000-4000-8000-000000000004'
const NO_DASH_ROLE_ID = '9d100000-0000-4000-8000-000000000005'

const UNIT_ID = '9d200000-0000-4000-8000-000000000001'
const ITEM_ID = '9d200000-0000-4000-8000-000000000002'

const DASHBOARD_PERM_CODES = [
  'dashboard.executive',
  'dashboard.spv',
  'dashboard.inventory',
  'dashboard.approval_queue',
]
const permissionIds = new Map<string, string>()

let execToken    = ''
let spvToken     = ''
let managerToken = ''
let invToken     = ''
let noDashToken  = ''

async function req(
  method: string,
  path: string,
  token?: string,
): Promise<{ status: number; body: TestResponseBody }> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await app.request(`http://localhost${path}`, { method, headers }, TEST_ENV)
  return { status: res.status, body: (await res.json()) as TestResponseBody }
}

async function tokenFor(userId: string) {
  return signAccessToken(
    { sub: userId, company_id: COMPANY_ID, roles: [], scopes: [], first_login_required: false },
    TEST_JWT_SECRET,
  )
}

async function insertPermissionCatalog() {
  await db
    .insert(permissions)
    .values(
      DASHBOARD_PERM_CODES.map((code) => {
        const [module, action] = code.split('.')
        return { code, module, action, description: `Dashboard route test: ${code}` }
      }),
    )
    .onConflictDoNothing()

  const rows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, DASHBOARD_PERM_CODES))

  for (const row of rows) permissionIds.set(row.code, row.id)
}

async function assignPermissions(roleId: string, codes: string[]) {
  await db.insert(rolePermissions).values(
    codes.map((code) => ({
      roleId,
      permissionId: permissionIds.get(code)!,
      companyId: COMPANY_ID,
    })),
  )
}

async function seedFixtures() {
  await insertPermissionCatalog()

  await db.insert(companies).values({
    id: COMPANY_ID, companyCode: 'DASH-R', companyName: 'Dashboard Routes', status: 'active',
  })

  await db.insert(brands).values({
    id: BRAND_ID, companyId: COMPANY_ID, brandCode: 'DASH-RB', brandName: 'Dash Brand', status: 'active',
  })

  await db.insert(outlets).values([
    { id: OUTLET_A_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'DASH-RA', outletName: 'Outlet A', status: 'active' },
    { id: OUTLET_B_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'DASH-RB', outletName: 'Outlet B', status: 'active' },
  ])

  await db.insert(users).values([
    { id: EXEC_USER_ID,      companyId: COMPANY_ID, email: 'dash-r-exec@egg.test',      fullName: 'Exec',      status: 'active', firstLoginRequired: false },
    { id: SPV_USER_ID,       companyId: COMPANY_ID, email: 'dash-r-spv@egg.test',       fullName: 'SPV',       status: 'active', firstLoginRequired: false },
    { id: MANAGER_USER_ID,   companyId: COMPANY_ID, email: 'dash-r-mgr@egg.test',       fullName: 'Manager',   status: 'active', firstLoginRequired: false },
    { id: INV_USER_ID,       companyId: COMPANY_ID, email: 'dash-r-inv@egg.test',       fullName: 'Inventory', status: 'active', firstLoginRequired: false },
    { id: NO_DASH_USER_ID,   companyId: COMPANY_ID, email: 'dash-r-nodash@egg.test',    fullName: 'NoDash',    status: 'active', firstLoginRequired: false },
    { id: SUBMITTER_USER_ID, companyId: COMPANY_ID, email: 'dash-r-submitter@egg.test', fullName: 'Submitter', status: 'active', firstLoginRequired: false },
  ])

  await db.insert(roles).values([
    { id: EXEC_ROLE_ID,    companyId: COMPANY_ID, code: 'DASH_R_EXEC', name: 'Dash Exec',    defaultScopeType: 'outlet', isSystem: false },
    { id: SPV_ROLE_ID,     companyId: COMPANY_ID, code: 'DASH_R_SPV',  name: 'Dash SPV',     defaultScopeType: 'outlet', isSystem: false },
    { id: MANAGER_ROLE_ID, companyId: COMPANY_ID, code: 'DASH_R_MGR',  name: 'Dash Manager', defaultScopeType: 'outlet', isSystem: false },
    { id: INV_ROLE_ID,     companyId: COMPANY_ID, code: 'DASH_R_INV',  name: 'Dash Inv',     defaultScopeType: 'outlet', isSystem: false },
    { id: NO_DASH_ROLE_ID, companyId: COMPANY_ID, code: 'DASH_R_NONE', name: 'Dash None',    defaultScopeType: 'outlet', isSystem: false },
  ])

  await assignPermissions(EXEC_ROLE_ID,    ['dashboard.executive'])
  await assignPermissions(SPV_ROLE_ID,     ['dashboard.spv', 'dashboard.approval_queue'])
  await assignPermissions(MANAGER_ROLE_ID, ['dashboard.executive', 'dashboard.inventory', 'dashboard.approval_queue'])
  await assignPermissions(INV_ROLE_ID,     ['dashboard.inventory'])
  // NO_DASH_ROLE: no dashboard permissions

  await db.insert(userRoles).values([
    { userId: EXEC_USER_ID,      roleId: EXEC_ROLE_ID,    companyId: COMPANY_ID, scopeType: 'outlet', scopeId: OUTLET_A_ID, grantedBy: EXEC_USER_ID },
    { userId: SPV_USER_ID,       roleId: SPV_ROLE_ID,     companyId: COMPANY_ID, scopeType: 'outlet', scopeId: OUTLET_A_ID, grantedBy: EXEC_USER_ID },
    { userId: MANAGER_USER_ID,   roleId: MANAGER_ROLE_ID, companyId: COMPANY_ID, scopeType: 'outlet', scopeId: OUTLET_A_ID, grantedBy: EXEC_USER_ID },
    { userId: INV_USER_ID,       roleId: INV_ROLE_ID,     companyId: COMPANY_ID, scopeType: 'outlet', scopeId: OUTLET_A_ID, grantedBy: EXEC_USER_ID },
    { userId: NO_DASH_USER_ID,   roleId: NO_DASH_ROLE_ID, companyId: COMPANY_ID, scopeType: 'outlet', scopeId: OUTLET_A_ID, grantedBy: EXEC_USER_ID },
    { userId: SUBMITTER_USER_ID, roleId: MANAGER_ROLE_ID, companyId: COMPANY_ID, scopeType: 'outlet', scopeId: OUTLET_A_ID, grantedBy: EXEC_USER_ID },
  ])

  await db.insert(units).values({ id: UNIT_ID, companyId: COMPANY_ID, code: 'PCS-R', name: 'Pieces' })
  await db.insert(items).values({
    id: ITEM_ID, companyId: COMPANY_ID, sku: 'DASH-RX', name: 'Item Dash Route', baseUnitId: UNIT_ID,
  })
}

async function resetOperational() {
  await sql`DELETE FROM pending_stock_movements WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM daily_reports WHERE company_id = ${COMPANY_ID}`
}

async function cleanupAll() {
  await sql`DELETE FROM evidence WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM pending_stock_movements WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM stock_movements WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM stock_balances WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM daily_reports WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM access_overrides WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM user_roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM role_permissions WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM users WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM items WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM units WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM outlets WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM brands WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM companies WHERE id = ${COMPANY_ID}`
}

beforeAll(async () => {
  await cleanupAll()
  await seedFixtures()
  execToken    = await tokenFor(EXEC_USER_ID)
  spvToken     = await tokenFor(SPV_USER_ID)
  managerToken = await tokenFor(MANAGER_USER_ID)
  invToken     = await tokenFor(INV_USER_ID)
  noDashToken  = await tokenFor(NO_DASH_USER_ID)
})

beforeEach(async () => {
  await resetOperational()
})

afterAll(async () => {
  await cleanupAll()
  await sql.end()
})

describe('DASHBOARD 4A routes', () => {
  // ── Auth ───────────────────────────────────────────────────────────────────

  it('no Bearer → 401 on all 4 endpoints', async () => {
    const paths = [
      '/api/v1/dashboards/executive',
      '/api/v1/dashboards/spv',
      '/api/v1/dashboards/inventory',
      '/api/v1/dashboards/approval-queue',
    ]
    for (const path of paths) {
      const { status } = await req('GET', path)
      expect(status, `expected 401 for ${path}`).toBe(401)
    }
  })

  // ── Permission matrix ──────────────────────────────────────────────────────

  it('SPV: /spv→200, /approval-queue→200, /executive→403, /inventory→403', async () => {
    expect((await req('GET', '/api/v1/dashboards/spv', spvToken)).status).toBe(200)
    expect((await req('GET', '/api/v1/dashboards/approval-queue', spvToken)).status).toBe(200)
    expect((await req('GET', '/api/v1/dashboards/executive', spvToken)).status).toBe(403)
    expect((await req('GET', '/api/v1/dashboards/inventory', spvToken)).status).toBe(403)
  })

  it('MANAGER: /executive→200, /inventory→200, /approval-queue→200, /spv→403', async () => {
    expect((await req('GET', '/api/v1/dashboards/executive', managerToken)).status).toBe(200)
    expect((await req('GET', '/api/v1/dashboards/inventory', managerToken)).status).toBe(200)
    expect((await req('GET', '/api/v1/dashboards/approval-queue', managerToken)).status).toBe(200)
    expect((await req('GET', '/api/v1/dashboards/spv', managerToken)).status).toBe(403)
  })

  it('EXEC_ONLY: /executive→200, /spv→403, /inventory→403, /approval-queue→403', async () => {
    expect((await req('GET', '/api/v1/dashboards/executive', execToken)).status).toBe(200)
    expect((await req('GET', '/api/v1/dashboards/spv', execToken)).status).toBe(403)
    expect((await req('GET', '/api/v1/dashboards/inventory', execToken)).status).toBe(403)
    expect((await req('GET', '/api/v1/dashboards/approval-queue', execToken)).status).toBe(403)
  })

  it('no-dashboard role → 403 on all 4 endpoints', async () => {
    const paths = [
      '/api/v1/dashboards/executive',
      '/api/v1/dashboards/spv',
      '/api/v1/dashboards/inventory',
      '/api/v1/dashboards/approval-queue',
    ]
    for (const path of paths) {
      const { status } = await req('GET', path, noDashToken)
      expect(status, `expected 403 for ${path}`).toBe(403)
    }
  })

  // ── Validation 422 ─────────────────────────────────────────────────────────

  it('/executive?date=bad-format → 422 ERR_VALIDATION', async () => {
    const { status, body } = await req('GET', '/api/v1/dashboards/executive?date=bad-format', execToken)
    expect(status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_VALIDATION')
  })

  it('/executive?month=2026 → 422 (not YYYY-MM format)', async () => {
    const { status, body } = await req('GET', '/api/v1/dashboards/executive?month=2026', execToken)
    expect(status).toBe(422)
    expect(body.error.code).toBe('ERR_VALIDATION')
  })

  it('/spv?date=not-a-date → 422', async () => {
    const { status, body } = await req('GET', '/api/v1/dashboards/spv?date=not-a-date', spvToken)
    expect(status).toBe(422)
    expect(body.error.code).toBe('ERR_VALIDATION')
  })

  // ── Shape checks (200 + top-level keys) ────────────────────────────────────

  it('GET /executive → 200, response shape correct', async () => {
    const { status, body } = await req('GET', '/api/v1/dashboards/executive', execToken)
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    const data = body.data as Record<string, unknown>
    expect(data).toHaveProperty('outlet_status')
    expect(data).toHaveProperty('report_compliance')
    expect(data).toHaveProperty('approval_pending')
    expect(data).toHaveProperty('stock_discrepancy')
    expect(Array.isArray(data.outlet_status)).toBe(true)
  })

  it('GET /spv → 200, response shape correct', async () => {
    const { status, body } = await req('GET', '/api/v1/dashboards/spv', spvToken)
    expect(status).toBe(200)
    const data = body.data as Record<string, unknown>
    expect(data).toHaveProperty('report_today')
    expect(data).toHaveProperty('pending_validation')
    expect(data).toHaveProperty('opname_today')
    expect(data).toHaveProperty('issue_log')
    expect(data).toHaveProperty('evidence_missing')
    expect(Array.isArray(data.report_today)).toBe(true)
  })

  it('GET /inventory → 200, response shape correct', async () => {
    const { status, body } = await req('GET', '/api/v1/dashboards/inventory', invToken)
    expect(status).toBe(200)
    const data = body.data as Record<string, unknown>
    expect(data).toHaveProperty('stock_critical')
    expect(data).toHaveProperty('movement_today')
    expect(data).toHaveProperty('waste_summary')
    expect(data).toHaveProperty('pending_validation')
    expect(data).toHaveProperty('top_discrepancy')
    const pv = data.pending_validation as Record<string, unknown>
    expect(pv).toHaveProperty('submitted_count')
    expect(pv).toHaveProperty('validated_count')
  })

  it('GET /approval-queue → 200, response shape correct', async () => {
    const { status, body } = await req('GET', '/api/v1/dashboards/approval-queue', managerToken)
    expect(status).toBe(200)
    const data = body.data as Record<string, unknown>
    expect(data).toHaveProperty('stock_movements')
    expect(data).toHaveProperty('reports_to_validate')
    const sm = data.stock_movements as Record<string, unknown>
    expect(sm).toHaveProperty('to_validate')
    expect(sm).toHaveProperty('to_finalize')
  })

  // ── Default date/month (D10) ───────────────────────────────────────────────

  it('D10 — no date/month params → 200 (defaults to todayWIB / current month)', async () => {
    expect((await req('GET', '/api/v1/dashboards/executive', execToken)).status).toBe(200)
    expect((await req('GET', '/api/v1/dashboards/spv', spvToken)).status).toBe(200)
    expect((await req('GET', '/api/v1/dashboards/inventory', invToken)).status).toBe(200)
  })

  // ── Wiring: approval-queue actionable (D7 + D8) ───────────────────────────

  it('D7 — to_validate: self-submitted → actionable=false, other-submitted → actionable=true', async () => {
    await db.insert(pendingStockMovements).values([
      {
        companyId: COMPANY_ID,
        outletId: OUTLET_A_ID,
        itemId: ITEM_ID,
        movementType: 'opname',
        inputQty: '5',
        inputUnitId: UNIT_ID,
        qtyBase: '5',
        status: 'pending',
        submittedBy: MANAGER_USER_ID,   // self → actionable=false
      },
      {
        companyId: COMPANY_ID,
        outletId: OUTLET_A_ID,
        itemId: ITEM_ID,
        movementType: 'waste',
        inputQty: '2',
        inputUnitId: UNIT_ID,
        qtyBase: '2',
        status: 'pending',
        submittedBy: SUBMITTER_USER_ID,  // other → actionable=true
      },
    ])

    const { status, body } = await req('GET', '/api/v1/dashboards/approval-queue', managerToken)
    expect(status).toBe(200)

    const data = body.data as unknown as {
      stock_movements: { to_validate: Array<{ submitted_by: string; actionable: boolean }> }
    }
    const toValidate = data.stock_movements.to_validate

    const self = toValidate.find((r) => r.submitted_by === MANAGER_USER_ID)
    const other = toValidate.find((r) => r.submitted_by === SUBMITTER_USER_ID)

    expect(self).toBeDefined()
    expect(self!.actionable).toBe(false)
    expect(other).toBeDefined()
    expect(other!.actionable).toBe(true)
  })

  it('D8 — reports_to_validate entries have no actionable field', async () => {
    await db.insert(dailyReports).values({
      companyId: COMPANY_ID,
      outletId: OUTLET_A_ID,
      reportType: 'opening',
      reportDate: '2026-07-01',
      status: 'submitted',
      createdBy: SUBMITTER_USER_ID,
      submittedBy: SUBMITTER_USER_ID,
      submittedAt: new Date('2026-07-01T10:00:00Z'),
    })

    const { status, body } = await req('GET', '/api/v1/dashboards/approval-queue', managerToken)
    expect(status).toBe(200)

    const data = body.data as unknown as {
      reports_to_validate: Array<Record<string, unknown>>
    }
    expect(data.reports_to_validate.length).toBeGreaterThanOrEqual(1)
    for (const item of data.reports_to_validate) {
      expect(item).not.toHaveProperty('actionable')
    }
  })
})
