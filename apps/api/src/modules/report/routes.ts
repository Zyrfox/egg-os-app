import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  ChecklistItemsQuery,
  ComplianceQuery,
  CreateReportReq,
  ListReportsQuery,
  RejectReportReq,
  ReportParams,
  UpdateReportReq,
  z,
} from '@egg-os/validation'
import { createDb } from '../../lib/db'
import { errResponse, okResponse, ERR } from '../../lib/errors'
import { authMiddleware } from '../../middleware/auth'
import type { Env } from '../../types'
import { requirePermission, type RbacVariables } from '../rbac/middleware'
import { ScopeError } from '../../lib/scope'
import {
  complianceKpi,
  createDraft,
  getReport,
  listChecklistItems,
  listReports,
  rejectReport,
  ReportServiceError,
  submitReport,
  updateReport,
  validateReport,
  type ReportServiceContext,
} from './service'

type ServiceLikeError = ReportServiceError | ScopeError

function isServiceError(error: unknown): error is ServiceLikeError {
  return error instanceof ReportServiceError || error instanceof ScopeError
}

type ReportContext = Context<{ Bindings: Env; Variables: RbacVariables }>

const report = new Hono<{ Bindings: Env; Variables: RbacVariables }>()

function formatZodErrors(err: z.ZodError) {
  return err.issues.map((issue) => ({
    field: issue.path.join('.'),
    issue: issue.message,
  }))
}

function validationResponse(c: ReportContext, err: z.ZodError) {
  return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(err)), 422)
}

function serviceErrorResponse(c: ReportContext, error: ServiceLikeError) {
  return c.json(
    errResponse(error.code, error.message, error.details),
    error.status as ContentfulStatusCode,
  )
}

async function parseJson(c: ReportContext) {
  return c.req.json().catch(() => null)
}

function serviceCtx(c: ReportContext): ReportServiceContext {
  const auth = c.get('auth')
  return {
    companyId: auth.companyId,
    actorUserId: auth.userId,
    access: c.get('access'),
    accessFilter: c.get('accessFilter'),
  }
}

// ROUTING ORDER: route statik (/checklist-items, /kpi/compliance, /draft) HARUS di atas /:id,
// biar tidak ke-shadow sebagai id="checklist-items" dll.

// 1. GET /reports/checklist-items — statik, di atas /:id
report.get('/checklist-items', authMiddleware, requirePermission('report.read'), async (c) => {
  const parsed = ChecklistItemsQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await listChecklistItems(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result.data), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 9. GET /reports/kpi/compliance — statik path (/kpi/compliance), di atas /:id
report.get('/kpi/compliance', authMiddleware, requirePermission('report.read'), async (c) => {
  const parsed = ComplianceQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await complianceKpi(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result.data, result.meta), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 2. POST /reports/draft — statik, di atas /:id
report.post('/draft', authMiddleware, requirePermission('report.submit'), async (c) => {
  const body = await parseJson(c)
  const parsed = CreateReportReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await createDraft(db, serviceCtx(c), parsed.data)), 201)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 3. GET /reports — list
report.get('/', authMiddleware, requirePermission('report.read'), async (c) => {
  const parsed = ListReportsQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await listReports(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result.data, result.meta), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 6. POST /reports/:id/submit — param+verb
report.post('/:id/submit', authMiddleware, requirePermission('report.submit'), async (c) => {
  const params = ReportParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await submitReport(db, serviceCtx(c), params.data.id)), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 7. POST /reports/:id/validate — param+verb
report.post('/:id/validate', authMiddleware, requirePermission('report.validate'), async (c) => {
  const params = ReportParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await validateReport(db, serviceCtx(c), params.data.id)), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 8. POST /reports/:id/reject — param+verb
report.post('/:id/reject', authMiddleware, requirePermission('report.validate'), async (c) => {
  const params = ReportParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const body = await parseJson(c)
  const parsed = RejectReportReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await rejectReport(db, serviceCtx(c), params.data.id, parsed.data.reason)), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 5. PATCH /reports/:id — param, di bawah semua verb+param
report.patch('/:id', authMiddleware, requirePermission('report.submit'), async (c) => {
  const params = ReportParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const body = await parseJson(c)
  const parsed = UpdateReportReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await updateReport(db, serviceCtx(c), params.data.id, parsed.data)), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 4. GET /reports/:id — param, di bawah semua statik
report.get('/:id', authMiddleware, requirePermission('report.read'), async (c) => {
  const parsed = ReportParams.safeParse(c.req.param())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await getReport(db, serviceCtx(c), parsed.data.id)), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

export default report
