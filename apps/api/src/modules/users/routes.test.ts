import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { inArray } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  companies,
  permissions,
  refreshTokens,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@egg-os/db'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import { generateToken, hashToken } from '../../lib/crypto'
import { AUTH } from '../../lib/constants'
import type { TestResponseBody } from '../../test/types'

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars'
const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
}

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

const COMPANY_ID = '99999999-9999-4999-8999-999999999999'
const ADMIN_USER_ID = '91000000-0000-4000-8000-000000000001'
const DETAIL_USER_ID = '91000000-0000-4000-8000-000000000002'
const UPDATE_USER_ID = '91000000-0000-4000-8000-000000000003'
const SUSPEND_USER_ID = '91000000-0000-4000-8000-000000000004'
const REACTIVATE_USER_ID = '91000000-0000-4000-8000-000000000005'
const ARCHIVE_USER_ID = '91000000-0000-4000-8000-000000000006'
const ROLE_TARGET_USER_ID = '91000000-0000-4000-8000-000000000007'
const RESET_USER_ID = '91000000-0000-4000-8000-000000000008'

const ADMIN_ROLE_ID = '92000000-0000-4000-8000-000000000001'
const ASSIGNABLE_ROLE_ID = '92000000-0000-4000-8000-000000000002'

const permissionCodes = [
  'users.read',
  'users.create',
  'users.update',
  'users.suspend',
  'users.archive',
  'rbac.role_assign',
]

const permissionIds = new Map<string, string>()
let adminToken = ''

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
  await sql`DELETE FROM auth_events WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM access_overrides WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM user_roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM role_permissions WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM password_tokens WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM refresh_tokens WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM users WHERE company_id = ${COMPANY_ID}`
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
          description: `USERS route smoke permission ${code}`,
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

async function seedFixtures() {
  await insertPermissionCatalog()

  await db.insert(companies).values({
    id: COMPANY_ID,
    companyCode: 'USERS-SMOKE',
    companyName: 'USERS Smoke Test Company',
    status: 'active',
  })

  await db.insert(users).values([
    {
      id: ADMIN_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-smoke-admin@egg.test',
      fullName: 'USERS Smoke Admin',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: DETAIL_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-smoke-detail@egg.test',
      fullName: 'USERS Smoke Detail',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: UPDATE_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-smoke-update@egg.test',
      fullName: 'USERS Smoke Update',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: SUSPEND_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-smoke-suspend@egg.test',
      fullName: 'USERS Smoke Suspend',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: REACTIVATE_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-smoke-reactivate@egg.test',
      fullName: 'USERS Smoke Reactivate',
      status: 'suspended',
      firstLoginRequired: false,
    },
    {
      id: ARCHIVE_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-smoke-archive@egg.test',
      fullName: 'USERS Smoke Archive',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: ROLE_TARGET_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-smoke-role-target@egg.test',
      fullName: 'USERS Smoke Role Target',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: RESET_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-smoke-reset@egg.test',
      fullName: 'USERS Smoke Reset',
      status: 'active',
      firstLoginRequired: false,
    },
  ])

  await db.insert(roles).values([
    {
      id: ADMIN_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'USERS_SMOKE_ADMIN',
      name: 'USERS Smoke Admin',
      defaultScopeType: 'company',
      isSystem: false,
    },
    {
      id: ASSIGNABLE_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'USERS_SMOKE_ASSIGNABLE',
      name: 'USERS Smoke Assignable',
      defaultScopeType: 'company',
      isSystem: false,
    },
  ])

  await db.insert(rolePermissions).values(
    permissionCodes.map((code) => ({
      roleId: ADMIN_ROLE_ID,
      permissionId: permissionIds.get(code)!,
      companyId: COMPANY_ID,
    }))
  )

  await db.insert(userRoles).values({
    userId: ADMIN_USER_ID,
    roleId: ADMIN_ROLE_ID,
    companyId: COMPANY_ID,
    scopeType: 'company',
    scopeId: null,
    grantedBy: ADMIN_USER_ID,
  })

  await db.insert(refreshTokens).values({
    userId: ARCHIVE_USER_ID,
    companyId: COMPANY_ID,
    tokenHash: hashToken(generateToken()),
    expiresAt: new Date(Date.now() + AUTH.REFRESH_TTL_SEC * 1000),
  })
}

function expectSuccessEnvelope(body: any) {
  expect(body.success).toBe(true)
  expect(body.data).toBeDefined()
}

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
  adminToken = await tokenFor(ADMIN_USER_ID)
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('USERS routes — happy-path smoke', () => {
  it('GET /users returns paginated success envelope', async () => {
    const { status, body } = await req('GET', '/api/v1/users?page=1&page_size=5', adminToken)

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.meta).toMatchObject({ page: 1, page_size: 5 })
  })

  it('GET /users/:id returns detail success envelope', async () => {
    const { status, body } = await req('GET', `/api/v1/users/${DETAIL_USER_ID}`, adminToken)

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    expect(body.data.id).toBe(DETAIL_USER_ID)
    expect(Array.isArray(body.data.roles)).toBe(true)
  })

  it('POST /users invites a user with success envelope', async () => {
    const { status, body } = await req('POST', '/api/v1/users', adminToken, {
      email: 'users-smoke-invited@egg.test',
      full_name: 'USERS Smoke Invited',
    })

    expect(status).toBe(201)
    expectSuccessEnvelope(body)
    expect(body.data.email).toBe('users-smoke-invited@egg.test')
    expect(body.data.status).toBe('invited')
    expect(body.data.first_login_required).toBe(true)
  })

  it('PATCH /users/:id updates a user with success envelope', async () => {
    const { status, body } = await req('PATCH', `/api/v1/users/${UPDATE_USER_ID}`, adminToken, {
      full_name: 'USERS Smoke Updated',
      phone: '08123456789',
    })

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    expect(body.data.full_name).toBe('USERS Smoke Updated')
    expect(body.data.phone).toBe('08123456789')
  })

  it('POST /users/:id/suspend suspends an active user', async () => {
    const { status, body } = await req('POST', `/api/v1/users/${SUSPEND_USER_ID}/suspend`, adminToken)

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    expect(body.data.status).toBe('suspended')
  })

  it('POST /users/:id/reactivate reactivates a suspended user', async () => {
    const { status, body } = await req('POST', `/api/v1/users/${REACTIVATE_USER_ID}/reactivate`, adminToken)

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    expect(body.data.status).toBe('active')
  })

  it('POST /users/:id/archive archives a user with success envelope', async () => {
    const { status, body } = await req('POST', `/api/v1/users/${ARCHIVE_USER_ID}/archive`, adminToken)

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    expect(body.data.status).toBe('archived')
  })

  it('POST /users/:id/roles assigns a role with success envelope', async () => {
    const { status, body } = await req('POST', `/api/v1/users/${ROLE_TARGET_USER_ID}/roles`, adminToken, {
      role_id: ASSIGNABLE_ROLE_ID,
      scope_type: 'company',
      scope_id: null,
    })

    expect(status).toBe(201)
    expectSuccessEnvelope(body)
    expect(body.data.role_code).toBe('USERS_SMOKE_ASSIGNABLE')
  })

  it('DELETE /users/:id/roles/:assignmentId revokes a role with success envelope', async () => {
    const [assignment] = await db
      .insert(userRoles)
      .values({
        userId: ROLE_TARGET_USER_ID,
        roleId: ASSIGNABLE_ROLE_ID,
        companyId: COMPANY_ID,
        scopeType: 'company',
        scopeId: null,
        grantedBy: ADMIN_USER_ID,
      })
      .onConflictDoNothing()
      .returning({ id: userRoles.id })

    const assignmentId = assignment?.id ?? await sql`
      SELECT id FROM user_roles
      WHERE company_id = ${COMPANY_ID}
        AND user_id = ${ROLE_TARGET_USER_ID}
        AND role_id = ${ASSIGNABLE_ROLE_ID}
        AND deleted_at IS NULL
      LIMIT 1
    `.then((rows) => rows[0].id as string)

    const { status, body } = await req(
      'DELETE',
      `/api/v1/users/${ROLE_TARGET_USER_ID}/roles/${assignmentId}`,
      adminToken
    )

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    expect(body.data.deleted_at).not.toBeNull()
  })

  it('POST /users/:id/reset-password creates reset request success envelope', async () => {
    const { status, body } = await req('POST', `/api/v1/users/${RESET_USER_ID}/reset-password`, adminToken)

    expect(status).toBe(200)
    expectSuccessEnvelope(body)
    expect(body.data.first_login_required).toBe(true)
  })
})
