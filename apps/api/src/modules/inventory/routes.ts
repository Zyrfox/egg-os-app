import { Hono, type Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  AddConversionReq,
  ApprovalParams,
  CreateCategoryReq,
  CreateItemReq,
  CreateUnitReq,
  InventoryBalanceQuery,
  InventoryMovementQuery,
  InventoryMovementReq,
  InventoryTransferCreateReq,
  InventoryTransferReceiveParams,
  ListApprovalsQuery,
  ListCategoriesQuery,
  ListItemsQuery,
  ListUnitsQuery,
  RejectApprovalReq,
  SubmitOpnameApprovalReq,
  SubmitWasteApprovalReq,
  UpdateItemReq,
  z,
} from '@egg-os/validation'
import { createDb } from '../../lib/db'
import { errResponse, okResponse, ERR } from '../../lib/errors'
import { authMiddleware } from '../../middleware/auth'
import type { Env } from '../../types'
import { requirePermission, type RbacVariables } from '../rbac/middleware'
import {
  createStockIn,
  createStockOut,
  getBalances,
  getMovements,
  InventoryServiceError,
  type InventoryServiceContext,
} from './service'
import {
  addItemUnitConversion,
  createCategory,
  createItem,
  createUnit,
  getItem,
  listCategories,
  listItems,
  listUnits,
  updateItem,
} from './master-data.service'
import { createTransfer, receiveTransfer } from './transfer.service'
import {
  finalizeApproval,
  getApproval,
  listApprovals,
  rejectApproval,
  submitApproval,
  validateApproval,
} from './approval.service'

type InventoryContext = Context<{ Bindings: Env; Variables: RbacVariables }>

const inventory = new Hono<{ Bindings: Env; Variables: RbacVariables }>()

const InventoryItemParams = z.object({
  id: z.string().uuid(),
})

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

inventory.get('/items', authMiddleware, requirePermission('inventory.read'), async (c) => {
  const parsed = ListItemsQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await listItems(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result.data, result.meta), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/items', authMiddleware, requirePermission('inventory.item_manage'), async (c) => {
  const body = await parseJson(c)
  const parsed = CreateItemReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await createItem(db, serviceCtx(c), parsed.data)), 201)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/items/:id/units', authMiddleware, requirePermission('inventory.item_manage'), async (c) => {
  const params = InventoryItemParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const body = await parseJson(c)
  const parsed = AddConversionReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await addItemUnitConversion(db, serviceCtx(c), params.data.id, parsed.data)), 201)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.get('/items/:id', authMiddleware, requirePermission('inventory.read'), async (c) => {
  const parsed = InventoryItemParams.safeParse(c.req.param())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await getItem(db, serviceCtx(c), parsed.data.id)), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.patch('/items/:id', authMiddleware, requirePermission('inventory.item_manage'), async (c) => {
  const params = InventoryItemParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const body = await parseJson(c)
  const parsed = UpdateItemReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await updateItem(db, serviceCtx(c), params.data.id, parsed.data)), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.get('/units', authMiddleware, requirePermission('inventory.read'), async (c) => {
  const parsed = ListUnitsQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await listUnits(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result.data, result.meta), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/units', authMiddleware, requirePermission('inventory.item_manage'), async (c) => {
  const body = await parseJson(c)
  const parsed = CreateUnitReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await createUnit(db, serviceCtx(c), parsed.data)), 201)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.get('/categories', authMiddleware, requirePermission('inventory.read'), async (c) => {
  const parsed = ListCategoriesQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await listCategories(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result.data, result.meta), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/categories', authMiddleware, requirePermission('inventory.item_manage'), async (c) => {
  const body = await parseJson(c)
  const parsed = CreateCategoryReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await createCategory(db, serviceCtx(c), parsed.data)), 201)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

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

inventory.post('/opname/submit', authMiddleware, requirePermission('inventory.approval_submit'), async (c) => {
  const body = await parseJson(c)
  const parsed = SubmitOpnameApprovalReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(
      okResponse(await submitApproval(db, serviceCtx(c), { movementType: 'opname', ...parsed.data })),
      201,
    )
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/waste/submit', authMiddleware, requirePermission('inventory.approval_submit'), async (c) => {
  const body = await parseJson(c)
  const parsed = SubmitWasteApprovalReq.safeParse(body)
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(
      okResponse(await submitApproval(db, serviceCtx(c), { movementType: 'waste', ...parsed.data })),
      201,
    )
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.get('/approvals', authMiddleware, requirePermission('inventory.read'), async (c) => {
  const parsed = ListApprovalsQuery.safeParse(c.req.query())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    const result = await listApprovals(db, serviceCtx(c), parsed.data)
    return c.json(okResponse(result.data, result.meta), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.get('/approvals/:id', authMiddleware, requirePermission('inventory.read'), async (c) => {
  const parsed = ApprovalParams.safeParse(c.req.param())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await getApproval(db, serviceCtx(c), parsed.data.id)), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/approvals/:id/validate', authMiddleware, requirePermission('inventory.approval_validate'), async (c) => {
  const parsed = ApprovalParams.safeParse(c.req.param())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await validateApproval(db, serviceCtx(c), parsed.data.id)), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/approvals/:id/finalize', authMiddleware, requirePermission('inventory.approval_finalize'), async (c) => {
  const parsed = ApprovalParams.safeParse(c.req.param())
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await finalizeApproval(db, serviceCtx(c), parsed.data.id)), 200)
  } catch (error) {
    if (error instanceof InventoryServiceError) return serviceErrorResponse(c, error)
    throw error
  }
})

inventory.post('/approvals/:id/reject', authMiddleware, requirePermission('inventory.approval_validate'), async (c) => {
  const params = ApprovalParams.safeParse(c.req.param())
  if (!params.success) return validationResponse(c, params.error)

  const body = await parseJson(c)
  const parsed = RejectApprovalReq.safeParse(body ?? {})
  if (!parsed.success) return validationResponse(c, parsed.error)

  const db = createDb(c.env.DATABASE_URL)

  try {
    return c.json(okResponse(await rejectApproval(db, serviceCtx(c), params.data.id, parsed.data.reason)), 200)
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
