import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  accessOverrides,
  authEvents,
  brands,
  departments,
  outlets,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@egg-os/db'
import { ERR } from '../../lib/errors'
import type { Db } from '../../lib/db'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type {
  AssignRoleInput,
  CreateOverrideInput,
  CreateRoleInput,
  SetRolePermissionsInput,
  UpdateRoleInput,
} from '@egg-os/validation'
import type { ScopeType } from './resolve'

export type ErrorDetail = { field: string; issue: string }

export class RbacServiceError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[]
  ) {
    super(message)
  }
}

function iso(date: Date | null) {
  return date?.toISOString() ?? null
}

function notFound() {
  return new RbacServiceError(ERR.NOT_FOUND.http, ERR.NOT_FOUND.code, ERR.NOT_FOUND.message)
}

function forbidden(message: string = ERR.FORBIDDEN.message) {
  return new RbacServiceError(ERR.FORBIDDEN.http, ERR.FORBIDDEN.code, message)
}

function validation(details: ErrorDetail[]) {
  return new RbacServiceError(ERR.VALIDATION.http, ERR.VALIDATION.code, ERR.VALIDATION.message, details)
}

function conflict() {
  return new RbacServiceError(ERR.CONFLICT.http, ERR.CONFLICT.code, ERR.CONFLICT.message)
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

function roleDto(role: typeof roles.$inferSelect, rolePermissionsList?: string[]) {
  return {
    id: role.id,
    company_id: role.companyId,
    code: role.code,
    name: role.name,
    description: role.description,
    default_scope_type: role.defaultScopeType,
    is_system: role.isSystem,
    ...(rolePermissionsList ? { permissions: rolePermissionsList } : {}),
    created_at: role.createdAt.toISOString(),
    updated_at: role.updatedAt.toISOString(),
    deleted_at: iso(role.deletedAt),
  }
}

function permissionDto(permission: typeof permissions.$inferSelect) {
  return {
    id: permission.id,
    code: permission.code,
    module: permission.module,
    action: permission.action,
    description: permission.description,
    created_at: permission.createdAt.toISOString(),
  }
}

function userRoleDto(row: {
  id: string
  userId: string
  roleId: string
  roleCode: string
  scopeType: string
  scopeId: string | null
  createdAt: Date
  deletedAt: Date | null
}) {
  return {
    id: row.id,
    user_id: row.userId,
    role_id: row.roleId,
    role_code: row.roleCode,
    scope_type: row.scopeType,
    scope_id: row.scopeId,
    created_at: row.createdAt.toISOString(),
    deleted_at: iso(row.deletedAt),
  }
}

function overrideDto(row: {
  id: string
  userId: string
  permissionCode: string
  effect: string
  scopeType: string
  scopeId: string | null
  reason: string | null
  expiresAt: Date | null
  createdAt: Date
  deletedAt: Date | null
}) {
  return {
    id: row.id,
    user_id: row.userId,
    permission_code: row.permissionCode,
    effect: row.effect,
    scope_type: row.scopeType,
    scope_id: row.scopeId,
    reason: row.reason,
    expires_at: iso(row.expiresAt),
    created_at: row.createdAt.toISOString(),
    deleted_at: iso(row.deletedAt),
  }
}

async function getActiveRole(db: Db, companyId: string, roleId: string) {
  return db
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.companyId, companyId), isNull(roles.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function getUserInCompany(db: Db, companyId: string, userId: string) {
  return db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId), isNull(users.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function getPermissionByCode(db: Db, code: string) {
  return db
    .select()
    .from(permissions)
    .where(eq(permissions.code, code))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function assertScopeBelongsToCompany(
  db: Db,
  companyId: string,
  scopeType: ScopeType,
  scopeId: string | null
) {
  if (['global', 'company', 'own', 'assigned', 'audit_view'].includes(scopeType)) {
    if (scopeId !== null) {
      throw validation([{ field: 'scope_id', issue: 'harus null untuk scope ini' }])
    }
    return
  }

  if (!scopeId) {
    throw validation([{ field: 'scope_id', issue: 'wajib untuk brand/outlet/department' }])
  }

  if (scopeType === 'brand') {
    const brand = await db
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.id, scopeId), eq(brands.companyId, companyId), isNull(brands.deletedAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!brand) throw notFound()
    return
  }

  if (scopeType === 'outlet') {
    const outlet = await db
      .select({ id: outlets.id })
      .from(outlets)
      .where(and(eq(outlets.id, scopeId), eq(outlets.companyId, companyId), isNull(outlets.deletedAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!outlet) throw notFound()
    return
  }

  const department = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, scopeId), eq(departments.companyId, companyId), isNull(departments.deletedAt)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!department) throw notFound()
}

async function logRbacEvent(
  db: Db,
  companyId: string,
  userId: string,
  eventType: string,
  detail: Record<string, unknown>
) {
  await db.insert(authEvents).values({
    companyId,
    userId,
    eventType,
    detail: detail as never,
  })
}

export async function listRoles(db: Db, companyId: string) {
  const rows = await db
    .select()
    .from(roles)
    .where(and(eq(roles.companyId, companyId), isNull(roles.deletedAt)))
    .orderBy(asc(roles.code))

  return rows.map((role) => roleDto(role))
}

export async function createRole(db: Db, companyId: string, input: CreateRoleInput) {
  try {
    const [role] = await db
      .insert(roles)
      .values({
        companyId,
        code: input.code,
        name: input.name,
        description: input.description,
        defaultScopeType: input.default_scope_type,
      })
      .returning()
    return roleDto(role)
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict()
    throw error
  }
}

export async function getRole(db: Db, companyId: string, roleId: string) {
  const role = await getActiveRole(db, companyId, roleId)
  if (!role) throw notFound()

  const permissionRows = await db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.companyId, companyId)))
    .orderBy(asc(permissions.code))

  return roleDto(role, permissionRows.map((permission) => permission.code))
}

export async function updateRole(db: Db, companyId: string, roleId: string, input: UpdateRoleInput) {
  const role = await getActiveRole(db, companyId, roleId)
  if (!role) throw notFound()
  if (role.isSystem) throw forbidden('System role tidak boleh diubah')

  const [updated] = await db
    .update(roles)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.default_scope_type !== undefined ? { defaultScopeType: input.default_scope_type } : {}),
      updatedAt: new Date(),
    })
    .where(eq(roles.id, role.id))
    .returning()

  return roleDto(updated)
}

export async function deleteRole(db: Db, companyId: string, roleId: string) {
  const role = await getActiveRole(db, companyId, roleId)
  if (!role) throw notFound()
  if (role.isSystem) throw forbidden('System role tidak boleh dihapus')

  const [deleted] = await db
    .update(roles)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(roles.id, role.id))
    .returning()

  return roleDto(deleted)
}

export async function setRolePermissions(
  db: Db,
  companyId: string,
  roleId: string,
  input: SetRolePermissionsInput
) {
  const role = await getActiveRole(db, companyId, roleId)
  if (!role) throw notFound()
  if (role.isSystem) throw forbidden('System role permission tidak boleh diubah')

  const rows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, input.permission_codes))
  const foundCodes = new Set(rows.map((permission) => permission.code))
  const missing = input.permission_codes.filter((code) => !foundCodes.has(code))
  if (missing.length > 0) {
    throw validation([{ field: 'permission_codes', issue: `permission tidak ditemukan: ${missing.join(', ')}` }])
  }

  await db
    .delete(rolePermissions)
    .where(and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.companyId, companyId)))

  await db.insert(rolePermissions).values(
    rows.map((permission) => ({
      roleId: role.id,
      permissionId: permission.id,
      companyId,
    }))
  )

  return getRole(db, companyId, role.id)
}

export async function listPermissions(db: Db) {
  const rows = await db.select().from(permissions).orderBy(asc(permissions.code))
  return rows.map(permissionDto)
}

export async function assignUserRole(
  db: Db,
  companyId: string,
  targetUserId: string,
  input: AssignRoleInput,
  grantedBy: string
) {
  const [targetUser, role] = await Promise.all([
    getUserInCompany(db, companyId, targetUserId),
    getActiveRole(db, companyId, input.role_id),
    assertScopeBelongsToCompany(db, companyId, input.scope_type as ScopeType, input.scope_id),
  ])
  if (!targetUser || !role) throw notFound()

  try {
    const [assignment] = await db
      .insert(userRoles)
      .values({
        userId: targetUserId,
        roleId: role.id,
        companyId,
        scopeType: input.scope_type,
        scopeId: input.scope_id,
        grantedBy,
      })
      .returning()

    await logRbacEvent(db, companyId, grantedBy, 'rbac_role_assigned', {
      target_user_id: targetUserId,
      role_id: role.id,
      scope_type: input.scope_type,
      scope_id: input.scope_id,
    })

    return userRoleDto({
      ...assignment,
      roleCode: role.code,
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict()
    throw error
  }
}

export async function listUserRoles(db: Db, companyId: string, targetUserId: string) {
  const targetUser = await getUserInCompany(db, companyId, targetUserId)
  if (!targetUser) throw notFound()

  const rows = await db
    .select({
      id: userRoles.id,
      userId: userRoles.userId,
      roleId: userRoles.roleId,
      roleCode: roles.code,
      scopeType: userRoles.scopeType,
      scopeId: userRoles.scopeId,
      createdAt: userRoles.createdAt,
      deletedAt: userRoles.deletedAt,
    })
    .from(userRoles)
    .innerJoin(roles, and(eq(userRoles.roleId, roles.id), eq(roles.companyId, companyId), isNull(roles.deletedAt)))
    .where(and(eq(userRoles.companyId, companyId), eq(userRoles.userId, targetUserId), isNull(userRoles.deletedAt)))
    .orderBy(asc(roles.code))

  return rows.map(userRoleDto)
}

export async function revokeUserRole(
  db: Db,
  companyId: string,
  targetUserId: string,
  assignmentId: string,
  revokedBy: string
) {
  const targetUser = await getUserInCompany(db, companyId, targetUserId)
  if (!targetUser) throw notFound()

  const [assignment] = await db
    .update(userRoles)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(userRoles.id, assignmentId),
        eq(userRoles.companyId, companyId),
        eq(userRoles.userId, targetUserId),
        isNull(userRoles.deletedAt)
      )
    )
    .returning()
  if (!assignment) throw notFound()

  await logRbacEvent(db, companyId, revokedBy, 'rbac_role_revoked', {
    target_user_id: targetUserId,
    assignment_id: assignmentId,
  })

  const role = await getActiveRole(db, companyId, assignment.roleId)
  return userRoleDto({ ...assignment, roleCode: role?.code ?? '' })
}

export async function createAccessOverride(
  db: Db,
  companyId: string,
  targetUserId: string,
  input: CreateOverrideInput,
  grantedBy: string
) {
  const [targetUser, permission] = await Promise.all([
    getUserInCompany(db, companyId, targetUserId),
    getPermissionByCode(db, input.permission_code),
    assertScopeBelongsToCompany(db, companyId, input.scope_type as ScopeType, input.scope_id),
  ])
  if (!targetUser || !permission) throw notFound()

  const existing = await db
    .select()
    .from(accessOverrides)
    .where(
      and(
        eq(accessOverrides.companyId, companyId),
        eq(accessOverrides.userId, targetUserId),
        eq(accessOverrides.permissionId, permission.id),
        eq(accessOverrides.scopeType, input.scope_type),
        input.scope_id === null ? isNull(accessOverrides.scopeId) : eq(accessOverrides.scopeId, input.scope_id),
        isNull(accessOverrides.deletedAt)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  const expiresAt = input.expires_at ? new Date(input.expires_at) : null
  const values = {
    effect: input.effect,
    scopeType: input.scope_type,
    scopeId: input.scope_id,
    reason: input.reason,
    grantedBy,
    expiresAt,
  }

  const [override] = existing
    ? await db.update(accessOverrides).set(values).where(eq(accessOverrides.id, existing.id)).returning()
    : await db
        .insert(accessOverrides)
        .values({
          userId: targetUserId,
          permissionId: permission.id,
          companyId,
          ...values,
        })
        .returning()

  await logRbacEvent(db, companyId, grantedBy, 'rbac_override_upserted', {
    target_user_id: targetUserId,
    permission_code: input.permission_code,
    effect: input.effect,
    scope_type: input.scope_type,
    scope_id: input.scope_id,
  })

  return overrideDto({
    ...override,
    permissionCode: permission.code,
  })
}

export async function deleteAccessOverride(
  db: Db,
  companyId: string,
  targetUserId: string,
  overrideId: string,
  deletedBy: string
) {
  const targetUser = await getUserInCompany(db, companyId, targetUserId)
  if (!targetUser) throw notFound()

  const row = await db
    .select({
      id: accessOverrides.id,
      permissionCode: permissions.code,
    })
    .from(accessOverrides)
    .innerJoin(permissions, eq(accessOverrides.permissionId, permissions.id))
    .where(
      and(
        eq(accessOverrides.id, overrideId),
        eq(accessOverrides.companyId, companyId),
        eq(accessOverrides.userId, targetUserId),
        isNull(accessOverrides.deletedAt)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!row) throw notFound()

  const [deleted] = await db
    .update(accessOverrides)
    .set({ deletedAt: new Date() })
    .where(eq(accessOverrides.id, row.id))
    .returning()

  await logRbacEvent(db, companyId, deletedBy, 'rbac_override_deleted', {
    target_user_id: targetUserId,
    override_id: overrideId,
    permission_code: row.permissionCode,
  })

  return overrideDto({
    ...deleted,
    permissionCode: row.permissionCode,
  })
}
