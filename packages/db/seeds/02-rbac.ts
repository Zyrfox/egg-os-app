import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config } from 'dotenv'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray, notInArray, sql as drizzleSql } from 'drizzle-orm'
import * as schema from '../src/schema'
import {
  companies,
  permissions,
  rolePermissions,
  roles,
} from '../src/schema'

config({ path: resolve(__dirname, '../../../.env') })

type SeedDb = ReturnType<typeof drizzle<typeof schema>>

type PermissionSeed = {
  code: string
  description: string
}

type RoleSeed = {
  code: string
  name: string
  description: string
  defaultScopeType: string
  permissions: string[]
}

export const RBAC_PERMISSION_CATALOG: PermissionSeed[] = [
  { code: 'rbac.role_read', description: 'Read RBAC roles' },
  { code: 'rbac.role_create', description: 'Create RBAC roles' },
  { code: 'rbac.role_update', description: 'Update RBAC roles' },
  { code: 'rbac.role_delete', description: 'Delete RBAC roles' },
  { code: 'rbac.role_assign', description: 'Assign RBAC roles to users' },
  { code: 'rbac.permission_read', description: 'Read RBAC permission catalog' },
  { code: 'rbac.override_manage', description: 'Manage RBAC access overrides' },
  { code: 'core.company_read', description: 'Read companies' },
  { code: 'core.brand_read', description: 'Read brands' },
  { code: 'core.brand_manage', description: 'Manage brands' },
  { code: 'core.outlet_read', description: 'Read outlets' },
  { code: 'core.outlet_manage', description: 'Manage outlets' },
  { code: 'core.department_read', description: 'Read departments' },
  { code: 'core.department_manage', description: 'Manage departments' },
  { code: 'users.read', description: 'Read users' },
  { code: 'users.create', description: 'Create users' },
  { code: 'users.update', description: 'Update users' },
  { code: 'users.suspend', description: 'Suspend users' },
  { code: 'users.archive', description: 'Archive users' },
  { code: 'inventory.read', description: 'Read inventory' },
  { code: 'inventory.item_manage', description: 'Manage inventory item master data' },
  { code: 'inventory.stock_in', description: 'Create stock-in entries' },
  { code: 'inventory.stock_out', description: 'Create stock-out entries' },
  { code: 'inventory.opname', description: 'Run inventory opname' },
  { code: 'inventory.waste', description: 'Record inventory waste' },
  { code: 'inventory.transfer_send', description: 'Send inventory transfers between outlets' },
  { code: 'inventory.transfer_receive', description: 'Receive inventory transfers between outlets' },
  { code: 'reports.read', description: 'Read reports' },
  { code: 'reports.submit', description: 'Submit reports' },
  { code: 'reports.validate', description: 'Validate reports' },
  { code: 'approval.read', description: 'Read approvals' },
  { code: 'approval.request', description: 'Request approvals' },
  { code: 'approval.decide', description: 'Decide approvals' },
  { code: 'audit.read', description: 'Read audit records' },
  { code: 'export.run', description: 'Run exports' },
]

const allPermissionCodes = RBAC_PERMISSION_CATALOG.map((permission) => permission.code)
const rbacPermissionCodes = allPermissionCodes.filter((code) => code.startsWith('rbac.'))
const corePermissionCodes = allPermissionCodes.filter((code) => code.startsWith('core.'))
const usersPermissionCodes = allPermissionCodes.filter((code) => code.startsWith('users.'))
const inventoryPermissionCodes = allPermissionCodes.filter((code) => code.startsWith('inventory.'))
const inventoryOperationalPermissionCodes = inventoryPermissionCodes.filter((code) => code !== 'inventory.item_manage')
const readPermissionCodes = allPermissionCodes.filter((code) => {
  const action = code.split('.')[1] ?? ''
  return action === 'read' || action.endsWith('_read')
})

export const RBAC_STARTER_ROLES: RoleSeed[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Global administrator with every permission',
    defaultScopeType: 'global',
    permissions: allPermissionCodes,
  },
  {
    code: 'ERP_OWNER',
    name: 'ERP Owner',
    description: 'Company owner for configuration, master data, and governance',
    defaultScopeType: 'company',
    permissions: [
      ...rbacPermissionCodes,
      ...corePermissionCodes,
      ...usersPermissionCodes,
      'inventory.item_manage',
      'audit.read',
      'export.run',
    ],
  },
  {
    code: 'DIREKSI',
    name: 'Direksi',
    description: 'Company leadership with read, approval, audit, and export access',
    defaultScopeType: 'company',
    permissions: [...readPermissionCodes, 'approval.decide', 'export.run'],
  },
  {
    code: 'MANAGER',
    name: 'Manager',
    description: 'Brand-scoped manager access',
    defaultScopeType: 'brand',
    permissions: [
      'core.outlet_read',
      'core.outlet_manage',
      'core.department_read',
      'core.department_manage',
      ...inventoryPermissionCodes,
      'reports.read',
      'reports.validate',
      'approval.decide',
      'approval.read',
    ],
  },
  {
    code: 'SPV_OUTLET',
    name: 'SPV Outlet',
    description: 'Outlet-scoped supervisor access',
    defaultScopeType: 'outlet',
    permissions: [
      ...inventoryOperationalPermissionCodes,
      'reports.read',
      'reports.validate',
      'approval.request',
      'approval.read',
      'core.outlet_read',
    ],
  },
  {
    code: 'STAFF',
    name: 'Staff',
    description: 'Own-scoped staff access',
    defaultScopeType: 'own',
    permissions: [
      'inventory.stock_in',
      'inventory.stock_out',
      'inventory.read',
      'reports.submit',
      'reports.read',
      'approval.request',
    ],
  },
  {
    code: 'FREELANCE',
    name: 'Freelance',
    description: 'Assigned-scoped freelance access',
    defaultScopeType: 'assigned',
    permissions: ['reports.submit', 'reports.read', 'approval.request'],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor',
    description: 'Audit-view read-only access',
    defaultScopeType: 'audit_view',
    permissions: [...readPermissionCodes, 'export.run'],
  },
]

function splitPermission(code: string) {
  const [module, action] = code.split('.')
  return { module, action }
}

async function getEggCompany(db: SeedDb) {
  const company = await db
    .select()
    .from(companies)
    .where(eq(companies.companyCode, 'EGG'))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!company) {
    throw new Error('Company EGG not found. Run pnpm db:seed:core before pnpm db:seed:rbac.')
  }

  return company
}

async function upsertPermissionCatalog(db: SeedDb) {
  for (const permission of RBAC_PERMISSION_CATALOG) {
    const { module, action } = splitPermission(permission.code)
    await db
      .insert(permissions)
      .values({
        code: permission.code,
        module,
        action,
        description: permission.description,
      })
      .onConflictDoUpdate({
        target: permissions.code,
        set: {
          module,
          action,
          description: permission.description,
        },
      })
  }

  const rows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, allPermissionCodes))

  return new Map(rows.map((permission) => [permission.code, permission.id]))
}

async function upsertStarterRole(db: SeedDb, companyId: string, role: RoleSeed) {
  const [row] = await db
    .insert(roles)
    .values({
      companyId,
      code: role.code,
      name: role.name,
      description: role.description,
      defaultScopeType: role.defaultScopeType,
      isSystem: true,
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: [roles.companyId, roles.code],
      set: {
        name: role.name,
        description: role.description,
        defaultScopeType: role.defaultScopeType,
        isSystem: true,
        deletedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning()

  return row
}

async function syncRolePermissions(
  db: SeedDb,
  companyId: string,
  roleId: string,
  permissionIds: string[]
) {
  await db
    .delete(rolePermissions)
    .where(
      and(
        eq(rolePermissions.companyId, companyId),
        eq(rolePermissions.roleId, roleId),
        notInArray(rolePermissions.permissionId, permissionIds)
      )
    )

  await db
    .insert(rolePermissions)
    .values(
      permissionIds.map((permissionId) => ({
        roleId,
        permissionId,
        companyId,
      }))
    )
    .onConflictDoNothing()
}

async function deleteDeprecatedPermissions(db: SeedDb) {
  await db.execute(drizzleSql`
    delete from permissions p
    where p.code = 'users.deactivate'
      and not exists (
        select 1
        from role_permissions rp
        where rp.permission_id = p.id
      )
  `)
}

export async function seedRbac(db: SeedDb) {
  const company = await getEggCompany(db)
  const permissionIds = await upsertPermissionCatalog(db)
  const roleRows = []

  for (const roleSeed of RBAC_STARTER_ROLES) {
    const role = await upsertStarterRole(db, company.id, roleSeed)
    roleRows.push(role)

    const desiredPermissionIds = roleSeed.permissions.map((code) => {
      const permissionId = permissionIds.get(code)
      if (!permissionId) throw new Error(`Missing permission id for ${code}`)
      return permissionId
    })

    await syncRolePermissions(db, company.id, role.id, desiredPermissionIds)
  }

  await deleteDeprecatedPermissions(db)

  return getRbacSeedCounts(db, company.id)
}

export async function getRbacSeedCounts(db: SeedDb, companyId?: string) {
  const resolvedCompanyId = companyId ?? (await getEggCompany(db)).id
  const roleCodes = RBAC_STARTER_ROLES.map((role) => role.code)

  const [permissionCount] = await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(permissions)
    .where(inArray(permissions.code, allPermissionCodes))

  const [roleCount] = await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(roles)
    .where(and(eq(roles.companyId, resolvedCompanyId), inArray(roles.code, roleCodes)))

  const roleRows = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.companyId, resolvedCompanyId), inArray(roles.code, roleCodes)))

  const [rolePermissionCount] = roleRows.length > 0
    ? await db
        .select({ count: drizzleSql<number>`count(*)::int` })
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.companyId, resolvedCompanyId),
            inArray(rolePermissions.roleId, roleRows.map((role) => role.id))
          )
        )
    : [{ count: 0 }]

  return {
    companyId: resolvedCompanyId,
    permissions: permissionCount.count,
    roles: roleCount.count,
    rolePermissions: rolePermissionCount.count,
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to seed RBAC data')
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1 })
  const db = drizzle(sql, { schema })

  try {
    const result = await seedRbac(db)
    console.log(
      `RBAC seed complete: company=EGG, permissions=${result.permissions}, roles=${result.roles}, role_permissions=${result.rolePermissions}`
    )
  } finally {
    await sql.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
