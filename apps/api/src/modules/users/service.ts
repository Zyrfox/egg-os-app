import { and, asc, eq, ilike, isNull, or, sql as drizzleSql } from 'drizzle-orm'
import {
  authEvents,
  passwordTokens,
  refreshTokens,
  roles,
  userRoles,
  users,
} from '@egg-os/db'
import type {
  AssignUserRoleInput,
  InviteUserInput,
  ListUsersInput,
  UpdateUserInput,
} from '@egg-os/validation'
import { AUTH } from '../../lib/constants'
import type { Db } from '../../lib/db'
import { generateToken, hashToken } from '../../lib/crypto'
import { ERR } from '../../lib/errors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AccessFilter } from '../rbac/middleware'
import {
  assignUserRole,
  revokeUserRole,
  RbacServiceError,
} from '../rbac/service'
import {
  buildOrgTree,
  resolveUserPermissions,
  scopeCovers,
  type Grant,
  type OrgTree,
  type ResolvedAccess,
  type ScopeRef,
  type ScopeType,
} from '../rbac/resolve'

export type ErrorDetail = { field: string; issue: string }

export type UsersServiceContext = {
  companyId: string
  actorUserId: string
  access?: ResolvedAccess
  accessFilter?: AccessFilter
}

type UserRow = typeof users.$inferSelect
type RoleAssignmentRow = {
  assignmentId: string
  roleCode: string
  scopeType: string
  scopeId: string | null
}

export class UsersServiceError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[]
  ) {
    super(message)
  }
}

const scopeRank: Record<ScopeType, number> = {
  own: 1,
  assigned: 1,
  department: 2,
  outlet: 3,
  brand: 4,
  company: 5,
  audit_view: 5,
  global: 6,
}

const rowLevelScopeTypes = new Set<ScopeType>(['own', 'assigned'])

function iso(date: Date | null) {
  return date?.toISOString() ?? null
}

function duplicate() {
  return new UsersServiceError(ERR.DUPLICATE.http, ERR.DUPLICATE.code, ERR.DUPLICATE.message)
}

function forbidden(message: string = ERR.FORBIDDEN.message) {
  return new UsersServiceError(ERR.FORBIDDEN.http, ERR.FORBIDDEN.code, message)
}

function outOfScope() {
  return new UsersServiceError(ERR.OUT_OF_SCOPE.http, ERR.OUT_OF_SCOPE.code, ERR.OUT_OF_SCOPE.message)
}

function validation(details: ErrorDetail[]) {
  return new UsersServiceError(ERR.VALIDATION.http, ERR.VALIDATION.code, ERR.VALIDATION.message, details)
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

function fromRbacServiceError(error: RbacServiceError) {
  return new UsersServiceError(error.status, error.code, error.message, error.details)
}

function userRoleDto(row: RoleAssignmentRow) {
  return {
    assignment_id: row.assignmentId,
    role_code: row.roleCode,
    scope_type: row.scopeType,
    scope_id: row.scopeId,
  }
}

async function listActiveRoleAssignments(db: Db, companyId: string, userId: string) {
  return db
    .select({
      assignmentId: userRoles.id,
      roleCode: roles.code,
      scopeType: userRoles.scopeType,
      scopeId: userRoles.scopeId,
    })
    .from(userRoles)
    .innerJoin(roles, and(eq(userRoles.roleId, roles.id), eq(roles.companyId, companyId), isNull(roles.deletedAt)))
    .where(and(eq(userRoles.companyId, companyId), eq(userRoles.userId, userId), isNull(userRoles.deletedAt)))
    .orderBy(asc(roles.code))
}

async function toPublicUserDetail(db: Db, user: UserRow) {
  const roleRows = await listActiveRoleAssignments(db, user.companyId, user.id)

  return {
    id: user.id,
    company_id: user.companyId,
    email: user.email,
    full_name: user.fullName,
    phone: user.phone,
    status: user.status,
    first_login_required: user.firstLoginRequired,
    is_freelance: user.isFreelance,
    freelance_expires_at: iso(user.freelanceExpiresAt),
    last_login_at: iso(user.lastLoginAt),
    created_at: user.createdAt.toISOString(),
    roles: roleRows.map(userRoleDto),
  }
}

async function logUserEvent(
  db: Db,
  companyId: string,
  actorUserId: string,
  eventType: string,
  detail: Record<string, unknown>
) {
  await db.insert(authEvents).values({
    companyId,
    userId: actorUserId,
    eventType,
    detail: detail as never,
  })
}

async function getActorAccess(db: Db, ctx: UsersServiceContext) {
  return ctx.access ?? resolveUserPermissions(db, ctx.actorUserId, ctx.companyId)
}

function scopeFromAssignment(row: RoleAssignmentRow): ScopeRef {
  return {
    scopeType: row.scopeType as ScopeType,
    scopeId: row.scopeId,
  }
}

async function targetWasAssignedByActor(db: Db, ctx: UsersServiceContext, targetUserId: string) {
  const row = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.companyId, ctx.companyId),
        eq(userRoles.userId, targetUserId),
        eq(userRoles.grantedBy, ctx.actorUserId),
        isNull(userRoles.deletedAt)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return row !== null
}

function grantCanCoverTargetAssignment(grant: Grant, target: ScopeRef, orgTree: OrgTree) {
  if (rowLevelScopeTypes.has(grant.scopeType)) return false
  return scopeCovers(grant, target, orgTree)
}

async function canAccessUserRecord(
  db: Db,
  ctx: UsersServiceContext,
  targetUser: UserRow,
  permissionCode: string,
  orgTree: OrgTree
) {
  const access = await getActorAccess(db, ctx)
  const grants = access.grants.filter((grant) => grant.permission === permissionCode)
  if (grants.length === 0) return false

  if (grants.some((grant) => grant.scopeType === 'global' || grant.scopeType === 'company')) return true
  if (grants.some((grant) => grant.scopeType === 'audit_view')) return permissionCode === 'users.read'

  if (ctx.accessFilter?.permission === permissionCode) {
    if (ctx.accessFilter.ownOnly && targetUser.createdBy === ctx.actorUserId) return true
    if (ctx.accessFilter.assignedOnly && await targetWasAssignedByActor(db, ctx, targetUser.id)) return true
  }

  if (grants.some((grant) => grant.scopeType === 'own') && targetUser.createdBy === ctx.actorUserId) {
    return true
  }

  if (grants.some((grant) => grant.scopeType === 'assigned') && await targetWasAssignedByActor(db, ctx, targetUser.id)) {
    return true
  }

  const targetAssignments = await listActiveRoleAssignments(db, ctx.companyId, targetUser.id)
  return targetAssignments.some((assignment) => {
    const target = scopeFromAssignment(assignment)
    return grants.some((grant) => grantCanCoverTargetAssignment(grant, target, orgTree))
  })
}

async function assertUserInScope(
  db: Db,
  ctx: UsersServiceContext,
  userId: string,
  permissionCode: string
) {
  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, ctx.companyId)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!user) throw outOfScope()

  const orgTree = await buildOrgTree(db, ctx.companyId)
  if (!(await canAccessUserRecord(db, ctx, user, permissionCode, orgTree))) throw outOfScope()

  return user
}

function assertSelfGuard(ctx: UsersServiceContext, targetUser: UserRow) {
  if (ctx.actorUserId === targetUser.id) {
    throw validation([{ field: 'id', issue: 'tidak bisa menonaktifkan akun sendiri' }])
  }
}

function assertStatusTransition(user: UserRow, action: 'suspend' | 'reactivate' | 'archive') {
  if (user.status === 'archived') {
    throw validation([{ field: 'status', issue: 'archived adalah status terminal' }])
  }

  if (action === 'suspend' && user.status !== 'active') {
    throw validation([{ field: 'status', issue: 'suspend hanya valid dari active' }])
  }

  if (action === 'reactivate' && user.status !== 'suspended') {
    throw validation([{ field: 'status', issue: 'reactivate hanya valid dari suspended' }])
  }

  if (action === 'archive' && user.status !== 'active' && user.status !== 'suspended') {
    throw validation([{ field: 'status', issue: 'archive hanya valid dari active atau suspended' }])
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

function maxAssignableScopeRank(access: ResolvedAccess) {
  const grants = access.grants.filter((grant) => grant.permission === 'rbac.role_assign')
  return grants.reduce((max, grant) => Math.max(max, scopeRank[grant.scopeType]), 0)
}

function canCoverRequestedAssignment(access: ResolvedAccess, input: AssignUserRoleInput, orgTree: OrgTree) {
  const requestedScope = {
    scopeType: input.scope_type as ScopeType,
    scopeId: input.scope_id,
  }

  if (rowLevelScopeTypes.has(requestedScope.scopeType)) return true

  return access.grants.some((grant) => {
    return grant.permission === 'rbac.role_assign' && grantCanCoverTargetAssignment(grant, requestedScope, orgTree)
  })
}

async function assertCanAssignRole(
  db: Db,
  ctx: UsersServiceContext,
  input: AssignUserRoleInput
) {
  const role = await getActiveRole(db, ctx.companyId, input.role_id)
  if (!role) throw outOfScope()

  const access = await getActorAccess(db, ctx)
  const maxRank = maxAssignableScopeRank(access)
  const roleDefaultScopeType = role.defaultScopeType as ScopeType
  const requestedScopeType = input.scope_type as ScopeType

  if (maxRank === 0) throw forbidden()

  if (scopeRank[roleDefaultScopeType] > maxRank || scopeRank[requestedScopeType] > maxRank) {
    throw forbidden('Tidak boleh assign role dengan scope lebih tinggi dari admin')
  }

  const orgTree = await buildOrgTree(db, ctx.companyId)
  if (!canCoverRequestedAssignment(access, input, orgTree)) {
    throw outOfScope()
  }

  return role
}

async function createPasswordToken(db: Db, user: UserRow, type: 'set_password' | 'reset_password') {
  const rawToken = generateToken()
  const ttl = type === 'set_password' ? AUTH.SET_PASSWORD_TTL_SEC : AUTH.RESET_PASSWORD_TTL_SEC
  const expiresAt = new Date(Date.now() + ttl * 1000)

  await db.insert(passwordTokens).values({
    userId: user.id,
    companyId: user.companyId,
    tokenHash: hashToken(rawToken),
    type,
    expiresAt,
  })

  return rawToken
}

export async function listUsers(db: Db, ctx: UsersServiceContext, query: ListUsersInput) {
  const conditions = [eq(users.companyId, ctx.companyId)]

  if (query.status) {
    conditions.push(eq(users.status, query.status))
  } else {
    conditions.push(isNull(users.deletedAt))
  }

  if (query.search) {
    const search = `%${query.search}%`
    conditions.push(or(ilike(users.email, search), ilike(users.fullName, search))!)
  }

  const rows = await db
    .select()
    .from(users)
    .where(and(...conditions))
    .orderBy(asc(users.email))

  const orgTree = await buildOrgTree(db, ctx.companyId)
  const visibleRows = []
  for (const row of rows) {
    if (await canAccessUserRecord(db, ctx, row, 'users.read', orgTree)) {
      visibleRows.push(row)
    }
  }

  const start = (query.page - 1) * query.page_size
  const pageRows = visibleRows.slice(start, start + query.page_size)
  const data = []
  for (const row of pageRows) {
    data.push(await toPublicUserDetail(db, row))
  }

  return {
    data,
    meta: {
      page: query.page,
      page_size: query.page_size,
      total: visibleRows.length,
    },
  }
}

export async function getUserDetail(db: Db, ctx: UsersServiceContext, userId: string) {
  const user = await assertUserInScope(db, ctx, userId, 'users.read')
  return toPublicUserDetail(db, user)
}

export async function inviteUser(db: Db, ctx: UsersServiceContext, input: InviteUserInput) {
  const normalizedEmail = input.email.toLowerCase()

  try {
    return await db.transaction(async (tx) => {
      // Drizzle's transaction type is structurally compatible with Db but not exported as the same alias.
      const txDb = tx as unknown as Db
      const existing = await txDb
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.companyId, ctx.companyId), eq(drizzleSql`lower(${users.email})`, normalizedEmail)))
        .limit(1)
        .then((rows) => rows[0] ?? null)

      if (existing) throw duplicate()

      if (input.role) {
        await assertCanAssignRole(txDb, ctx, input.role)
      }

      const [user] = await txDb
        .insert(users)
        .values({
          companyId: ctx.companyId,
          email: normalizedEmail,
          fullName: input.full_name,
          phone: input.phone,
          passwordHash: null,
          status: 'invited',
          firstLoginRequired: true,
          isFreelance: input.is_freelance,
          freelanceExpiresAt: input.freelance_expires_at ? new Date(input.freelance_expires_at) : null,
          createdBy: ctx.actorUserId,
        })
        .returning()

      await createPasswordToken(txDb, user, 'set_password')

      if (input.role) {
        await assignUserRole(txDb, ctx.companyId, user.id, input.role, ctx.actorUserId)
      }

      await logUserEvent(txDb, ctx.companyId, ctx.actorUserId, 'user_invited', {
        target_user_id: user.id,
        email: user.email,
        set_password_token_created: true,
        email_delivery: 'stubbed',
      })

      return toPublicUserDetail(txDb, user)
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicate()
    if (error instanceof RbacServiceError) throw fromRbacServiceError(error)
    throw error
  }
}

export async function updateUser(
  db: Db,
  ctx: UsersServiceContext,
  userId: string,
  input: UpdateUserInput
) {
  const user = await assertUserInScope(db, ctx, userId, 'users.update')
  if (user.status === 'archived') {
    throw validation([{ field: 'status', issue: 'archived adalah status terminal' }])
  }

  const [updated] = await db
    .update(users)
    .set({
      ...(input.full_name !== undefined ? { fullName: input.full_name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, user.id), eq(users.companyId, ctx.companyId)))
    .returning()

  await logUserEvent(db, ctx.companyId, ctx.actorUserId, 'user_updated', {
    target_user_id: user.id,
  })

  return toPublicUserDetail(db, updated)
}

export async function suspendUser(db: Db, ctx: UsersServiceContext, userId: string) {
  const user = await assertUserInScope(db, ctx, userId, 'users.suspend')
  assertSelfGuard(ctx, user)
  assertStatusTransition(user, 'suspend')

  const [updated] = await db
    .update(users)
    .set({ status: 'suspended', updatedAt: new Date() })
    .where(and(eq(users.id, user.id), eq(users.companyId, ctx.companyId)))
    .returning()

  await logUserEvent(db, ctx.companyId, ctx.actorUserId, 'user_suspended', {
    target_user_id: user.id,
  })

  return toPublicUserDetail(db, updated)
}

export async function reactivateUser(db: Db, ctx: UsersServiceContext, userId: string) {
  const user = await assertUserInScope(db, ctx, userId, 'users.update')
  assertStatusTransition(user, 'reactivate')

  const [updated] = await db
    .update(users)
    .set({ status: 'active', updatedAt: new Date() })
    .where(and(eq(users.id, user.id), eq(users.companyId, ctx.companyId)))
    .returning()

  await logUserEvent(db, ctx.companyId, ctx.actorUserId, 'user_reactivated', {
    target_user_id: user.id,
  })

  return toPublicUserDetail(db, updated)
}

export async function archiveUser(db: Db, ctx: UsersServiceContext, userId: string) {
  return db.transaction(async (tx) => {
    // Drizzle's transaction type is structurally compatible with Db but not exported as the same alias.
    const txDb = tx as unknown as Db
    const user = await assertUserInScope(txDb, ctx, userId, 'users.archive')
    assertSelfGuard(ctx, user)
    assertStatusTransition(user, 'archive')

    const now = new Date()
    const [archived] = await txDb
      .update(users)
      .set({ status: 'archived', deletedAt: now, updatedAt: now })
      .where(and(eq(users.id, user.id), eq(users.companyId, ctx.companyId)))
      .returning()

    await txDb
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.companyId, ctx.companyId), eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)))

    await txDb
      .update(userRoles)
      .set({ deletedAt: now })
      .where(and(eq(userRoles.companyId, ctx.companyId), eq(userRoles.userId, user.id), isNull(userRoles.deletedAt)))

    await logUserEvent(txDb, ctx.companyId, ctx.actorUserId, 'user_archived', {
      target_user_id: user.id,
    })

    return toPublicUserDetail(txDb, archived)
  })
}

export async function assignRoleToUser(
  db: Db,
  ctx: UsersServiceContext,
  userId: string,
  input: AssignUserRoleInput
) {
  await assertUserInScope(db, ctx, userId, 'rbac.role_assign')
  await assertCanAssignRole(db, ctx, input)

  try {
    return await assignUserRole(db, ctx.companyId, userId, input, ctx.actorUserId)
  } catch (error) {
    if (error instanceof RbacServiceError) throw fromRbacServiceError(error)
    throw error
  }
}

export async function revokeRoleFromUser(
  db: Db,
  ctx: UsersServiceContext,
  userId: string,
  assignmentId: string
) {
  await assertUserInScope(db, ctx, userId, 'rbac.role_assign')

  try {
    return await revokeUserRole(db, ctx.companyId, userId, assignmentId, ctx.actorUserId)
  } catch (error) {
    if (error instanceof RbacServiceError) throw fromRbacServiceError(error)
    throw error
  }
}

export async function resetPasswordForUser(db: Db, ctx: UsersServiceContext, userId: string) {
  const user = await assertUserInScope(db, ctx, userId, 'users.update')
  if (user.status === 'archived') {
    throw validation([{ field: 'status', issue: 'archived adalah status terminal' }])
  }

  await createPasswordToken(db, user, 'reset_password')
  const [updated] = await db
    .update(users)
    .set({ firstLoginRequired: true, updatedAt: new Date() })
    .where(and(eq(users.id, user.id), eq(users.companyId, ctx.companyId)))
    .returning()

  await logUserEvent(db, ctx.companyId, ctx.actorUserId, 'user_password_reset_requested', {
    target_user_id: user.id,
    reset_password_token_created: true,
  })

  return toPublicUserDetail(db, updated)
}
