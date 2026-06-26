import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  InventoryBalanceQuery,
  InventoryMovementQuery,
  InventoryMovementReq,
  InventoryOpnameReq,
  InventoryTransferCreateReq,
  InventoryTransferReceiveParams,
  z,
} from '@egg-os/validation'
import { createDb } from '../../lib/db'
import { errResponse, okResponse, ERR } from '../../lib/errors'
import { authMiddleware } from '../../middleware/auth'
import type { Env } from '../../types'
import { requirePermission, type RbacVariables } from '../rbac/middleware'
import {
  createOpname,
  createStockIn,
  createStockOut,
  createWaste,
  getBalances,
  getMovements,
  InventoryServiceError,
  type InventoryServiceContext,
} from './service'
import { createTransfer, receiveTransfer } from './transfer.service'

type InventoryContext = Context<{ Bindings: Env; Variables: RbacVariables }>

const inventory = new Hono<{ Bindings: Env; Variables: RbacVariables }>()

function formatZodErrors(err: z.ZodError) {
  return err.issues.map((issue) => ({
    field: issue.path.join('.'),
    issue: issue.message,
  }))
}

function validationResponse(c: InventoryContext, err: z.ZodError) {
  return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(err)), 422)
}

function serviceErrorResponse(c: InventoryContext, error: InventoryServiceError) {
  return c.json(
    errResponse(error.code, error.message, error.details),
    error.status as ContentfulStatusCode
  )
}

async function parseJson(c: InventoryContext) {
  return c.req.json().catch(() => null)
}

function serviceCtx(c: InventoryContext): InventoryServiceContext {
  const auth = c.get('auth')
  return {
    companyId: auth.companyId,
    actorUserId: auth.userId,
    access: c.get('access'),
    accessFilter: c.get('accessFilter'),
  }
}

inventory.get('/balances', authMiddleware, requirePermission('inventory.read'), async (c) => {
  const parsed = InventoryBalanceQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await getBalances(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result.data, result.meta), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.get('/movements', authMiddleware, requirePermission('inventory.read'), async (c) => {
  const parsed = InventoryMovementQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await getMovements(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result.data, result.meta), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/stock-in', authMiddleware, requirePermission('inventory.stock_in'), async (c) => {
  const body = await parseJson(c)
  const parsed = InventoryMovementReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await createStockIn(db, serviceCtx(c), parsed.data)), 201)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/stock-out', authMiddleware, requirePermission('inventory.stock_out'), async (c) => {
  const body = await parseJson(c)
  const parsed = InventoryMovementReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await createStockOut(db, serviceCtx(c), parsed.data)), 201)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/waste', authMiddleware, requirePermission('inventory.waste'), async (c) => {
  const body = await parseJson(c)
  const parsed = InventoryMovementReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await createWaste(db, serviceCtx(c), parsed.data)), 201)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/opname', authMiddleware, requirePermission('inventory.opname'), async (c) => {
  const body = await parseJson(c)
  const parsed = InventoryOpnameReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await createOpname(db, serviceCtx(c), parsed.data)), 201)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/transfers', authMiddleware, requirePermission('inventory.transfer_send'), async (c) => {
  const body = await parseJson(c)
  const parsed = InventoryTransferCreateReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await createTransfer(db, serviceCtx(c), parsed.data)), 201)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/transfers/:id/receive', authMiddleware, requirePermission('inventory.transfer_receive'), async (c) => {
  const parsed = InventoryTransferReceiveParams.safeParse(c.req.param())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await receiveTransfer(db, serviceCtx(c), parsed.data.id)), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

export default inventory
