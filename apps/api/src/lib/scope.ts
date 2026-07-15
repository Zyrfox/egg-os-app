import { ERR } from './errors'
import type { Db } from './db'
import type { AccessFilter } from '../modules/rbac/middleware'
import {
  buildOrgTree,
  scopeCovers,
  type Grant,
  type OrgTree,
  type ResolvedAccess,
  type ScopeRef,
} from '../modules/rbac/resolve'

export type ScopeContext = {
  companyId: string
  actorUserId: string
  access?: ResolvedAccess
  accessFilter?: AccessFilter
}

export class ScopeError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { field: string; issue: string }[]
  ) {
    super(message)
  }
}

function outOfScope() {
  return new ScopeError(ERR.OUT_OF_SCOPE.http, ERR.OUT_OF_SCOPE.code, ERR.OUT_OF_SCOPE.message)
}

function permissionScopes(ctx: ScopeContext, permission: string): ScopeRef[] {
  if (ctx.accessFilter?.permission === permission) {
    return ctx.accessFilter.structuralScopes
  }

  if (!ctx.access) return []

  return ctx.access.grants
    .filter((grant) => grant.permission === permission)
    .map(({ scopeType, scopeId }) => ({ scopeType, scopeId }))
}

function outletVisibleWithScopes(scopes: ScopeRef[], permission: string, outletId: string, orgTree: OrgTree) {
  const target = { scopeType: 'outlet' as const, scopeId: outletId }
  return scopes.some((scope) => scopeCovers({ permission, ...scope } as Grant, target, orgTree))
}

export async function assertOutletInScope(db: Db, ctx: ScopeContext, outletId: string, permission: string) {
  const orgTree = await buildOrgTree(db, ctx.companyId)
  const scopes = permissionScopes(ctx, permission)
  if (!outletVisibleWithScopes(scopes, permission, outletId, orgTree)) throw outOfScope()
}

export async function visibleOutletIdsForPermission(db: Db, ctx: ScopeContext, permission: string) {
  const orgTree = await buildOrgTree(db, ctx.companyId)
  const scopes = permissionScopes(ctx, permission)
  if (scopes.length === 0) return []

  return Object.keys(orgTree.outletsById).filter((outletId) => {
    return outletVisibleWithScopes(scopes, permission, outletId, orgTree)
  })
}
