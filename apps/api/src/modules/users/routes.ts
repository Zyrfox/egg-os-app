import { Hono, type Context } from 'hono'
import {
  AssignUserRoleReq,
  InviteUserReq,
  ListUsersQuery,
  UpdateUserReq,
  z,
} from '@egg-os/validation'
import { createDb } from '../../lib/db'
import { errResponse, okResponse, ERR } from '../../lib/errors'
import { authMiddleware } from '../../middleware/auth'
import type { Env } from '../../types'
import { requirePermission, type RbacVariables } from '../rbac/middleware'
import {
  archiveUser,
  assignRoleToUser,
  getUserDetail,
  inviteUser,
  listUsers,
  reactivateUser,
  resetPasswordForUser,
  revokeRoleFromUser,
  suspendUser,
  updateUser,
  UsersServiceError,
  type UsersServiceContext,
} from './service'

type UsersContext = Context<{ Bindings: Env; Variables: RbacVariables }>

const UuidParam = z.string().uuid()

const usersRouter = new Hono<{ Bindings: Env; Variables: RbacVariables }>()

function formatZodErrors(err: z.ZodError) {
  return err.issues.map((issue) => ({
    field: issue.path.join('.'),
    issue: issue.message,
  }))
}

function validationResponse(c: UsersContext, err: z.ZodError) {
  return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(err)), 422)
}

function serviceErrorResponse(c: UsersContext, error: UsersServiceError) {
  return c.json(
    errResponse(error.code, error.message, error.details),
    error.status
  )
}

function parseUuid(c: UsersContext, name: string) {
  const parsed = UuidParam.safeParse(c.req.param(name))
  if (!parsed.success) return { value: null, response: validationResponse(c, parsed.error) }
  return { value: parsed.data, response: null }
}

async function parseJson(c: UsersContext) {
  return c.req.json().catch(() => null)
}

function serviceCtx(c: UsersContext): UsersServiceContext {
  const auth = c.get('auth')
  return {
    companyId: auth.companyId,
    actorUserId: auth.userId,
    access: c.get('access'),
    accessFilter: c.get('accessFilter'),
  }
}

usersRouter.get('/', authMiddleware, requirePermission('users.read'), async (c) => {
  const parsed = ListUsersQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)
  const result = await listUsers(db, serviceCtx(c), parsed.data)
  return c.json(okResponse(result.data, result.meta), 200)
})

usersRouter.get('/:id', authMiddleware, requirePermission('users.read'), async (c) => {
  const userId = parseUuid(c, 'id')
  if (userId.response) return userId.response

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await getUserDetail(db, serviceCtx(c), userId.value!)), 200)
  } catch (error) {
    if (error instanceof UsersServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

usersRouter.post('/', authMiddleware, requirePermission('users.create'), async (c) => {
  const body = await parseJson(c)
  const parsed = InviteUserReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await inviteUser(db, serviceCtx(c), parsed.data)), 201)
  } catch (error) {
    if (error instanceof UsersServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

usersRouter.patch('/:id', authMiddleware, requirePermission('users.update'), async (c) => {
  const userId = parseUuid(c, 'id')
  if (userId.response) return userId.response

  const body = await parseJson(c)
  const parsed = UpdateUserReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await updateUser(db, serviceCtx(c), userId.value!, parsed.data)), 200)
  } catch (error) {
    if (error instanceof UsersServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

usersRouter.post('/:id/suspend', authMiddleware, requirePermission('users.suspend'), async (c) => {
  const userId = parseUuid(c, 'id')
  if (userId.response) return userId.response

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await suspendUser(db, serviceCtx(c), userId.value!)), 200)
  } catch (error) {
    if (error instanceof UsersServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

usersRouter.post('/:id/reactivate', authMiddleware, requirePermission('users.update'), async (c) => {
  const userId = parseUuid(c, 'id')
  if (userId.response) return userId.response

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await reactivateUser(db, serviceCtx(c), userId.value!)), 200)
  } catch (error) {
    if (error instanceof UsersServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

usersRouter.post('/:id/archive', authMiddleware, requirePermission('users.archive'), async (c) => {
  const userId = parseUuid(c, 'id')
  if (userId.response) return userId.response

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await archiveUser(db, serviceCtx(c), userId.value!)), 200)
  } catch (error) {
    if (error instanceof UsersServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

usersRouter.post('/:id/roles', authMiddleware, requirePermission('rbac.role_assign'), async (c) => {
  const userId = parseUuid(c, 'id')
  if (userId.response) return userId.response

  const body = await parseJson(c)
  const parsed = AssignUserRoleReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await assignRoleToUser(db, serviceCtx(c), userId.value!, parsed.data)), 201)
  } catch (error) {
    if (error instanceof UsersServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

usersRouter.delete('/:id/roles/:assignmentId', authMiddleware, requirePermission('rbac.role_assign'), async (c) => {
  const userId = parseUuid(c, 'id')
  if (userId.response) return userId.response
  const assignmentId = parseUuid(c, 'assignmentId')
  if (assignmentId.response) return assignmentId.response

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await revokeRoleFromUser(db, serviceCtx(c), userId.value!, assignmentId.value!)), 200)
  } catch (error) {
    if (error instanceof UsersServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

usersRouter.post('/:id/reset-password', authMiddleware, requirePermission('users.update'), async (c) => {
  const userId = parseUuid(c, 'id')
  if (userId.response) return userId.response

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await resetPasswordForUser(db, serviceCtx(c), userId.value!)), 200)
  } catch (error) {
    if (error instanceof UsersServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

export default usersRouter
