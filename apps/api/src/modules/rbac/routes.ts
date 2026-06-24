import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from '@egg-os/validation'
import {
  AssignRoleReq,
  CreateOverrideReq,
  CreateRoleReq,
  SetRolePermissionsReq,
  UpdateRoleReq,
} from '@egg-os/validation'
import { createDb } from '../../lib/db'
import { errResponse, okResponse, ERR } from '../../lib/errors'
import { authMiddleware } from '../../middleware/auth'
import type { Env } from '../../types'
import { requirePermission, type RbacVariables } from './middleware'
import {
  assignUserRole,
  createAccessOverride,
  createRole,
  deleteAccessOverride,
  deleteRole,
  getRole,
  listPermissions,
  listRoles,
  listUserRoles,
  RbacServiceError,
  revokeUserRole,
  setRolePermissions,
  updateRole,
} from './service'

const UuidParam = z.string().uuid()
const companyTarget = () => ({ scopeType: 'company' as const, scopeId: null })

const rbac = new Hono<{ Bindings: Env; Variables: RbacVariables }>()
type RbacContext = Context<{ Bindings: Env; Variables: RbacVariables }>

function formatZodErrors(err: z.ZodError) {
  return err.issues.map((issue) => ({
    field: issue.path.join('.'),
    issue: issue.message,
  }))
}

function validationResponse(c: RbacContext, err: z.ZodError) {
  return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(err)), 422)
}

function serviceErrorResponse(c: RbacContext, error: RbacServiceError) {
  return c.json(
    errResponse(error.code, error.message, error.details),
    error.status
  )
}

function parseUuid(c: RbacContext, name: string) {
  const parsed = UuidParam.safeParse(c.req.param(name))
  if (!parsed.success) return { value: null, response: validationResponse(c, parsed.error) }
  return { value: parsed.data, response: null }
}

async function parseJson(c: RbacContext) {
  return c.req.json().catch(() => null)
}

rbac.get('/roles', authMiddleware, requirePermission('rbac.role_read', companyTarget), async (c) => {
  const db = createDb(c.env.DATABASE_URL)
  const companyId = c.get('auth').companyId
  return c.json(okResponse(await listRoles(db, companyId)), 200)
})

rbac.post('/roles', authMiddleware, requirePermission('rbac.role_create', companyTarget), async (c) => {
  const body = await parseJson(c)
  const parsed = CreateRoleReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)
  const companyId = c.get('auth').companyId

  try {
    return c.json(okResponse(await createRole(db, companyId, parsed.data)), 201)
  } catch (error) {
    if (error instanceof RbacServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

rbac.get('/roles/:id', authMiddleware, requirePermission('rbac.role_read', companyTarget), async (c) => {
  const roleId = parseUuid(c, 'id')
  if (roleId.response) return roleId.response

  const db = createDb(c.env.DATABASE_URL)
  const companyId = c.get('auth').companyId

  try {
    return c.json(okResponse(await getRole(db, companyId, roleId.value!)), 200)
  } catch (error) {
    if (error instanceof RbacServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

rbac.patch('/roles/:id', authMiddleware, requirePermission('rbac.role_update', companyTarget), async (c) => {
  const roleId = parseUuid(c, 'id')
  if (roleId.response) return roleId.response

  const body = await parseJson(c)
  const parsed = UpdateRoleReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)
  const companyId = c.get('auth').companyId

  try {
    return c.json(okResponse(await updateRole(db, companyId, roleId.value!, parsed.data)), 200)
  } catch (error) {
    if (error instanceof RbacServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

rbac.delete('/roles/:id', authMiddleware, requirePermission('rbac.role_delete', companyTarget), async (c) => {
  const roleId = parseUuid(c, 'id')
  if (roleId.response) return roleId.response

  const db = createDb(c.env.DATABASE_URL)
  const companyId = c.get('auth').companyId

  try {
    return c.json(okResponse(await deleteRole(db, companyId, roleId.value!)), 200)
  } catch (error) {
    if (error instanceof RbacServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

rbac.put('/roles/:id/permissions', authMiddleware, requirePermission('rbac.role_update', companyTarget), async (c) => {
  const roleId = parseUuid(c, 'id')
  if (roleId.response) return roleId.response

  const body = await parseJson(c)
  const parsed = SetRolePermissionsReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)
  const companyId = c.get('auth').companyId

  try {
    return c.json(okResponse(await setRolePermissions(db, companyId, roleId.value!, parsed.data)), 200)
  } catch (error) {
    if (error instanceof RbacServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

rbac.get('/permissions', authMiddleware, requirePermission('rbac.permission_read', companyTarget), async (c) => {
  const db = createDb(c.env.DATABASE_URL)
  return c.json(okResponse(await listPermissions(db)), 200)
})

rbac.post('/users/:userId/roles', authMiddleware, requirePermission('rbac.role_assign', companyTarget), async (c) => {
  const userId = parseUuid(c, 'userId')
  if (userId.response) return userId.response

  const body = await parseJson(c)
  const parsed = AssignRoleReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)
  const auth = c.get('auth')

  try {
    return c.json(
      okResponse(await assignUserRole(db, auth.companyId, userId.value!, parsed.data, auth.userId)),
      201
    )
  } catch (error) {
    if (error instanceof RbacServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

rbac.get('/users/:userId/roles', authMiddleware, requirePermission('rbac.role_read', companyTarget), async (c) => {
  const userId = parseUuid(c, 'userId')
  if (userId.response) return userId.response

  const db = createDb(c.env.DATABASE_URL)
  const companyId = c.get('auth').companyId

  try {
    return c.json(okResponse(await listUserRoles(db, companyId, userId.value!)), 200)
  } catch (error) {
    if (error instanceof RbacServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

rbac.delete(
  '/users/:userId/roles/:assignmentId',
  authMiddleware,
  requirePermission('rbac.role_assign', companyTarget),
  async (c) => {
    const userId = parseUuid(c, 'userId')
    if (userId.response) return userId.response
    const assignmentId = parseUuid(c, 'assignmentId')
    if (assignmentId.response) return assignmentId.response

    const db = createDb(c.env.DATABASE_URL)
    const auth = c.get('auth')

    try {
      return c.json(
        okResponse(await revokeUserRole(db, auth.companyId, userId.value!, assignmentId.value!, auth.userId)),
        200
      )
    } catch (error) {
      if (error instanceof RbacServiceError) return serviceErrorResponse(c, error)
      throw error
    }
  }
)

rbac.post(
  '/users/:userId/overrides',
  authMiddleware,
  requirePermission('rbac.override_manage', companyTarget),
  async (c) => {
    const userId = parseUuid(c, 'userId')
    if (userId.response) return userId.response

    const body = await parseJson(c)
    const parsed = CreateOverrideReq.safeParse(body)
    if (!parsed.success) return validationResponse(c, parsed.error)

    const db = createDb(c.env.DATABASE_URL)
    const auth = c.get('auth')

    try {
      return c.json(
        okResponse(await createAccessOverride(db, auth.companyId, userId.value!, parsed.data, auth.userId)),
        201
      )
    } catch (error) {
      if (error instanceof RbacServiceError) return serviceErrorResponse(c, error)
      throw error
    }
  }
)

rbac.delete(
  '/users/:userId/overrides/:id',
  authMiddleware,
  requirePermission('rbac.override_manage', companyTarget),
  async (c) => {
    const userId = parseUuid(c, 'userId')
    if (userId.response) return userId.response
    const overrideId = parseUuid(c, 'id')
    if (overrideId.response) return overrideId.response

    const db = createDb(c.env.DATABASE_URL)
    const auth = c.get('auth')

    try {
      return c.json(
        okResponse(await deleteAccessOverride(db, auth.companyId, userId.value!, overrideId.value!, auth.userId)),
        200
      )
    } catch (error) {
      if (error instanceof RbacServiceError) return serviceErrorResponse(c, error)
      throw error
    }
  }
)

export default rbac
