import { and, eq, gt, isNull, or } from 'drizzle-orm'
import {
  accessOverrides,
  departments,
  outlets,
  permissions,
  rolePermissions,
  roles,
  userRoles,
} from '@egg-os/db'
import type { Db } from '../../lib/db'

export type ScopeType =
  | 'global'
  | 'company'
  | 'brand'
  | 'outlet'
  | 'department'
  | 'own'
  | 'assigned'
  | 'audit_view'

export type ScopeRef = {
  scopeType: ScopeType
  scopeId: string | null
}

export type Grant = ScopeRef & {
  permission: string
}

export type ResolvedAccess = {
  roles: string[]
  grants: Grant[]
  rawScopes: ScopeRef[]
}

export type OrgTree = {
  outletsById: Record<string, { brandId: string }>
  departmentsById: Record<string, { brandId: string | null; outletId: string | null }>
}

export type PermissionTarget = ScopeRef & {
  orgTree?: OrgTree
}

type OverrideEffect = 'grant' | 'deny'

type OverrideRule = Grant & {
  effect: OverrideEffect
}

const emptyOrgTree: OrgTree = {
  outletsById: {},
  departmentsById: {},
}

const rowLevelScopes = new Set<ScopeType>(['own', 'assigned'])

function scopeKey(scope: ScopeRef) {
  return `${scope.scopeType}:${scope.scopeId ?? ''}`
}

function grantKey(grant: Grant) {
  return `${grant.permission}:${scopeKey(grant)}`
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values))
}

function uniqueGrants(grants: Grant[]) {
  return Array.from(new Map(grants.map((grant) => [grantKey(grant), grant])).values())
}

function uniqueScopes(scopes: ScopeRef[]) {
  return Array.from(new Map(scopes.map((scope) => [scopeKey(scope), scope])).values())
}

function isReadOnlyPermission(permission: string) {
  const action = permission.split('.')[1] ?? ''
  return action === 'read' || action === 'list' || action.endsWith('_read') || action.endsWith('_list')
}

function targetBrandId(target: ScopeRef, orgTree: OrgTree) {
  if (target.scopeType === 'brand') return target.scopeId
  if (target.scopeType === 'outlet' && target.scopeId) {
    return orgTree.outletsById[target.scopeId]?.brandId ?? null
  }
  if (target.scopeType === 'department' && target.scopeId) {
    const department = orgTree.departmentsById[target.scopeId]
    if (!department) return null
    if (department.brandId) return department.brandId
    return department.outletId ? orgTree.outletsById[department.outletId]?.brandId ?? null : null
  }
  return null
}

function targetOutletId(target: ScopeRef, orgTree: OrgTree) {
  if (target.scopeType === 'outlet') return target.scopeId
  if (target.scopeType === 'department' && target.scopeId) {
    return orgTree.departmentsById[target.scopeId]?.outletId ?? null
  }
  return null
}

/**
 * DENY override berlaku MENYELURUH terhadap grant yang scope-nya overlap. Jika ada deny pada scope yang lebih sempit (mis. outlet X di bawah brand B) terhadap grant brand B, maka SELURUH grant brand B untuk permission itu dibuang — bukan hanya outlet X. Ini keputusan sadar: deny bersifat agresif (fail-closed) demi keamanan. Untuk deny granular, pasang deny pada level scope yang sama dengan grant.
 */
function scopesOverlap(left: Grant, right: Grant, orgTree: OrgTree) {
  if (left.scopeType === right.scopeType && left.scopeId === right.scopeId) return true
  if (left.scopeType === 'global' || right.scopeType === 'global') return true
  if (left.scopeType === 'company' || right.scopeType === 'company') return true
  if (rowLevelScopes.has(left.scopeType) || rowLevelScopes.has(right.scopeType)) return false
  if (left.scopeType === 'audit_view' || right.scopeType === 'audit_view') return false

  return scopeCovers(left, right, orgTree) || scopeCovers(right, left, orgTree)
}

/**
 * DENY override berlaku MENYELURUH terhadap grant yang scope-nya overlap. Jika ada deny pada scope yang lebih sempit (mis. outlet X di bawah brand B) terhadap grant brand B, maka SELURUH grant brand B untuk permission itu dibuang — bukan hanya outlet X. Ini keputusan sadar: deny bersifat agresif (fail-closed) demi keamanan. Untuk deny granular, pasang deny pada level scope yang sama dengan grant.
 */
function applyDenyRules(grants: Grant[], denyRules: Grant[], orgTree: OrgTree) {
  return grants.filter((grant) => {
    return !denyRules.some((denyRule) => {
      return denyRule.permission === grant.permission && scopesOverlap(denyRule, grant, orgTree)
    })
  })
}

export async function buildOrgTree(db: Db, companyId: string): Promise<OrgTree> {
  const [outletRows, departmentRows] = await Promise.all([
    db
      .select({
        id: outlets.id,
        brandId: outlets.brandId,
      })
      .from(outlets)
      .where(and(eq(outlets.companyId, companyId), isNull(outlets.deletedAt))),
    db
      .select({
        id: departments.id,
        brandId: departments.brandId,
        outletId: departments.outletId,
      })
      .from(departments)
      .where(and(eq(departments.companyId, companyId), isNull(departments.deletedAt))),
  ])

  return {
    outletsById: Object.fromEntries(outletRows.map((outlet) => [outlet.id, { brandId: outlet.brandId }])),
    departmentsById: Object.fromEntries(
      departmentRows.map((department) => [
        department.id,
        { brandId: department.brandId, outletId: department.outletId },
      ])
    ),
  }
}

export async function resolveUserPermissions(db: Db, userId: string, companyId: string): Promise<ResolvedAccess> {
  const now = new Date()

  const [assignmentRows, roleGrantRows, overrideRows, orgTree] = await Promise.all([
    db
      .select({
        roleCode: roles.code,
        scopeType: userRoles.scopeType,
        scopeId: userRoles.scopeId,
      })
      .from(userRoles)
      .innerJoin(roles, and(eq(userRoles.roleId, roles.id), eq(roles.companyId, companyId), isNull(roles.deletedAt)))
      .where(and(eq(userRoles.userId, userId), eq(userRoles.companyId, companyId), isNull(userRoles.deletedAt))),
    db
      .select({
        permission: permissions.code,
        scopeType: userRoles.scopeType,
        scopeId: userRoles.scopeId,
      })
      .from(userRoles)
      .innerJoin(roles, and(eq(userRoles.roleId, roles.id), eq(roles.companyId, companyId), isNull(roles.deletedAt)))
      .innerJoin(
        rolePermissions,
        and(eq(rolePermissions.roleId, roles.id), eq(rolePermissions.companyId, companyId))
      )
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(and(eq(userRoles.userId, userId), eq(userRoles.companyId, companyId), isNull(userRoles.deletedAt))),
    db
      .select({
        permission: permissions.code,
        effect: accessOverrides.effect,
        scopeType: accessOverrides.scopeType,
        scopeId: accessOverrides.scopeId,
      })
      .from(accessOverrides)
      .innerJoin(permissions, eq(accessOverrides.permissionId, permissions.id))
      .where(
        and(
          eq(accessOverrides.userId, userId),
          eq(accessOverrides.companyId, companyId),
          isNull(accessOverrides.deletedAt),
          or(isNull(accessOverrides.expiresAt), gt(accessOverrides.expiresAt, now))
        )
      ),
    buildOrgTree(db, companyId),
  ])

  const roleGrants: Grant[] = roleGrantRows.map((row) => ({
    permission: row.permission,
    scopeType: row.scopeType as ScopeType,
    scopeId: row.scopeId,
  }))

  const overrideRules: OverrideRule[] = overrideRows.map((row) => ({
    permission: row.permission,
    effect: row.effect as OverrideEffect,
    scopeType: row.scopeType as ScopeType,
    scopeId: row.scopeId,
  }))

  const grantOverrides: Grant[] = overrideRules
    .filter((rule) => rule.effect === 'grant')
    .map(({ permission, scopeType, scopeId }) => ({ permission, scopeType, scopeId }))
  const denyRules: Grant[] = overrideRules
    .filter((rule) => rule.effect === 'deny')
    .map(({ permission, scopeType, scopeId }) => ({ permission, scopeType, scopeId }))
  const grants = uniqueGrants(applyDenyRules([...roleGrants, ...grantOverrides], denyRules, orgTree))

  return {
    roles: uniqueValues(assignmentRows.map((row) => row.roleCode)),
    grants,
    rawScopes: uniqueScopes(grants.map((grant) => ({ scopeType: grant.scopeType, scopeId: grant.scopeId }))),
  }
}

export function scopeCovers(grant: Grant, target: ScopeRef, orgTree: OrgTree = emptyOrgTree) {
  if (grant.scopeType === 'global') return true
  if (grant.scopeType === 'company') return true
  if (grant.scopeType === 'own' || grant.scopeType === 'assigned') return false
  if (grant.scopeType === 'audit_view') return isReadOnlyPermission(grant.permission)
  if (!grant.scopeId || !target.scopeId) return false

  if (grant.scopeType === 'brand') {
    return targetBrandId(target, orgTree) === grant.scopeId
  }

  if (grant.scopeType === 'outlet') {
    return targetOutletId(target, orgTree) === grant.scopeId
  }

  if (grant.scopeType === 'department') {
    return target.scopeType === 'department' && target.scopeId === grant.scopeId
  }

  return false
}

export function hasPermission(
  access: ResolvedAccess,
  permissionCode: string,
  target?: PermissionTarget
): 'allow' | 'forbidden' | 'out_of_scope' {
  const permissionGrants = access.grants.filter((grant) => grant.permission === permissionCode)
  if (permissionGrants.length === 0) return 'forbidden'

  if (permissionGrants.every((grant) => rowLevelScopes.has(grant.scopeType))) return 'allow'

  const structuralGrants = permissionGrants.filter((grant) => !rowLevelScopes.has(grant.scopeType))
  const effectiveStructuralGrants = structuralGrants.filter((grant) => {
    return grant.scopeType !== 'audit_view' || isReadOnlyPermission(grant.permission)
  })

  if (effectiveStructuralGrants.length === 0) return 'forbidden'
  if (!target) return 'allow'

  const orgTree = target.orgTree ?? emptyOrgTree
  if (effectiveStructuralGrants.some((grant) => scopeCovers(grant, target, orgTree))) return 'allow'

  return 'out_of_scope'
}
