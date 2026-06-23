import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { inArray } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  accessOverrides,
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
import {
  hasPermission,
  resolveUserPermissions,
  scopeCovers,
  type Grant,
  type OrgTree,
  type PermissionTarget,
  type ScopeType,
} from './resolve'

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

const COMPANY_ID = '22222222-2222-4222-8222-222222222222'
const BRAND_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const BRAND_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const OUTLET_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const OUTLET_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const DEPARTMENT_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const DEPARTMENT_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'

const SUPER_USER_ID = '10000000-0000-4000-8000-000000000001'
const SPV_A_USER_ID = '10000000-0000-4000-8000-000000000002'
const SPV_B_USER_ID = '10000000-0000-4000-8000-000000000003'
const STAFF_USER_ID = '10000000-0000-4000-8000-000000000004'
const AUDITOR_USER_ID = '10000000-0000-4000-8000-000000000005'
const NO_ROLE_USER_ID = '10000000-0000-4000-8000-000000000006'

const SUPER_ROLE_ID = '20000000-0000-4000-8000-000000000001'
const SPV_ROLE_ID = '20000000-0000-4000-8000-000000000002'
const STAFF_ROLE_ID = '20000000-0000-4000-8000-000000000003'
const AUDITOR_ROLE_ID = '20000000-0000-4000-8000-000000000004'

const permissionCodes = [
  'inventory.read',
  'inventory.stock_in',
  'inventory.stock_out',
  'inventory.opname',
  'inventory.waste',
  'reports.read',
  'reports.submit',
  'reports.validate',
  'approval.read',
  'approval.request',
  'approval.decide',
  'audit.read',
  'export.run',
  'core.outlet_read',
]

const spvPermissions = [
  'inventory.read',
  'inventory.stock_in',
  'inventory.stock_out',
  'inventory.opname',
  'inventory.waste',
  'reports.read',
  'reports.validate',
  'approval.read',
  'approval.request',
  'core.outlet_read',
]

const staffPermissions = [
  'inventory.read',
  'inventory.stock_in',
  'inventory.stock_out',
  'reports.read',
  'reports.submit',
  'approval.request',
]

const auditorPermissions = [
  'reports.read',
  'audit.read',
  'core.outlet_read',
]

const orgTree: OrgTree = {
  outletsById: {
    [OUTLET_A_ID]: { brandId: BRAND_A_ID },
    [OUTLET_B_ID]: { brandId: BRAND_B_ID },
  },
  departmentsById: {
    [DEPARTMENT_A_ID]: { brandId: BRAND_A_ID, outletId: OUTLET_A_ID },
    [DEPARTMENT_B_ID]: { brandId: BRAND_B_ID, outletId: OUTLET_B_ID },
  },
}

const permissionIds = new Map<string, string>()

function target(scopeType: ScopeType, scopeId: string | null): PermissionTarget {
  return { scopeType, scopeId, orgTree }
}

function grant(permission: string, scopeType: ScopeType, scopeId: string | null): Grant {
  return { permission, scopeType, scopeId }
}

async function cleanupRbacFixtures() {
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
          description: `RBAC resolve test permission ${code}`,
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

async function insertOverride(
  userId: string,
  permissionCode: string,
  effect: 'grant' | 'deny',
  scopeType: ScopeType,
  scopeId: string | null,
  expiresAt?: Date
) {
  await db.insert(accessOverrides).values({
    userId,
    permissionId: permissionIds.get(permissionCode)!,
    companyId: COMPANY_ID,
    effect,
    scopeType,
    scopeId,
    grantedBy: SUPER_USER_ID,
    reason: `test ${effect} ${permissionCode}`,
    expiresAt,
  })
}

async function clearOverrides() {
  await sql`DELETE FROM access_overrides WHERE company_id = ${COMPANY_ID}`
}

beforeAll(async () => {
  await cleanupRbacFixtures()
  await insertPermissionCatalog()

  await db.insert(companies).values({
    id: COMPANY_ID,
    companyCode: 'RBAC-T2',
    companyName: 'RBAC Resolve Test Company',
    status: 'active',
  })

  await db.insert(brands).values([
    {
      id: BRAND_A_ID,
      companyId: COMPANY_ID,
      brandCode: 'BTMK-RBAC',
      brandName: 'Betamek RBAC',
      status: 'active',
    },
    {
      id: BRAND_B_ID,
      companyId: COMPANY_ID,
      brandCode: 'BTMF-RBAC',
      brandName: 'Betamorf RBAC',
      status: 'active',
    },
  ])

  await db.insert(outlets).values([
    {
      id: OUTLET_A_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_A_ID,
      outletCode: 'BTMK-01-RBAC',
      outletName: 'BTMK 01 RBAC',
      status: 'active',
    },
    {
      id: OUTLET_B_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_B_ID,
      outletCode: 'BTMF-01-RBAC',
      outletName: 'BTMF 01 RBAC',
      status: 'active',
    },
  ])

  await db.insert(departments).values([
    {
      id: DEPARTMENT_A_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_A_ID,
      outletId: OUTLET_A_ID,
      departmentCode: 'INV-RBAC-A',
      departmentName: 'Inventory RBAC A',
      departmentType: 'inventory',
      status: 'active',
    },
    {
      id: DEPARTMENT_B_ID,
      companyId: COMPANY_ID,
      brandId: BRAND_B_ID,
      outletId: OUTLET_B_ID,
      departmentCode: 'INV-RBAC-B',
      departmentName: 'Inventory RBAC B',
      departmentType: 'inventory',
      status: 'active',
    },
  ])

  await db.insert(users).values([
    {
      id: SUPER_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-super@egg.test',
      fullName: 'RBAC Super',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: SPV_A_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-spv-a@egg.test',
      fullName: 'RBAC SPV A',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: SPV_B_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-spv-b@egg.test',
      fullName: 'RBAC SPV B',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: STAFF_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-staff@egg.test',
      fullName: 'RBAC Staff',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: AUDITOR_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-auditor@egg.test',
      fullName: 'RBAC Auditor',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: NO_ROLE_USER_ID,
      companyId: COMPANY_ID,
      email: 'rbac-no-role@egg.test',
      fullName: 'RBAC No Role',
      status: 'active',
      firstLoginRequired: false,
    },
  ])

  await db.insert(roles).values([
    {
      id: SUPER_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'SUPER_ADMIN',
      name: 'Super Admin',
      defaultScopeType: 'global',
      isSystem: true,
    },
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
    {
      id: AUDITOR_ROLE_ID,
      companyId: COMPANY_ID,
      code: 'AUDITOR',
      name: 'Auditor',
      defaultScopeType: 'audit_view',
      isSystem: true,
    },
  ])

  await assignPermissions(SUPER_ROLE_ID, permissionCodes)
  await assignPermissions(SPV_ROLE_ID, spvPermissions)
  await assignPermissions(STAFF_ROLE_ID, staffPermissions)
  await assignPermissions(AUDITOR_ROLE_ID, auditorPermissions)

  await db.insert(userRoles).values([
    {
      userId: SUPER_USER_ID,
      roleId: SUPER_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'global',
      scopeId: null,
      grantedBy: SUPER_USER_ID,
    },
    {
      userId: SPV_A_USER_ID,
      roleId: SPV_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'outlet',
      scopeId: OUTLET_A_ID,
      grantedBy: SUPER_USER_ID,
    },
    {
      userId: SPV_B_USER_ID,
      roleId: SPV_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'outlet',
      scopeId: OUTLET_B_ID,
      grantedBy: SUPER_USER_ID,
    },
    {
      userId: STAFF_USER_ID,
      roleId: STAFF_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'own',
      scopeId: null,
      grantedBy: SUPER_USER_ID,
    },
    {
      userId: AUDITOR_USER_ID,
      roleId: AUDITOR_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'audit_view',
      scopeId: null,
      grantedBy: SUPER_USER_ID,
    },
  ])
})

afterAll(async () => {
  await cleanupRbacFixtures()
  await sql.end()
})

describe('RBAC resolve engine — resolve basics', () => {
  it('R1 — SPV_OUTLET@BTMK-01 resolves inventory grants only at outlet BTMK-01', async () => {
    const access = await resolveUserPermissions(db, SPV_A_USER_ID, COMPANY_ID)

    const inventoryGrants = access.grants.filter((item) => item.permission.startsWith('inventory.'))
    expect(access.roles).toEqual(['SPV_OUTLET'])
    expect(inventoryGrants.map((item) => item.permission)).toEqual(
      expect.arrayContaining(['inventory.read', 'inventory.stock_in', 'inventory.stock_out', 'inventory.opname', 'inventory.waste'])
    )
    expect(inventoryGrants.every((item) => item.scopeType === 'outlet' && item.scopeId === OUTLET_A_ID)).toBe(true)
  })

  it('R2 — SUPER_ADMIN global resolves all permissions and covers every tested resource', async () => {
    const access = await resolveUserPermissions(db, SUPER_USER_ID, COMPANY_ID)

    expect(access.roles).toEqual(['SUPER_ADMIN'])
    expect(access.grants.map((item) => item.permission)).toEqual(expect.arrayContaining(permissionCodes))
    expect(hasPermission(access, 'inventory.waste', target('outlet', OUTLET_B_ID))).toBe('allow')
    expect(hasPermission(access, 'reports.validate', target('department', DEPARTMENT_B_ID))).toBe('allow')
  })

  it('R3 — user without role resolves empty roles and grants', async () => {
    const access = await resolveUserPermissions(db, NO_ROLE_USER_ID, COMPANY_ID)

    expect(access.roles).toEqual([])
    expect(access.grants).toEqual([])
    expect(access.rawScopes).toEqual([])
  })
})

describe('RBAC resolve engine — override precedence', () => {
  beforeEach(async () => {
    await clearOverrides()
  })

  it('O1 — role grants inventory.waste but explicit DENY removes it', async () => {
    await insertOverride(SPV_A_USER_ID, 'inventory.waste', 'deny', 'outlet', OUTLET_A_ID)

    const access = await resolveUserPermissions(db, SPV_A_USER_ID, COMPANY_ID)

    expect(access.grants.some((item) => item.permission === 'inventory.waste')).toBe(false)
    expect(hasPermission(access, 'inventory.waste', target('outlet', OUTLET_A_ID))).toBe('forbidden')
  })

  it('O2 — explicit GRANT gives export.run to a user without role grant', async () => {
    await insertOverride(NO_ROLE_USER_ID, 'export.run', 'grant', 'company', null)

    const access = await resolveUserPermissions(db, NO_ROLE_USER_ID, COMPANY_ID)

    expect(access.grants).toContainEqual(grant('export.run', 'company', null))
    expect(hasPermission(access, 'export.run')).toBe('allow')
  })

  it('O3 — expired GRANT override is ignored', async () => {
    await insertOverride(NO_ROLE_USER_ID, 'export.run', 'grant', 'company', null, new Date(Date.now() - 60_000))

    const access = await resolveUserPermissions(db, NO_ROLE_USER_ID, COMPANY_ID)

    expect(access.grants.some((item) => item.permission === 'export.run')).toBe(false)
    expect(hasPermission(access, 'export.run')).toBe('forbidden')
  })

  it('O4 — overlapping DENY beats explicit GRANT for the same permission', async () => {
    await insertOverride(NO_ROLE_USER_ID, 'inventory.waste', 'grant', 'outlet', OUTLET_A_ID)
    await insertOverride(NO_ROLE_USER_ID, 'inventory.waste', 'deny', 'company', null)

    const access = await resolveUserPermissions(db, NO_ROLE_USER_ID, COMPANY_ID)

    expect(access.grants.some((item) => item.permission === 'inventory.waste')).toBe(false)
    expect(hasPermission(access, 'inventory.waste', target('outlet', OUTLET_A_ID))).toBe('forbidden')
  })

  it('O5 — deny pada outlet di bawah brand memblok SELURUH grant brand untuk permission itu', async () => {
    await insertOverride(NO_ROLE_USER_ID, 'inventory.read', 'grant', 'brand', BRAND_A_ID)
    await insertOverride(NO_ROLE_USER_ID, 'inventory.read', 'deny', 'outlet', OUTLET_A_ID)

    const access = await resolveUserPermissions(db, NO_ROLE_USER_ID, COMPANY_ID)

    expect(access.grants.some((item) => item.permission === 'inventory.read')).toBe(false)
    expect(hasPermission(access, 'inventory.read', target('outlet', OUTLET_A_ID))).toBe('forbidden')
  })
})

describe('RBAC resolve engine — scope coverage', () => {
  it('S1 — brand grant covers outlet under that brand', () => {
    expect(scopeCovers(grant('inventory.read', 'brand', BRAND_A_ID), target('outlet', OUTLET_A_ID), orgTree)).toBe(true)
  })

  it('S2 — outlet grant covers department under that outlet', () => {
    expect(scopeCovers(grant('inventory.read', 'outlet', OUTLET_A_ID), target('department', DEPARTMENT_A_ID), orgTree)).toBe(true)
  })

  it('S3 — outlet A grant accessing outlet B returns out_of_scope', async () => {
    const access = await resolveUserPermissions(db, SPV_A_USER_ID, COMPANY_ID)

    expect(hasPermission(access, 'inventory.read', target('outlet', OUTLET_B_ID))).toBe('out_of_scope')
  })

  it('S4 — global grant covers any resource in the company context', async () => {
    const access = await resolveUserPermissions(db, SUPER_USER_ID, COMPANY_ID)

    expect(hasPermission(access, 'reports.read', target('department', DEPARTMENT_B_ID))).toBe('allow')
  })

  it('S5 — own row-level grant allows permission signal but scopeCovers remains structural-only', async () => {
    const access = await resolveUserPermissions(db, STAFF_USER_ID, COMPANY_ID)
    const ownGrant = access.grants.find((item) => item.permission === 'reports.submit')

    expect(ownGrant).toEqual(grant('reports.submit', 'own', null))
    expect(scopeCovers(ownGrant!, target('outlet', OUTLET_A_ID), orgTree)).toBe(false)
    expect(hasPermission(access, 'reports.submit', target('outlet', OUTLET_A_ID))).toBe('allow')
  })

  it('S6 — audit_view allows read permission and denies mutate permission', async () => {
    const access = await resolveUserPermissions(db, AUDITOR_USER_ID, COMPANY_ID)

    expect(hasPermission(access, 'reports.read', target('outlet', OUTLET_A_ID))).toBe('allow')
    expect(scopeCovers(grant('reports.submit', 'audit_view', null), target('outlet', OUTLET_A_ID), orgTree)).toBe(false)
    expect(hasPermission(access, 'reports.submit', target('outlet', OUTLET_A_ID))).toBe('forbidden')
  })
})
