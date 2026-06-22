import { z } from 'zod'

export function formatZodErrors(err: z.ZodError) {
  return err.issues.map((issue) => ({
    field: issue.path.join('.'),
    issue: issue.message,
  }))
}

export const CompanyQuery = z.object({})

export const BrandQuery = z.object({})

export const OutletQuery = z.object({
  brand_id: z.string().uuid().optional(),
})

export const DepartmentQuery = z.object({
  brand_id: z.string().uuid().optional(),
  outlet_id: z.string().uuid().optional(),
})

export type BrandQueryInput = z.infer<typeof BrandQuery>
export type OutletQueryInput = z.infer<typeof OutletQuery>
export type DepartmentQueryInput = z.infer<typeof DepartmentQuery>

