import { z } from 'zod'

const DecimalString = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, 'decimal string with max 6 fractional digits')

const PositiveDecimalString = DecimalString.refine((value) => Number(value) > 0, {
  message: 'must be greater than 0',
})

const NullableText = z.string().max(500).nullable().optional()

const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
})

const BooleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))

export const CreateItemReq = z
  .object({
    sku: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(150),
    category_id: z.string().uuid().nullable().optional(),
    base_unit_id: z.string().uuid(),
    pawoon_ref: z.string().trim().max(120).optional(),
  })
  .transform((value) => ({
    sku: value.sku,
    name: value.name,
    categoryId: value.category_id ?? null,
    baseUnitId: value.base_unit_id,
    pawoonRef: value.pawoon_ref ?? null,
  }))

export const UpdateItemReq = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    category_id: z.string().uuid().nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.category_id !== undefined || value.is_active !== undefined,
    { message: 'at least one field is required' },
  )
  .transform((value) => ({
    ...(value.name !== undefined ? { name: value.name } : {}),
    ...(value.category_id !== undefined ? { categoryId: value.category_id } : {}),
    ...(value.is_active !== undefined ? { isActive: value.is_active } : {}),
  }))

export const AddConversionReq = z
  .object({
    from_unit_id: z.string().uuid(),
    factor_to_base: PositiveDecimalString,
  })
  .transform((value) => ({
    fromUnitId: value.from_unit_id,
    factorToBase: value.factor_to_base,
  }))

export const CreateUnitReq = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(60),
})

export const ListUnitsQuery = PageQuery.transform((value) => ({
  page: value.page,
  pageSize: value.page_size,
}))

export const CreateCategoryReq = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
})

export const ListCategoriesQuery = PageQuery.transform((value) => ({
  page: value.page,
  pageSize: value.page_size,
}))

export const ListItemsQuery = PageQuery.extend({
  category_id: z.string().uuid().optional(),
  is_active: BooleanQuery.optional(),
}).transform((value) => ({
  page: value.page,
  pageSize: value.page_size,
  categoryId: value.category_id,
  isActive: value.is_active,
}))

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
export type CreateItemInput = z.infer<typeof CreateItemReq>
export type UpdateItemInput = z.infer<typeof UpdateItemReq>
export type AddConversionInput = z.infer<typeof AddConversionReq>
export type CreateUnitInput = z.infer<typeof CreateUnitReq>
export type ListUnitsQueryInput = z.infer<typeof ListUnitsQuery>
export type CreateCategoryInput = z.infer<typeof CreateCategoryReq>
export type ListCategoriesQueryInput = z.infer<typeof ListCategoriesQuery>
export type ListItemsQueryInput = z.infer<typeof ListItemsQuery>
