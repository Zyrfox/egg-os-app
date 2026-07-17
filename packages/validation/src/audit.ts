import { z } from 'zod'

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format tanggal harus YYYY-MM-DD')

export const ListAuditLogsQuery = z
  .object({
    actor_user_id: z.string().uuid().optional(),
    action: z.string().min(1).max(100).optional(),
    record_type: z.string().min(1).max(40).optional(),
    record_id: z.string().uuid().optional(),
    date_from: DateString.optional(),
    date_to: DateString.optional(),
    outlet_id: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
  })
  .transform((value) => ({
    actorUserId: value.actor_user_id,
    action: value.action,
    recordType: value.record_type,
    recordId: value.record_id,
    dateFrom: value.date_from,
    dateTo: value.date_to,
    outletId: value.outlet_id,
    page: value.page,
    pageSize: value.page_size,
  }))
