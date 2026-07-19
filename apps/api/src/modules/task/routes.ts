import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  CreateTaskReq,
  ListTasksQuery,
  RejectTaskReq,
  TaskParams,
  UpdateTaskReq,
  z,
} from '@egg-os/validation'
import { createDb } from '../../lib/db'
import { errResponse, okResponse, ERR } from '../../lib/errors'
import { authMiddleware } from '../../middleware/auth'
import type { Env } from '../../types'
import { requirePermission, type RbacVariables } from '../rbac/middleware'
import { ScopeError } from '../../lib/scope'
import {
  cancelTask,
  createTask,
  doneTask,
  getTaskById,
  listTasks,
  rejectTask,
  startTask,
  TaskServiceError,
  updateTask,
  verifyTask,
  type TaskServiceContext,
} from './service'

type TaskContext = Context<{ Bindings: Env; Variables: RbacVariables }>
type ServiceLikeError = TaskServiceError | ScopeError

function isServiceError(error: unknown): error is ServiceLikeError {
  return error instanceof TaskServiceError || error instanceof ScopeError
}

function formatZodErrors(err: z.ZodError) {
  return err.issues.map((issue) => ({ field: issue.path.join('.'), issue: issue.message }))
}

function validationResponse(c: TaskContext, err: z.ZodError) {
  return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(err)), 422)
}

function serviceErrorResponse(c: TaskContext, error: ServiceLikeError) {
  return c.json(
    errResponse(error.code, error.message, (error as TaskServiceError).details),
    error.status as ContentfulStatusCode,
  )
}

async function parseJson(c: TaskContext) {
  return c.req.json().catch(() => null)
}

function serviceCtx(c: TaskContext): TaskServiceContext {
  const auth = c.get('auth')
  return {
    companyId: auth.companyId,
    actorUserId: auth.userId,
    access: c.get('access'),
    accessFilter: c.get('accessFilter'),
  }
}

const task = new Hono<{ Bindings: Env; Variables: RbacVariables }>()

// ROUTING ORDER: /:id/verb routes SEBELUM /:id biar tidak ambiguous
// GET / dan POST / adalah root-level, tidak konflik dengan /:id

// 1. GET /tasks — list
task.get('/', authMiddleware, requirePermission('task.read'), async (c) => {
  const parsed = ListTasksQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await listTasks(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result.data, result.meta), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 2. POST /tasks — create
task.post('/', authMiddleware, requirePermission('task.create'), async (c) => {
  const body = await parseJson(c)
  const parsed = CreateTaskReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await createTask(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result), 201)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 3. POST /tasks/:id/start
task.post('/:id/start', authMiddleware, requirePermission('task.update_own'), async (c) => {
  const params = TaskParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await startTask(db, serviceCtx(c), params.data.id)
    return c.json(okResponse(result), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 4. POST /tasks/:id/done
task.post('/:id/done', authMiddleware, requirePermission('task.update_own'), async (c) => {
  const params = TaskParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await doneTask(db, serviceCtx(c), params.data.id)
    return c.json(okResponse(result), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 5. POST /tasks/:id/verify
task.post('/:id/verify', authMiddleware, requirePermission('task.verify'), async (c) => {
  const params = TaskParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await verifyTask(db, serviceCtx(c), params.data.id)
    return c.json(okResponse(result), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 6. POST /tasks/:id/reject
task.post('/:id/reject', authMiddleware, requirePermission('task.verify'), async (c) => {
  const params = TaskParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const body = await parseJson(c)
  const parsed = RejectTaskReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await rejectTask(db, serviceCtx(c), params.data.id, parsed.data.reason)
    return c.json(okResponse(result), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 7. POST /tasks/:id/cancel
task.post('/:id/cancel', authMiddleware, requirePermission('task.create'), async (c) => {
  const params = TaskParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await cancelTask(db, serviceCtx(c), params.data.id)
    return c.json(okResponse(result), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 8. PATCH /tasks/:id — edit saat open
task.patch('/:id', authMiddleware, requirePermission('task.create'), async (c) => {
  const params = TaskParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const body = await parseJson(c)
  const parsed = UpdateTaskReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await updateTask(db, serviceCtx(c), params.data.id, parsed.data)
    return c.json(okResponse(result), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 9. GET /tasks/:id — detail + evidence
task.get('/:id', authMiddleware, requirePermission('task.read'), async (c) => {
  const params = TaskParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await getTaskById(db, serviceCtx(c), params.data.id)
    return c.json(okResponse(result), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

export default task
