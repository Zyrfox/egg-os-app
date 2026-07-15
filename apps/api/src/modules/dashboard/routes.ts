import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { DashboardDateMonthQuery, DashboardDateQuery, z } from '@egg-os/validation'
import { createDb } from '../../lib/db'
import { errResponse, okResponse, ERR } from '../../lib/errors'
import { authMiddleware } from '../../middleware/auth'
import type { Env } from '../../types'
import { requirePermission, type RbacVariables } from '../rbac/middleware'
import { ScopeError } from '../../lib/scope'
import {
  approvalQueue,
  executiveDashboard,
  inventoryDashboard,
  spvDashboard,
  type DashboardServiceContext,
} from './service'

type DashboardError = ScopeError

function isDashboardError(error: unknown): error is DashboardError {
  return error instanceof ScopeError
}

type DashCtx = Context<{ Bindings: Env; Variables: RbacVariables }>

const dashboard = new Hono<{ Bindings: Env; Variables: RbacVariables }>()

function formatZodErrors(err: z.ZodError) {
  return err.issues.map((issue) => ({ field: issue.path.join('.'), issue: issue.message }))
}

function validationResponse(c: DashCtx, err: z.ZodError) {
  return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(err)), 422)
}

function serviceErrorResponse(c: DashCtx, error: DashboardError) {
  return c.json(
    errResponse(error.code, error.message, error.details),
    error.status as ContentfulStatusCode,
  )
}

function serviceCtx(c: DashCtx): DashboardServiceContext {
  const auth = c.get('auth')
  return {
    companyId: auth.companyId,
    actorUserId: auth.userId,
    access: c.get('access'),
    accessFilter: c.get('accessFilter'),
  }
}

// `now` is NEVER passed from HTTP layer — production always uses real clock.

dashboard.get('/executive', authMiddleware, requirePermission('dashboard.executive'), async (c) => {
  const parsed = DashboardDateMonthQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)
  const db = createDb(c.env.DATABASE_URL)
  try {
    return c.json(okResponse(await executiveDashboard(db, serviceCtx(c), parsed.data)), 200)
  } catch (error) {
    if (isDashboardError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

dashboard.get('/spv', authMiddleware, requirePermission('dashboard.spv'), async (c) => {
  const parsed = DashboardDateQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)
  const db = createDb(c.env.DATABASE_URL)
  try {
    return c.json(okResponse(await spvDashboard(db, serviceCtx(c), parsed.data)), 200)
  } catch (error) {
    if (isDashboardError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

dashboard.get('/inventory', authMiddleware, requirePermission('dashboard.inventory'), async (c) => {
  const parsed = DashboardDateMonthQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)
  const db = createDb(c.env.DATABASE_URL)
  try {
    return c.json(okResponse(await inventoryDashboard(db, serviceCtx(c), parsed.data)), 200)
  } catch (error) {
    if (isDashboardError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

dashboard.get('/approval-queue', authMiddleware, requirePermission('dashboard.approval_queue'), async (c) => {
  const db = createDb(c.env.DATABASE_URL)
  try {
    const result = await approvalQueue(db, serviceCtx(c))
    return c.json(okResponse({
      stock_movements: { to_validate: result.to_validate, to_finalize: result.to_finalize },
      reports_to_validate: result.reports_to_validate,
    }), 200)
  } catch (error) {
    if (isDashboardError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

export default dashboard
