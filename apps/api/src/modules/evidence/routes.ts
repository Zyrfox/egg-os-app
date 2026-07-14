import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { EvidenceParams, ListEvidenceQuery, RequestUploadReq, z } from '@egg-os/validation'
import { createDb } from '../../lib/db'
import { errResponse, okResponse, ERR } from '../../lib/errors'
import { authMiddleware } from '../../middleware/auth'
import type { Env } from '../../types'
import { requirePermission, type RbacVariables } from '../rbac/middleware'
import { InventoryServiceError } from '../inventory/service'
import {
  confirmUpload,
  createR2Presigner,
  deleteEvidence,
  EvidenceServiceError,
  getViewUrl,
  listEvidence,
  requestUpload,
  type EvidenceDeps,
  type EvidenceServiceContext,
} from './service'

type ServiceLikeError = EvidenceServiceError | InventoryServiceError

function isServiceError(error: unknown): error is ServiceLikeError {
  return error instanceof EvidenceServiceError || error instanceof InventoryServiceError
}

type EvidenceCtx = Context<{ Bindings: Env; Variables: RbacVariables }>

function formatZodErrors(err: z.ZodError) {
  return err.issues.map((issue) => ({ field: issue.path.join('.'), issue: issue.message }))
}

function validationResponse(c: EvidenceCtx, err: z.ZodError) {
  return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(err)), 422)
}

function serviceErrorResponse(c: EvidenceCtx, error: ServiceLikeError) {
  return c.json(
    errResponse(error.code, error.message, error.details),
    error.status as ContentfulStatusCode,
  )
}

async function parseJson(c: EvidenceCtx) {
  return c.req.json().catch(() => null)
}

function serviceCtx(c: EvidenceCtx): EvidenceServiceContext {
  const auth = c.get('auth')
  return {
    companyId: auth.companyId,
    actorUserId: auth.userId,
    accessFilter: c.get('accessFilter'),
  }
}

function makeDeps(env: Env): EvidenceDeps {
  const r2 = env.EVIDENCE_BUCKET
  return {
    presigner: createR2Presigner(env),
    bucket: {
      async head(key) {
        const obj = await r2.head(key)
        return obj ? { size: obj.size } : null
      },
      async delete(key) {
        return r2.delete(key)
      },
    },
  }
}

const evidence = new Hono<{ Bindings: Env; Variables: RbacVariables }>()

// ROUTING ORDER: /request-upload (statik) SEBELUM /:id/* (param) agar tidak ke-shadow.

// 1. POST /evidence/request-upload — step 1 upload flow (statik)
evidence.post('/request-upload', authMiddleware, requirePermission('evidence.upload'), async (c) => {
  const body = await parseJson(c)
  const parsed = RequestUploadReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await requestUpload(db, makeDeps(c.env), serviceCtx(c), parsed.data)
    return c.json(okResponse(result), 201)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 2. POST /evidence/:id/confirm — step 3 upload flow (confirm setelah client PUT ke R2)
evidence.post('/:id/confirm', authMiddleware, requirePermission('evidence.upload'), async (c) => {
  const params = EvidenceParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await confirmUpload(db, makeDeps(c.env), serviceCtx(c), params.data.id)
    return c.json(okResponse(result), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 3. GET /evidence — list per record (query: record_type + record_id)
evidence.get('/', authMiddleware, requirePermission('evidence.read'), async (c) => {
  const parsed = ListEvidenceQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await listEvidence(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result.data), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 4. GET /evidence/:id/view-url — presigned GET URL untuk lihat file
evidence.get('/:id/view-url', authMiddleware, requirePermission('evidence.read'), async (c) => {
  const params = EvidenceParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await getViewUrl(db, makeDeps(c.env), serviceCtx(c), params.data.id)
    return c.json(okResponse(result), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

// 5. DELETE /evidence/:id — soft-delete (hanya kalau record induk belum final)
evidence.delete('/:id', authMiddleware, requirePermission('evidence.upload'), async (c) => {
  const params = EvidenceParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await deleteEvidence(db, makeDeps(c.env), serviceCtx(c), params.data.id)
    return c.json(okResponse(result), 200)
  } catch (error) {
    if (isServiceError(error)) return serviceErrorResponse(c, error)
    throw error
  }
})

export default evidence
