import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import { resolveUserPermissions } from './resolve'

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars'
const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
}

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

const COMPANY_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_COMPANY_ID = '55555555-5555-4555-8555-555555555555'
const BRAND_ID = '44444444-4444-4444-8444-444444444441'
const OUTLET_ID = '44444444-4444-4444-8444-444444444442'
const DEPARTMENT_ID = '44444444-4444-4444-8444-444444444443'

const ADMIN_USER_ID = '50000000-0000-4000-8000-000000000001'
const STAFF_USER_ID = '50000000-0000-4000-8000-000000000002'
const TARGET_USER_ID = '50000000-0000-4000-8000-000000000003'
const OTHER_USER_ID = '50000000-0000-4000-8000-000000000004'

const ADMIN_ROLE_ID = '60000000-0000-4000-8000-000000000001'
const STAFF_ROLE_ID = '60000000-0000-4000-8000-000000000002'
const SYSTEM_ROLE_ID = '60000000-0000-4000-8000-000000000003'
const ASSIGNABLE_ROLE_ID = '60000000-0000-4000-8000-000000000004'

const permissionCodes = [
  'rbac.role_read',
  'rbac.role_create',
  'rbac.role_update',
  'rbac.role_delete',
  'rbac.role_assign',
  'rbac.permission_read',
  'rbac.override_manage',
  'inventory.read',
  'reports.read',
]

const permissionIds = new Map<string, string>()

async function req(method: string, path: string, token?: string, body?: unknown) {
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
          description: `RBAC route test permission ${code}`,
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

async function assignPermissions(roleId: string, codes: string[]) {
  await db.insert(rolePermissions).values(
    codes.map((code) => ({
      roleId,
      permissionId: permissionIds.get(code)!,
      companyId: COMPANY_ID,
    }))
  )
}

beforeAll(async () => {
  await cleanupFixtures()
  await insertPermissionCatalog()

  await db.insert(companies).values([
    {
      id: COMPANY_ID,
      companyCode: 'RBAC-4A',
      companyName: 'RBAC Routes Test Company',
      status: 'active',
    },
    {
      id: OTHER_COMPANY_ID,
      companyCode: 'RBAC-4A-B',
      companyName: 'RBAC Routes Other Company',
      status: 'active',
    },
  ])

  await db.insert(brands).values({
    id: BRAND_ID,
    companyId: COMPANY_ID,
    brandCode: 'R4A',
    brandName: 'RBAC 4A Brand',
    status: 'active',
  })

  await db.insert(outlets).values({
    id: OUTLET_ID,
    companyId: COMPANY_ID,
    brandId: BRAND_ID,
    outletCode: 'R4A-01',
    outletName: 'RBAC 4A Outlet',
    status: 'active',
  })

  await db.insert(departments).values({
    id: DEPARTMENT_ID,
    companyId: COMPANY_ID,
    brandId: BRAND_ID,
    outletId: OUTLET_ID,
    departmentCode: 'R4A-INV',
    departmentName: 'RBAC 4A Inventory',
    departmentType: 'inventory',
    status: 'active',
  })

  await db.insert(users).values([
    {
      id: ADMIN_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-routes-admin@egg.test',
      fullName: 'RBAC Routes Admin',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: STAFF_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-routes-staff@egg.test',
      fullName: 'RBAC Routes Staff',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: TARGET_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-routes-target@egg.test',
      fullName: 'RBAC Routes Target',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: OTHER_USER_ID,
      companyId: OTHER_COMPANY_ID,
      email: 'rbac-routes-other@egg.test',
      fullName: 'RBAC Routes Other',
      status: 'active',
      firstLoginRequired: false,
    },
  ])

  await db.insert(roles).values([
    {
      id: ADMIN_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'RBAC_ADMIN_4A',
      name: 'RBAC Admin 4A',
      defaultScopeType: 'company',
      isSystem: false,
    },
    {
      id: STAFF_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'STAFF_4A',
      name: 'Staff 4A',
      defaultScopeType: 'own',
      isSystem: false,
    },
    {
      id: SYSTEM_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'SYSTEM_LOCKED_4A',
      name: 'System Locked 4A',
      defaultScopeType: 'company',
      isSystem: true,
    },
    {
      id: ASSIGNABLE_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'ASSIGNABLE_4A',
      name: 'Assignable 4A',
      defaultScopeType: 'company',
      isSystem: false,
    },
  ])

  await assignPermissions(ADMIN_ROLE_ID, permissionCodes.filter((code) => code.startsWith('rbac.')))
  await assignPermissions(STAFF_ROLE_ID, ['inventory.read'])
  await assignPermissions(ASSIGNABLE_ROLE_ID, ['inventory.read'])

  await db.insert(userRoles).values([
    {
      userId: ADMIN_USER_ID,
      roleId: ADMIN_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'company',
      scopeId: null,
      grantedBy: ADMIN_USER_ID,
    },
    {
      userId: STAFF_USER_ID,
      roleId: STAFF_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'own',
      scopeId: null,
      grantedBy: ADMIN_USER_ID,
    },
  ])
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('RBAC routes — acceptance 4a', () => {
  it('E1 — STAFF tanpa rbac.role_read GET /rbac/roles -> 403 ERR_FORBIDDEN', async () => {
    const { status, body } = await req('GET', '/api/v1/rbac/roles', await tokenFor(STAFF_USER_ID))

    expect(status).toBe(403)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_FORBIDDEN')
  })

  it('E2 — tanpa Bearer akses RBAC route -> 401 ERR_UNAUTHENTICATED', async () => {
    const { status, body } = await req('GET', '/api/v1/rbac/roles')

    expect(status).toBe(401)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_UNAUTHENTICATED')
  })

  it('E3 — is_system role tidak bisa di-PATCH/DELETE', async () => {
    const token = await tokenFor(ADMIN_USER_ID)

    const patch = await req('PATCH', `/api/v1/rbac/roles/${SYSTEM_ROLE_ID}`, token, { name: 'Nope' })
    expect(patch.status).toBe(403)
    expect(patch.body.error.code).toBe('ERR_FORBIDDEN')

    const del = await req('DELETE', `/api/v1/rbac/roles/${SYSTEM_ROLE_ID}`, token)
    expect(del.status).toBe(403)
    expect(del.body.error.code).toBe('ERR_FORBIDDEN')
  })

  it('A1 — assign role brand-scope tanpa scope_id -> 422 ERR_VALIDATION', async () => {
    const { status, body } = await req('POST', `/api/v1/rbac/users/${TARGET_USER_ID}/roles`, await tokenFor(ADMIN_USER_ID), {
      role_id: ASSIGNABLE_ROLE_ID,
      scope_type: 'brand',
      scope_id: null,
    })

    expect(status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_VALIDATION')
  })

  it('A2 — assign role company A ke user company B -> 404 ERR_NOT_FOUND', async () => {
    const { status, body } = await req('POST', `/api/v1/rbac/users/${OTHER_USER_ID}/roles`, await tokenFor(ADMIN_USER_ID), {
      role_id: ASSIGNABLE_ROLE_ID,
      scope_type: 'company',
      scope_id: null,
    })

    expect(status).toBe(404)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_NOT_FOUND')
  })
})

describe('RBAC routes — happy path endpoints', () => {
  it('covers role CRUD, set role permissions, and permissions list', async () => {
    const token = await tokenFor(ADMIN_USER_ID)

    const listed = await req('GET', '/api/v1/rbac/roles', token)
    expect(listed.status).toBe(200)
    expect(listed.body.data.map((role: { code: string }) => role.code)).toContain('RBAC_ADMIN_4A')

    const created = await req('POST', '/api/v1/rbac/roles', token, {
      code: 'TEMP_ROLE_4A',
      name: 'Temporary Role 4A',
      description: 'Created by RBAC route test',
      default_scope_type: 'company',
    })
    expect(created.status).toBe(201)
    expect(created.body.data.code).toBe('TEMP_ROLE_4A')
    const roleId = created.body.data.id as string

    const fetched = await req('GET', `/api/v1/rbac/roles/${roleId}`, token)
    expect(fetched.status).toBe(200)
    expect(fetched.body.data.permissions).toEqual([])

    const patched = await req('PATCH', `/api/v1/rbac/roles/${roleId}`, token, {
      name: 'Temporary Role 4A Updated',
    })
    expect(patched.status).toBe(200)
    expect(patched.body.data.name).toBe('Temporary Role 4A Updated')

    const setPermissions = await req('PUT', `/api/v1/rbac/roles/${roleId}/permissions`, token, {
      permission_codes: ['inventory.read', 'reports.read'],
    })
    expect(setPermissions.status).toBe(200)
    expect(setPermissions.body.data.permissions).toEqual(['inventory.read', 'reports.read'])

    const permissionList = await req('GET', '/api/v1/rbac/permissions', token)
    expect(permissionList.status).toBe(200)
    expect(permissionList.body.data.map((permission: { code: string }) => permission.code)).toEqual(
      expect.arrayContaining(['rbac.role_read', 'rbac.override_manage'])
    )

    const deleted = await req('DELETE', `/api/v1/rbac/roles/${roleId}`, token)
    expect(deleted.status).toBe(200)
    expect(deleted.body.data.deleted_at).not.toBeNull()
  })

  it('covers assign/list/revoke user role and A3 resolve after revoke', async () => {
    const token = await tokenFor(ADMIN_USER_ID)

    const assigned = await req('POST', `/api/v1/rbac/users/${TARGET_USER_ID}/roles`, token, {
      role_id: ASSIGNABLE_ROLE_ID,
      scope_type: 'company',
      scope_id: null,
    })
    expect(assigned.status).toBe(201)
    expect(assigned.body.data.role_code).toBe('ASSIGNABLE_4A')
    const assignmentId = assigned.body.data.id as string

    const listed = await req('GET', `/api/v1/rbac/users/${TARGET_USER_ID}/roles`, token)
    expect(listed.status).toBe(200)
    expect(listed.body.data.map((assignment: { id: string }) => assignment.id)).toContain(assignmentId)

    const beforeRevoke = await resolveUserPermissions(db, TARGET_USER_ID, COMPANY_ID)
    expect(beforeRevoke.grants.some((grant) => grant.permission === 'inventory.read')).toBe(true)

    const revoked = await req('DELETE', `/api/v1/rbac/users/${TARGET_USER_ID}/roles/${assignmentId}`, token)
    expect(revoked.status).toBe(200)
    expect(revoked.body.data.deleted_at).not.toBeNull()

    const afterRevoke = await resolveUserPermissions(db, TARGET_USER_ID, COMPANY_ID)
    expect(afterRevoke.grants.some((grant) => grant.permission === 'inventory.read')).toBe(false)
  })

  it('covers override create/delete', async () => {
    const token = await tokenFor(ADMIN_USER_ID)

    const created = await req('POST', `/api/v1/rbac/users/${TARGET_USER_ID}/overrides`, token, {
      permission_code: 'reports.read',
      effect: 'grant',
      scope_type: 'company',
      scope_id: null,
      reason: 'route happy path',
    })
    expect(created.status).toBe(201)
    expect(created.body.data.permission_code).toBe('reports.read')
    const overrideId = created.body.data.id as string

    const beforeDelete = await resolveUserPermissions(db, TARGET_USER_ID, COMPANY_ID)
    expect(beforeDelete.grants.some((grant) => grant.permission === 'reports.read')).toBe(true)

    const deleted = await req('DELETE', `/api/v1/rbac/users/${TARGET_USER_ID}/overrides/${overrideId}`, token)
    expect(deleted.status).toBe(200)
    expect(deleted.body.data.deleted_at).not.toBeNull()

    const afterDelete = await resolveUserPermissions(db, TARGET_USER_ID, COMPANY_ID)
    expect(afterDelete.grants.some((grant) => grant.permission === 'reports.read')).toBe(false)
  })
})
