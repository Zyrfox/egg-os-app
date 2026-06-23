import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import { createDb } from '../../lib/db'
import { errResponse, ERR } from '../../lib/errors'
import type { AuthCtx, Env } from '../../types'
import {
  buildOrgTree,
  hasPermission,
  resolveUserPermissions,
  type ResolvedAccess,
  type ScopeRef,
} from './resolve'

export type AccessFilter = {
  permission: string
  ownOnly: boolean
  assignedOnly: boolean
  rowLevelScopes: ScopeRef[]
  structuralScopes: ScopeRef[]
}

export type RbacVariables = {
  auth: AuthCtx
  access?: ResolvedAccess
  accessFilter?: AccessFilter
}

type RbacContext = Context<{
  Bindings: Env
  Variables: RbacVariables
}>

export type PermissionTargetResolver = (c: RbacContext) => ScopeRef | null

const rowLevelScopeTypes = new Set(['own', 'assigned'])

function outOfScopeResponse() {
  return errResponse('ERR_OUT_OF_SCOPE', 'Data di luar cakupan Anda')
}

function buildAccessFilter(access: ResolvedAccess, permission: string): AccessFilter {
  const permissionGrants = access.grants.filter((grant) => grant.permission === permission)
  const rowLevelScopes = permissionGrants.filter((grant) => rowLevelScopeTypes.has(grant.scopeType))
  const structuralScopes = permissionGrants.filter((grant) => !rowLevelScopeTypes.has(grant.scopeType))
  const hasStructuralScope = structuralScopes.length > 0

  return {
    permission,
    ownOnly: !hasStructuralScope && rowLevelScopes.some((grant) => grant.scopeType === 'own'),
    assignedOnly: !hasStructuralScope && rowLevelScopes.some((grant) => grant.scopeType === 'assigned'),
    rowLevelScopes,
    structuralScopes,
  }
}

export function requirePermission(code: string, targetResolver?: PermissionTargetResolver) {
  return createMiddleware<{
    Bindings: Env
    Variables: RbacVariables
  }>(async (c, next) => {
    const auth = c.get('auth')
    if (!auth) {
      return c.json(errResponse(ERR.UNAUTHENTICATED.code, ERR.UNAUTHENTICATED.message), 401)
    }

    const db = createDb(c.env.DATABASE_URL)
    let access = c.get('access')
    if (!access) {
      access = await resolveUserPermissions(db, auth.userId, auth.companyId)
      c.set('access', access)
    }

    const orgTree = await buildOrgTree(db, auth.companyId)
    const resolvedTarget = targetResolver?.(c) ?? undefined
    const target = resolvedTarget ? { ...resolvedTarget, orgTree } : undefined
    const decision = hasPermission(access, code, target)

    if (decision === 'forbidden') {
      return c.json(errResponse(ERR.FORBIDDEN.code, ERR.FORBIDDEN.message), 403)
    }

    if (decision === 'out_of_scope') {
      return c.json(outOfScopeResponse(), 404)
    }

    c.set('accessFilter', buildAccessFilter(access, code))
    await next()
  })
}
