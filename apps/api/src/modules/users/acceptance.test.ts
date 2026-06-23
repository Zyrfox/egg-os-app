import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  departments,
  passwordTokens,
  permissions,
  refreshTokens,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@egg-os/db'
import app from '../../index'
import { AUTH } from '../../lib/constants'
import { generateToken, hashToken } from '../../lib/crypto'
import { signAccessToken } from '../../lib/jwt'
import { resolveUserPermissions } from '../rbac/resolve'

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars'
const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
}

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

const COMPANY_ID = '93000000-0000-4000-8000-000000000001'
const OTHER_COMPANY_ID = '93000000-0000-4000-8000-000000000002'
const BRAND_ID = '93000000-0000-4000-8000-000000000003'
const OUTLET_ID = '93000000-0000-4000-8000-000000000004'
const DEPARTMENT_ID = '93000000-0000-4000-8000-000000000005'

const ADMIN_COMPANY_ID = '93100000-0000-4000-8000-000000000001'
const ADMIN_OUTLET_ID = '93100000-0000-4000-8000-000000000002'
const NO_READ_USER_ID = '93100000-0000-4000-8000-000000000003'
const OTHER_COMPANY_USER_ID = '93100000-0000-4000-8000-000000000004'
const DETAIL_USER_ID = '93100000-0000-4000-8000-000000000005'
const ACTIVE_FILTER_USER_ID = '93100000-0000-4000-8000-000000000006'
const SUSPENDED_FILTER_USER_ID = '93100000-0000-4000-8000-000000000007'
const UPDATE_USER_ID = '93100000-0000-4000-8000-000000000008'
const SUSPEND_USER_ID = '93100000-0000-4000-8000-000000000009'
const REACTIVATE_USER_ID = '93100000-0000-4000-8000-000000000010'
const INVITED_LIFECYCLE_USER_ID = '93100000-0000-4000-8000-000000000011'
const ARCHIVE_USER_ID = '93100000-0000-4000-8000-000000000012'
const ARCHIVED_TERMINAL_USER_ID = '93100000-0000-4000-8000-000000000013'
const ROLE_TARGET_USER_ID = '93100000-0000-4000-8000-000000000014'
const REVOKE_TARGET_USER_ID = '93100000-0000-4000-8000-000000000015'
const RESET_TARGET_USER_ID = '93100000-0000-4000-8000-000000000016'

const ERP_OWNER_ROLE_ID = '93200000-0000-4000-8000-000000000001'
const SPV_OUTLET_ROLE_ID = '93200000-0000-4000-8000-000000000002'
const SUPER_ADMIN_ROLE_ID = '93200000-0000-4000-8000-000000000003'
const STAFF_ROLE_ID = '93200000-0000-4000-8000-000000000004'
const NO_READ_ROLE_ID = '93200000-0000-4000-8000-000000000005'

const permissionCodes = [
  'users.read',
  'users.create',
  'users.update',
  'users.suspend',
  'users.archive',
  'rbac.role_assign',
  'inventory.read',
]

const permissionIds = new Map<string, string>()
let adminCompanyToken = ''
let adminOutletToken = ''
let noReadToken = ''
let revokeAssignmentId = ''

async function req(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: any }> {
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
  await sql`DELETE FROM auth_events WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM access_overrides WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM user_roles WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM role_permissions WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM roles WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM password_tokens WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM refresh_tokens WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM users WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM departments WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM outlets WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM brands WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM companies WHERE id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
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
          description: `USERS acceptance permission ${code}`,
        }
      })
    )
    .onConflictDoNothing()

  const rows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, permissionCodes))

  for (const row of rows) permissionIds.set(row.code, row.id)
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
      companyCode: 'USERS-ACC',
      companyName: 'USERS Acceptance Company',
      status: 'active',
    },
    {
      id: OTHER_COMPANY_ID,
      companyCode: 'USERS-ACC-B',
      companyName: 'USERS Acceptance Other Company',
      status: 'active',
    },
  ])

  await db.insert(brands).values({
    id: BRAND_ID,
    companyId: COMPANY_ID,
    brandCode: 'BTMK-USERS',
    brandName: 'BTMK USERS',
    status: 'active',
  })

  await db.insert(departments).values({
    id: DEPARTMENT_ID,
    companyId: COMPANY_ID,
    brandId: BRAND_ID,
    outletId: null,
    departmentCode: 'HQ-USERS',
    departmentName: 'HQ USERS',
    departmentType: 'hq',
    status: 'active',
  })

  await sql`
    INSERT INTO outlets (id, company_id, brand_id, outlet_code, outlet_name, status)
    VALUES (${OUTLET_ID}, ${COMPANY_ID}, ${BRAND_ID}, 'BTMK-01-USERS', 'BTMK 01 USERS', 'active')
  `

  await db.insert(users).values([
    {
      id: ADMIN_COMPANY_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-admin-company@egg.test',
      fullName: 'USERS Acceptance ERP Owner',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: ADMIN_OUTLET_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-admin-outlet@egg.test',
      fullName: 'USERS Acceptance SPV Outlet',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: NO_READ_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-no-read@egg.test',
      fullName: 'USERS Acceptance No Read',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: OTHER_COMPANY_USER_ID,
      companyId: OTHER_COMPANY_ID,
      email: 'users-acc-other-company@egg.test',
      fullName: 'USERS Acceptance Other Company',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: DETAIL_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-detail@egg.test',
      fullName: 'USERS Acceptance Detail',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: ACTIVE_FILTER_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-active-filter@egg.test',
      fullName: 'USERS Acceptance Active Filter',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: SUSPENDED_FILTER_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-suspended-filter@egg.test',
      fullName: 'USERS Acceptance Suspended Filter',
      status: 'suspended',
      firstLoginRequired: false,
    },
    {
      id: UPDATE_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-update@egg.test',
      fullName: 'USERS Acceptance Update',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: SUSPEND_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-suspend@egg.test',
      fullName: 'USERS Acceptance Suspend',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: REACTIVATE_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-reactivate@egg.test',
      fullName: 'USERS Acceptance Reactivate',
      status: 'suspended',
      firstLoginRequired: false,
    },
    {
      id: INVITED_LIFECYCLE_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-invited-lifecycle@egg.test',
      fullName: 'USERS Acceptance Invited Lifecycle',
      status: 'invited',
      firstLoginRequired: true,
    },
    {
      id: ARCHIVE_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-archive@egg.test',
      fullName: 'USERS Acceptance Archive',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: ARCHIVED_TERMINAL_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-archived-terminal@egg.test',
      fullName: 'USERS Acceptance Archived Terminal',
      status: 'archived',
      firstLoginRequired: false,
      deletedAt: new Date(),
    },
    {
      id: ROLE_TARGET_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-role-target@egg.test',
      fullName: 'USERS Acceptance Role Target',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: REVOKE_TARGET_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-revoke-target@egg.test',
      fullName: 'USERS Acceptance Revoke Target',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: RESET_TARGET_USER_ID,
      companyId: COMPANY_ID,
      email: 'users-acc-reset-target@egg.test',
      fullName: 'USERS Acceptance Reset Target',
      status: 'active',
      firstLoginRequired: false,
    },
  ])

  await db.insert(roles).values([
    {
      id: ERP_OWNER_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'ERP_OWNER',
      name: 'ERP Owner',
      defaultScopeType: 'company',
      isSystem: true,
    },
    {
      id: SPV_OUTLET_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'SPV_OUTLET',
      name: 'SPV Outlet',
      defaultScopeType: 'outlet',
      isSystem: true,
    },
    {
      id: SUPER_ADMIN_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'SUPER_ADMIN',
      name: 'Super Admin',
      defaultScopeType: 'global',
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
    {
      id: NO_READ_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'NO_USERS_READ',
      name: 'No Users Read',
      defaultScopeType: 'company',
      isSystem: false,
    },
  ])

  await assignPermissions(ERP_OWNER_ROLE_ID, permissionCodes)
  await assignPermissions(SPV_OUTLET_ROLE_ID, ['users.read', 'users.create', 'rbac.role_assign'])
  await assignPermissions(SUPER_ADMIN_ROLE_ID, permissionCodes)
  await assignPermissions(STAFF_ROLE_ID, ['inventory.read'])
  await assignPermissions(NO_READ_ROLE_ID, ['users.create'])

  const [revokeAssignment] = await db.insert(userRoles).values([
    {
      userId: ADMIN_COMPANY_ID,
      roleId: ERP_OWNER_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'company',
      scopeId: null,
      grantedBy: ADMIN_COMPANY_ID,
    },
    {
      userId: ADMIN_OUTLET_ID,
      roleId: SPV_OUTLET_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'outlet',
      scopeId: OUTLET_ID,
      grantedBy: ADMIN_COMPANY_ID,
    },
    {
      userId: NO_READ_USER_ID,
      roleId: NO_READ_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'company',
      scopeId: null,
      grantedBy: ADMIN_COMPANY_ID,
    },
    {
      userId: DETAIL_USER_ID,
      roleId: STAFF_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'own',
      scopeId: null,
      grantedBy: ADMIN_COMPANY_ID,
    },
    {
      userId: ARCHIVE_USER_ID,
      roleId: STAFF_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'own',
      scopeId: null,
      grantedBy: ADMIN_COMPANY_ID,
    },
    {
      userId: REVOKE_TARGET_USER_ID,
      roleId: STAFF_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'own',
      scopeId: null,
      grantedBy: ADMIN_COMPANY_ID,
    },
  ]).returning({ id: userRoles.id, userId: userRoles.userId })

  revokeAssignmentId = revokeAssignment.userId === REVOKE_TARGET_USER_ID
    ? revokeAssignment.id
    : await db
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(and(eq(userRoles.companyId, COMPANY_ID), eq(userRoles.userId, REVOKE_TARGET_USER_ID), eq(userRoles.roleId, STAFF_ROLE_ID)))
        .limit(1)
        .then((rows) => rows[0].id)

  await db.insert(refreshTokens).values({
    userId: ARCHIVE_USER_ID,
    companyId: COMPANY_ID,
    tokenHash: hashToken(generateToken()),
    expiresAt: new Date(Date.now() + AUTH.REFRESH_TTL_SEC * 1000),
  })
}

function expectError(body: any, code: string) {
  expect(body.success).toBe(false)
  expect(body.error.code).toBe(code)
}

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
  adminCompanyToken = await tokenFor(ADMIN_COMPANY_ID)
  adminOutletToken = await tokenFor(ADMIN_OUTLET_ID)
  noReadToken = await tokenFor(NO_READ_USER_ID)
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('USERS acceptance — invite', () => {
  it('U1 — email baru valid -> 201 invited + first_login_required + set-password token', async () => {
    const { status, body } = await req('POST', '/api/v1/users', adminCompanyToken, {
      email: 'users-acc-u1-invite@egg.test',
      full_name: 'USERS Acceptance U1 Invite',
    })

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('invited')
    expect(body.data.first_login_required).toBe(true)

    const tokens = await db
      .select({ id: passwordTokens.id })
      .from(passwordTokens)
      .where(and(eq(passwordTokens.companyId, COMPANY_ID), eq(passwordTokens.userId, body.data.id), eq(passwordTokens.type, 'set_password')))

    expect(tokens).toHaveLength(1)
  })

  it('U2 — email sudah ada di company -> 409 ERR_DUPLICATE', async () => {
    const { status, body } = await req('POST', '/api/v1/users', adminCompanyToken, {
      email: 'users-acc-detail@egg.test',
      full_name: 'USERS Acceptance Duplicate',
    })

    expect(status).toBe(409)
    expectError(body, 'ERR_DUPLICATE')
  })

  it('U3 — body.role disertakan -> user dibuat + role ter-assign', async () => {
    const { status, body } = await req('POST', '/api/v1/users', adminCompanyToken, {
      email: 'users-acc-u3-role@egg.test',
      full_name: 'USERS Acceptance U3 Role',
      role: {
        role_id: STAFF_ROLE_ID,
        scope_type: 'own',
        scope_id: null,
      },
    })

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.roles.map((role: { role_code: string }) => role.role_code)).toContain('STAFF')

    const assignments = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.companyId, COMPANY_ID), eq(userRoles.userId, body.data.id), eq(userRoles.roleId, STAFF_ROLE_ID), isNull(userRoles.deletedAt)))

    expect(assignments).toHaveLength(1)
  })

  it('U4 — SPV outlet tidak boleh invite+assign SUPER_ADMIN', async () => {
    const { status, body } = await req('POST', '/api/v1/users', adminOutletToken, {
      email: 'users-acc-u4-super-admin@egg.test',
      full_name: 'USERS Acceptance U4 Super Admin',
      role: {
        role_id: SUPER_ADMIN_ROLE_ID,
        scope_type: 'global',
        scope_id: null,
      },
    })

    expect(status).toBe(403)
    expectError(body, 'ERR_FORBIDDEN')

    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, COMPANY_ID), eq(users.email, 'users-acc-u4-super-admin@egg.test')))

    expect(rows).toHaveLength(0)
  })
})

describe('USERS acceptance — list/detail', () => {
  it('U5 — admin company-scope lihat semua user company', async () => {
    const { status, body } = await req('GET', '/api/v1/users?page=1&page_size=100', adminCompanyToken)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    const ids = body.data.map((user: { id: string }) => user.id)
    expect(ids).toEqual(expect.arrayContaining([ADMIN_COMPANY_ID, ADMIN_OUTLET_ID, DETAIL_USER_ID, ACTIVE_FILTER_USER_ID]))
    expect(ids).not.toContain(OTHER_COMPANY_USER_ID)
  })

  it('U6 — GET /users/:id user company B -> 404 ERR_OUT_OF_SCOPE', async () => {
    const { status, body } = await req('GET', `/api/v1/users/${OTHER_COMPANY_USER_ID}`, adminCompanyToken)

    expect(status).toBe(404)
    expectError(body, 'ERR_OUT_OF_SCOPE')
  })

  it('U7 — query status=active hanya return user active', async () => {
    const { status, body } = await req('GET', '/api/v1/users?status=active&page_size=100', adminCompanyToken)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
    expect(body.data.every((user: { status: string }) => user.status === 'active')).toBe(true)
  })

  it('U8 — detail termasuk roles[] user', async () => {
    const { status, body } = await req('GET', `/api/v1/users/${DETAIL_USER_ID}`, adminCompanyToken)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.id).toBe(DETAIL_USER_ID)
    expect(body.data.roles).toEqual([
      expect.objectContaining({
        role_code: 'STAFF',
        scope_type: 'own',
        scope_id: null,
      }),
    ])
  })
})

describe('USERS acceptance — update', () => {
  it('U9 — PATCH full_name tersimpan dan updated_at berubah', async () => {
    const [before] = await db.select().from(users).where(eq(users.id, UPDATE_USER_ID))

    const { status, body } = await req('PATCH', `/api/v1/users/${UPDATE_USER_ID}`, adminCompanyToken, {
      full_name: 'USERS Acceptance Updated Name',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.full_name).toBe('USERS Acceptance Updated Name')

    const [after] = await db.select().from(users).where(eq(users.id, UPDATE_USER_ID))
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())
  })

  it('U10 — PATCH body kosong -> 422 ERR_VALIDATION', async () => {
    const { status, body } = await req('PATCH', `/api/v1/users/${UPDATE_USER_ID}`, adminCompanyToken, {})

    expect(status).toBe(422)
    expectError(body, 'ERR_VALIDATION')
  })
})

describe('USERS acceptance — lifecycle', () => {
  it('U11 — user active -> suspend -> suspended', async () => {
    const { status, body } = await req('POST', `/api/v1/users/${SUSPEND_USER_ID}/suspend`, adminCompanyToken)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('suspended')
  })

  it('U12 — user suspended -> reactivate -> active', async () => {
    const { status, body } = await req('POST', `/api/v1/users/${REACTIVATE_USER_ID}/reactivate`, adminCompanyToken)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('active')
  })

  it('U13 — user invited di-suspend/reactivate -> 422 ERR_VALIDATION', async () => {
    const suspend = await req('POST', `/api/v1/users/${INVITED_LIFECYCLE_USER_ID}/suspend`, adminCompanyToken)
    expect(suspend.status).toBe(422)
    expectError(suspend.body, 'ERR_VALIDATION')

    const reactivate = await req('POST', `/api/v1/users/${INVITED_LIFECYCLE_USER_ID}/reactivate`, adminCompanyToken)
    expect(reactivate.status).toBe(422)
    expectError(reactivate.body, 'ERR_VALIDATION')
  })

  it('U14 — admin suspend/archive dirinya sendiri -> 422 ERR_VALIDATION', async () => {
    const suspend = await req('POST', `/api/v1/users/${ADMIN_COMPANY_ID}/suspend`, adminCompanyToken)
    expect(suspend.status).toBe(422)
    expectError(suspend.body, 'ERR_VALIDATION')

    const archive = await req('POST', `/api/v1/users/${ADMIN_COMPANY_ID}/archive`, adminCompanyToken)
    expect(archive.status).toBe(422)
    expectError(archive.body, 'ERR_VALIDATION')
  })

  it('U15 — archive sets archived/deleted_at and revokes refresh tokens + user_roles', async () => {
    const { status, body } = await req('POST', `/api/v1/users/${ARCHIVE_USER_ID}/archive`, adminCompanyToken)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('archived')

    const [archivedUser] = await db.select().from(users).where(eq(users.id, ARCHIVE_USER_ID))
    expect(archivedUser.status).toBe('archived')
    expect(archivedUser.deletedAt).not.toBeNull()

    const activeRefreshTokens = await db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.companyId, COMPANY_ID), eq(refreshTokens.userId, ARCHIVE_USER_ID), isNull(refreshTokens.revokedAt)))
    expect(activeRefreshTokens).toHaveLength(0)

    const activeAssignments = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.companyId, COMPANY_ID), eq(userRoles.userId, ARCHIVE_USER_ID), isNull(userRoles.deletedAt)))
    expect(activeAssignments).toHaveLength(0)
  })

  it('U16 — user archived suspend/reactivate/archive -> 422 terminal', async () => {
    const suspend = await req('POST', `/api/v1/users/${ARCHIVED_TERMINAL_USER_ID}/suspend`, adminCompanyToken)
    expect(suspend.status).toBe(422)
    expectError(suspend.body, 'ERR_VALIDATION')

    const reactivate = await req('POST', `/api/v1/users/${ARCHIVED_TERMINAL_USER_ID}/reactivate`, adminCompanyToken)
    expect(reactivate.status).toBe(422)
    expectError(reactivate.body, 'ERR_VALIDATION')

    const archive = await req('POST', `/api/v1/users/${ARCHIVED_TERMINAL_USER_ID}/archive`, adminCompanyToken)
    expect(archive.status).toBe(422)
    expectError(archive.body, 'ERR_VALIDATION')
  })
})

describe('USERS acceptance — role', () => {
  it('U17 — assign role -> user_roles bertambah', async () => {
    const { status, body } = await req('POST', `/api/v1/users/${ROLE_TARGET_USER_ID}/roles`, adminCompanyToken, {
      role_id: STAFF_ROLE_ID,
      scope_type: 'own',
      scope_id: null,
    })

    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.role_code).toBe('STAFF')

    const rows = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.companyId, COMPANY_ID), eq(userRoles.userId, ROLE_TARGET_USER_ID), eq(userRoles.roleId, STAFF_ROLE_ID), isNull(userRoles.deletedAt)))
    expect(rows).toHaveLength(1)
  })

  it('U18 — revoke role -> soft-deleted dan permission hilang dari resolve', async () => {
    const before = await resolveUserPermissions(db, REVOKE_TARGET_USER_ID, COMPANY_ID)
    expect(before.grants.some((grant) => grant.permission === 'inventory.read')).toBe(true)

    const { status, body } = await req(
      'DELETE',
      `/api/v1/users/${REVOKE_TARGET_USER_ID}/roles/${revokeAssignmentId}`,
      adminCompanyToken
    )

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.deleted_at).not.toBeNull()

    const after = await resolveUserPermissions(db, REVOKE_TARGET_USER_ID, COMPANY_ID)
    expect(after.grants.some((grant) => grant.permission === 'inventory.read')).toBe(false)
  })
})

describe('USERS acceptance — reset/enforcement', () => {
  it('U19 — reset token dibuat, first_login_required=true, password/token tidak diekspos', async () => {
    const { status, body } = await req('POST', `/api/v1/users/${RESET_TARGET_USER_ID}/reset-password`, adminCompanyToken)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.first_login_required).toBe(true)
    expect(body.data.password).toBeUndefined()
    expect(body.data.password_hash).toBeUndefined()
    expect(body.data.token).toBeUndefined()

    const tokens = await db
      .select({ id: passwordTokens.id })
      .from(passwordTokens)
      .where(and(eq(passwordTokens.companyId, COMPANY_ID), eq(passwordTokens.userId, RESET_TARGET_USER_ID), eq(passwordTokens.type, 'reset_password')))
    expect(tokens).toHaveLength(1)
  })

  it('U20 — user tanpa users.read GET /users -> 403 ERR_FORBIDDEN', async () => {
    const { status, body } = await req('GET', '/api/v1/users', noReadToken)

    expect(status).toBe(403)
    expectError(body, 'ERR_FORBIDDEN')
  })

  it('U21 — tanpa Bearer akses endpoint -> 401 ERR_UNAUTHENTICATED', async () => {
    const { status, body } = await req('GET', '/api/v1/users')

    expect(status).toBe(401)
    expectError(body, 'ERR_UNAUTHENTICATED')
  })
})
