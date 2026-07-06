import { z } from 'zod'

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format tanggal harus YYYY-MM-DD')
const MonthString = z.string().regex(/^\d{4}-\d{2}$/, 'format bulan harus YYYY-MM')
const ReportType = z.enum(['opening', 'closing', 'issue'])
const ReportStatus = z.enum(['draft', 'submitted', 'validated', 'rejected'])

export const CreateReportReq = z
  .object({
    outlet_id: z.string().uuid(),
    report_type: ReportType,
    report_date: DateString,
    notes: z.string().max(2000).nullable().optional(),
  })
  .transform((value) => ({
    outletId: value.outlet_id,
    reportType: value.report_type,
    reportDate: value.report_date,
    notes: value.notes ?? null,
  }))

const UpdateAnswerItem = z.object({
  checklist_item_id: z.string().uuid(),
  is_checked: z.boolean(),
  value: z.string().max(500).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
})

export const UpdateReportReq = z
  .object({
    notes: z.string().max(2000).nullable().optional(),
    answers: z.array(UpdateAnswerItem).optional(),
  })
  .refine((v) => v.notes !== undefined || (v.answers && v.answers.length > 0), {
    message: 'minimal satu field (notes atau answers)',
  })
  .transform((value) => ({
    notes: value.notes,
    answers: value.answers?.map((a) => ({
      checklistItemId: a.checklist_item_id,
      isChecked: a.is_checked,
      value: a.value ?? null,
      note: a.note ?? null,
    })),
  }))

export const RejectReportReq = z
  .object({
    reason: z.string().min(1).max(1000),
  })
  .transform((value) => ({ reason: value.reason }))

export const ReportParams = z.object({
  id: z.string().uuid(),
})

export const ListReportsQuery = z
  .object({
    outlet_id: z.string().uuid().optional(),
    report_type: ReportType.optional(),
    status: ReportStatus.optional(),
    date_from: DateString.optional(),
    date_to: DateString.optional(),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(50),
  })
  .transform((value) => ({
    outletId: value.outlet_id,
    reportType: value.report_type,
    status: value.status,
    dateFrom: value.date_from,
    dateTo: value.date_to,
    page: value.page,
    pageSize: value.page_size,
  }))

export const ChecklistItemsQuery = z
  .object({
    report_type: ReportType.optional(),
    outlet_id: z.string().uuid().optional(),
  })
  .transform((value) => ({
    reportType: value.report_type,
    outletId: value.outlet_id,
  }))

export const ComplianceQuery = z
  .object({
    outlet_id: z.string().uuid().optional(),
    month: MonthString,
  })
  .transform((value) => ({
    outletId: value.outlet_id,
    month: value.month,
  }))

export type CreateReportInput = z.infer<typeof CreateReportReq>
export type UpdateReportInput = z.infer<typeof UpdateReportReq>
export type RejectReportInput = z.infer<typeof RejectReportReq>
export type ReportParamsInput = z.infer<typeof ReportParams>
export type ListReportsQueryInput = z.infer<typeof ListReportsQuery>
export type ChecklistItemsQueryInput = z.infer<typeof ChecklistItemsQuery>
export type ComplianceQueryInput = z.infer<typeof ComplianceQuery>
