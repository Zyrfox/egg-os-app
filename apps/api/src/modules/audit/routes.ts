import { Hono } from 'hono'
import { ListAuditLogsQuery, z } from '@egg-os/validation'
import { createDb } from '../../lib/db'
import { errResponse, okResponse, ERR } from '../../lib/errors'
import { authMiddleware } from '../../middleware/auth'
import type { Env } from '../../types'
import { requirePermission, type RbacVariables } from '../rbac/middleware'
import { listAuditLogs } from './service'

const audit = new Hono<{ Bindings: Env; Variables: RbacVariables }>()

function formatZodErrors(err: z.ZodError) {
  return err.issues.map((issue) => ({
    field: issue.path.join('.'),
    issue: issue.message,
  }))
}

// GET /audit-logs — company-wide, read-only
audit.get('/', authMiddleware, requirePermission('audit.read'), async (c) => {
  const parsed = ListAuditLogsQuery.safeParse(c.req.query())
  if (!parsed.success) {
    return c.json(
      errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)),
      422,
    )
  }

  const db = createDb(c.env.DATABASE_URL)
  const auth = c.get('auth')
  const result = await listAuditLogs(db, { companyId: auth.companyId }, parsed.data)
  return c.json(okResponse(result.data, result.meta), 200)
})

export default audit
