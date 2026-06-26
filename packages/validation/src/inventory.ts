import { z } from 'zod'

const DecimalString = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, 'decimal string with max 6 fractional digits')

const NullableText = z.string().max(500).nullable().optional()

export const InventoryMovementReq = z
  .object({
    item_id: z.string().uuid(),
    outlet_id: z.string().uuid(),
    qty: DecimalString,
    unit_id: z.string().uuid(),
    reason: NullableText,
    ref_no: z.string().max(80).nullable().optional(),
  })
  .transform((value) => ({
    itemId: value.item_id,
    outletId: value.outlet_id,
    qty: value.qty,
    unitId: value.unit_id,
    reason: value.reason,
    refNo: value.ref_no,
  }))

export const InventoryOpnameReq = z
  .object({
    item_id: z.string().uuid(),
    outlet_id: z.string().uuid(),
    counted_qty: DecimalString,
    unit_id: z.string().uuid(),
    reason: NullableText,
  })
  .transform((value) => ({
    itemId: value.item_id,
    outletId: value.outlet_id,
    countedQty: value.counted_qty,
    unitId: value.unit_id,
    reason: value.reason,
  }))

export const InventoryTransferCreateReq = z
  .object({
    item_id: z.string().uuid(),
    from_outlet_id: z.string().uuid(),
    to_outlet_id: z.string().uuid(),
    qty: DecimalString,
    unit_id: z.string().uuid(),
    reason: NullableText,
    ref_no: z.string().max(80).nullable().optional(),
  })
  .transform((value) => ({
    itemId: value.item_id,
    fromOutletId: value.from_outlet_id,
    toOutletId: value.to_outlet_id,
    qty: value.qty,
    unitId: value.unit_id,
    reason: value.reason,
    refNo: value.ref_no,
  }))

export const InventoryTransferReceiveParams = z.object({
  id: z.string().uuid(),
})

export const InventoryBalanceQuery = z
  .object({
    outlet_id: z.string().uuid().optional(),
    item_id: z.string().uuid().optional(),
    category_id: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(50),
  })
  .transform((value) => ({
    outletId: value.outlet_id,
    itemId: value.item_id,
    categoryId: value.category_id,
    page: value.page,
    pageSize: value.page_size,
  }))

export const InventoryMovementQuery = z
  .object({
    outlet_id: z.string().uuid().optional(),
    item_id: z.string().uuid().optional(),
    movement_type: z.enum(['stock_in', 'stock_out', 'opname', 'waste']).optional(),
    created_from: z.coerce.date().optional(),
    created_to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(50),
  })
  .transform((value) => ({
    outletId: value.outlet_id,
    itemId: value.item_id,
    movementType: value.movement_type,
    createdFrom: value.created_from,
    createdTo: value.created_to,
    page: value.page,
    pageSize: value.page_size,
  }))

export type InventoryMovementInput = z.infer<typeof InventoryMovementReq>
export type InventoryOpnameInput = z.infer<typeof InventoryOpnameReq>
export type InventoryTransferCreateInput = z.infer<typeof InventoryTransferCreateReq>
export type InventoryTransferReceiveParamsInput = z.infer<typeof InventoryTransferReceiveParams>
export type InventoryBalanceQueryInput = z.infer<typeof InventoryBalanceQuery>
export type InventoryMovementQueryInput = z.infer<typeof InventoryMovementQuery>
