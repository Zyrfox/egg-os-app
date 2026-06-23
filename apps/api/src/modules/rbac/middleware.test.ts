import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { inArray } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  departments,
  outlets,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@egg-os/db'
import { authMiddleware } from '../../middleware/auth'
import { okResponse } from '../../lib/errors'
import { signAccessToken } from '../../lib/jwt'
import type { AuthCtx, Env } from '../../types'
import { requirePermission, type AccessFilter, type RbacVariables } from './middleware'

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars'
const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
}

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

const COMPANY_ID = '33333333-3333-4333-8333-333333333333'
const BRAND_A_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const BRAND_B_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const OUTLET_A_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
const OUTLET_B_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'
const DEPARTMENT_A_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'

const SPV_USER_ID = '30000000-0000-4000-8000-000000000001'
const STAFF_USER_ID = '30000000-0000-4000-8000-000000000002'
const NO_ROLE_USER_ID = '30000000-0000-4000-8000-000000000003'

const SPV_ROLE_ID = '40000000-0000-4000-8000-000000000001'
const STAFF_ROLE_ID = '40000000-0000-4000-8000-000000000002'

const permissionCodes = ['inventory.read', 'reports.submit']
const permissionIds = new Map<string, string>()

type TestVariables = RbacVariables & {
  auth: AuthCtx
  accessFilter?: AccessFilter
}

const testApp = new Hono<{ Bindings: Env; Variables: TestVariables }>()

testApp.get(
  '/covered',
  authMiddleware,
  requirePermission('inventory.read', () => ({ scopeType: 'outlet', scopeId: OUTLET_A_ID })),
  (c) => c.json(okResponse({ reached: true }), 200)
)

testApp.get(
  '/missing-permission',
  authMiddleware,
  requirePermission('rbac.role_read'),
  (c) => c.json(okResponse({ reached: true }), 200)
)

testApp.get(
  '/out-of-scope',
  authMiddleware,
  requirePermission('inventory.read', () => ({ scopeType: 'outlet', scopeId: OUTLET_B_ID })),
  (c) => c.json(okResponse({ reached: true }), 200)
)

testApp.get(
  '/row-level',
  authMiddleware,
  requirePermission('reports.submit', () => ({ scopeType: 'outlet', scopeId: OUTLET_A_ID })),
  (c) => c.json(okResponse({ reached: true, access_filter: c.get('accessFilter') }), 200)
)

async function req(path: string, token?: string) {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await testApp.request(`http://localhost${path}`, { method: 'GET', headers }, TEST_ENV)
  return { status: res.status, body: await res.json() }
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
  await sql`DELETE FROM access_overrides WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM user_roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM role_permissions WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM users WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM departments WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM outlets WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM brands WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM companies WHERE id = ${COMPANY_ID}`
}

async function insertPermissionCatalog() {
  await db
    .insert(permissions)
    .values(
      permissionCodes.map((code) => {
        const [module, action] = code.split('.')
        return {
          code,
          module,
          action,
          description: `RBAC middleware test permission ${code}`,
        }
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

beforeAll(async () => {
  await cleanupFixtures()
  await insertPermissionCatalog()

  await db.insert(companies).values({
    id: COMPANY_ID,
    companyCode: 'RBAC-MW',
    companyName: 'RBAC Middleware Test Company',
    status: 'active',
  })

  await db.insert(brands).values([
    {
      id: BRAND_A_ID,
      companyId: COMPANY_ID,
      brandCode: 'MW-A',
      brandName: 'Middleware Brand A',
      status: 'active',
    },
    {
      id: BRAND_B_ID,
      companyId: COMPANY_ID,
      brandCode: 'MW-B',
      brandName: 'Middleware Brand B',
      status: 'active',
    },
  ])

  await db.insert(outlets).values([
    {
      id: OUTLET_A_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_A_ID,
      outletCode: 'MW-A-01',
      outletName: 'Middleware Outlet A',
      status: 'active',
    },
    {
      id: OUTLET_B_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_B_ID,
      outletCode: 'MW-B-01',
      outletName: 'Middleware Outlet B',
      status: 'active',
    },
  ])

  await db.insert(departments).values({
    id: DEPARTMENT_A_ID,
    companyId: COMPANY_ID,
    brandId: BRAND_A_ID,
    outletId: OUTLET_A_ID,
    departmentCode: 'MW-INV-A',
    departmentName: 'Middleware Inventory A',
    departmentType: 'inventory',
    status: 'active',
  })

  await db.insert(users).values([
    {
      id: SPV_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-mw-spv@egg.test',
      fullName: 'RBAC Middleware SPV',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: STAFF_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-mw-staff@egg.test',
      fullName: 'RBAC Middleware Staff',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: NO_ROLE_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-mw-no-role@egg.test',
      fullName: 'RBAC Middleware No Role',
      status: 'active',
      firstLoginRequired: false,
    },
  ])

  await db.insert(roles).values([
    {
      id: SPV_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'SPV_OUTLET',
      name: 'SPV Outlet',
      defaultScopeType: 'outlet',
      isSystem: true,
    },
    {
      id: STAFF_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'STAFF',
      name: 'Staff',
      defaultScopeType: 'own',
      isSystem: true,
    },
  ])

  await db.insert(rolePermissions).values([
    {
      roleId: SPV_ROLE_ID,
      permissionId: permissionIds.get('inventory.read')!,
      companyId: COMPANY_ID,
    },
    {
      roleId: STAFF_ROLE_ID,
      permissionId: permissionIds.get('reports.submit')!,
      companyId: COMPANY_ID,
    },
  ])

  await db.insert(userRoles).values([
    {
      userId: SPV_USER_ID,
      roleId: SPV_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'outlet',
      scopeId: OUTLET_A_ID,
    },
    {
      userId: STAFF_USER_ID,
      roleId: STAFF_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'own',
      scopeId: null,
    },
  ])
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('RBAC requirePermission middleware', () => {
  it('M1 — tanpa Bearer → 401 ERR_UNAUTHENTICATED', async () => {
    const { status, body } = await req('/covered')

    expect(status).toBe(401)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_UNAUTHENTICATED')
  })

  it('M2 — user punya permission + scope cover → next() jalan', async () => {
    const { status, body } = await req('/covered', await tokenFor(SPV_USER_ID))

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.reached).toBe(true)
  })

  it('M3 — user tidak punya permission sama sekali → 403 ERR_FORBIDDEN', async () => {
    const { status, body } = await req('/missing-permission', await tokenFor(NO_ROLE_USER_ID))

    expect(status).toBe(403)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_FORBIDDEN')
  })

  it('M4 — user punya permission tapi target resource beda scope → 404 ERR_OUT_OF_SCOPE', async () => {
    const { status, body } = await req('/out-of-scope', await tokenFor(SPV_USER_ID))

    expect(status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_OUT_OF_SCOPE')
  })

  it('M5 — user row-level own → next() jalan + ctx.accessFilter ter-set', async () => {
    const { status, body } = await req('/row-level', await tokenFor(STAFF_USER_ID))

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.reached).toBe(true)
    expect(body.data.access_filter).toMatchObject({
      permission: 'reports.submit',
      ownOnly: true,
      assignedOnly: false,
    })
  })
})
