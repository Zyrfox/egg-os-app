import { z } from 'zod'

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format tanggal harus YYYY-MM-DD')

const DueAtInput = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?)?$/,
    'format due_at tidak valid',
  )
  .optional()
  .nullable()
  .transform((v) => {
    if (!v) return null
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+07:00` : v
    return new Date(normalized)
  })

export const CreateTaskReq = z
  .object({
    outlet_id: z.string().uuid(),
    assignee_user_id: z.string().uuid(),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    due_at: DueAtInput,
  })
  .transform((v) => ({
    outletId: v.outlet_id,
    assigneeUserId: v.assignee_user_id,
    title: v.title,
    description: v.description ?? null,
    dueAt: v.due_at ?? null,
  }))

export const UpdateTaskReq = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    due_at: DueAtInput,
  })
  .transform((v) => ({
    title: v.title,
    description: v.description,
    dueAt: v.due_at,
  }))

export const RejectTaskReq = z
  .object({
    reason: z.string().min(1).max(2000),
  })
  .transform((v) => ({ reason: v.reason }))

export const TaskParams = z.object({
  id: z.string().uuid(),
})

export const ListTasksQuery = z
  .object({
    outlet_id: z.string().uuid().optional(),
    assignee_user_id: z.string().uuid().optional(),
    status: z
      .enum(['open', 'in_progress', 'done', 'rejected', 'verified', 'cancelled'])
      .optional(),
    due_from: DateString.optional(),
    due_to: DateString.optional(),
    overdue: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(50),
  })
  .transform((v) => ({
    outletId: v.outlet_id,
    assigneeUserId: v.assignee_user_id,
    status: v.status,
    dueFrom: v.due_from,
    dueTo: v.due_to,
    overdue: v.overdue,
    page: v.page,
    pageSize: v.page_size,
  }))

export type CreateTaskInput = z.output<typeof CreateTaskReq>
export type UpdateTaskInput = z.output<typeof UpdateTaskReq>
export type RejectTaskInput = z.output<typeof RejectTaskReq>
export type TaskParamsInput = z.output<typeof TaskParams>
export type ListTasksQueryInput = z.output<typeof ListTasksQuery>
