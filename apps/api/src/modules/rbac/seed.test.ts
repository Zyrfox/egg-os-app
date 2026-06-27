import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  companies,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@egg-os/db'
import {
  RBAC_PERMISSION_CATALOG,
  RBAC_STARTER_ROLES,
  getRbacSeedCounts,
  seedRbac,
} from '../../../../../packages/db/seeds/02-rbac'

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

const NULL_SCOPE_TEST_USER_ID = '80000000-0000-4000-8000-000000000001'

let eggCompanyId: string

async function cleanupNullScopeFixture() {
  if (!eggCompanyId) return
  await sql`DELETE FROM user_roles WHERE company_id = ${eggCompanyId} AND user_id = ${NULL_SCOPE_TEST_USER_ID}`
  await sql`DELETE FROM users WHERE company_id = ${eggCompanyId} AND id = ${NULL_SCOPE_TEST_USER_ID}`
}

beforeAll(async () => {
  await seedRbac(db)
  const company = await db
    .select()
    .from(companies)
    .where(eq(companies.companyCode, 'EGG'))
    .limit(1)
    .then((rows) => rows[0])
  eggCompanyId = company.id
  await cleanupNullScopeFixture()
})

afterAll(async () => {
  await cleanupNullScopeFixture()
  await sql.end()
})

describe('RBAC production seed', () => {
  it('is idempotent for permission catalog, 8 starter roles, and role permissions', async () => {
    const first = await seedRbac(db)
    const second = await seedRbac(db)

    expect(first).toEqual({
      companyId: eggCompanyId,
      permissions: 38,
      roles: 8,
      rolePermissions: 127,
    })
    expect(second).toEqual(first)
    expect(second).toEqual(await getRbacSeedCounts(db, eggCompanyId))
  })

  it('seeds all starter roles with official default scopes', async () => {
    const rows = await db
      .select({
        code: roles.code,
        defaultScopeType: roles.defaultScopeType,
        isSystem: roles.isSystem,
      })
      .from(roles)
      .where(and(eq(roles.companyId, eggCompanyId), inArray(roles.code, RBAC_STARTER_ROLES.map((role) => role.code))))

    expect(Object.fromEntries(rows.map((role) => [role.code, role.defaultScopeType]))).toEqual({
      SUPER_ADMIN: 'global',
      ERP_OWNER: 'company',
      DIREKSI: 'company',
      MANAGER: 'brand',
      SPV_OUTLET: 'outlet',
      STAFF: 'own',
      FREELANCE: 'assigned',
      AUDITOR: 'audit_view',
    })
    expect(rows.every((role) => role.isSystem)).toBe(true)
  })

  it('seeds AUDITOR as audit_view read-only plus export.run', async () => {
    const auditor = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.companyId, eggCompanyId), eq(roles.code, 'AUDITOR')))
      .limit(1)
      .then((rows) => rows[0])

    const rows = await db
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(and(eq(rolePermissions.companyId, eggCompanyId), eq(rolePermissions.roleId, auditor.id)))

    const codes = rows.map((permission) => permission.code).sort()
    const readOrExport = codes.every((code) => {
      const action = code.split('.')[1] ?? ''
      return action === 'read' || action.endsWith('_read') || code === 'export.run'
    })

    expect(codes).toContain('audit.read')
    expect(codes).toContain('export.run')
    expect(readOrExport).toBe(true)
  })

  it('keeps active user_roles unique when scope_id is NULL', async () => {
    const superAdmin = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.companyId, eggCompanyId), eq(roles.code, 'SUPER_ADMIN')))
      .limit(1)
      .then((rows) => rows[0])

    await db.insert(users).values({
      id: NULL_SCOPE_TEST_USER_ID,
      companyId: eggCompanyId,
      email: 'rbac-null-scope-seed@egg.test',
      fullName: 'RBAC Null Scope Seed',
      status: 'active',
      firstLoginRequired: false,
    })

    const assignment = {
      userId: NULL_SCOPE_TEST_USER_ID,
      roleId: superAdmin.id,
      companyId: eggCompanyId,
      scopeType: 'global',
      scopeId: null,
      grantedBy: NULL_SCOPE_TEST_USER_ID,
    }

    await db.insert(userRoles).values(assignment)
    await db.insert(userRoles).values(assignment).onConflictDoNothing()

    const rows = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.companyId, eggCompanyId),
          eq(userRoles.userId, NULL_SCOPE_TEST_USER_ID),
          eq(userRoles.roleId, superAdmin.id),
          eq(userRoles.scopeType, 'global'),
          isNull(userRoles.scopeId),
          isNull(userRoles.deletedAt)
        )
      )

    expect(rows).toHaveLength(1)
  })

  it('keeps the permission catalog at the approval-enabled seed size', () => {
    expect(RBAC_PERMISSION_CATALOG).toHaveLength(38)
  })
})
