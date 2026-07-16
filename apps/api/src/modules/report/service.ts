import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql as drizzleSql } from 'drizzle-orm'
import { dailyReports, reportChecklistAnswers, reportChecklistItems } from '@egg-os/db'
import { ERR } from '../../lib/errors'
import type { Db } from '../../lib/db'
import {
  assertOutletInScope,
  visibleOutletIdsForPermission,
  type ScopeContext,
} from '../../lib/scope'
import { auditLog } from '../../lib/audit'

export type ReportServiceContext = ScopeContext

export type ReportType = 'opening' | 'closing' | 'issue'
export type ReportStatus = 'draft' | 'submitted' | 'validated' | 'rejected'

export type ErrorDetail = { field: string; issue: string }

export class ReportServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message)
  }
}

type DailyReportRow = typeof dailyReports.$inferSelect
type ChecklistItemRow = typeof reportChecklistItems.$inferSelect
type AnswerRow = typeof reportChecklistAnswers.$inferSelect

function outOfScope() {
  return new ReportServiceError(ERR.OUT_OF_SCOPE.http, ERR.OUT_OF_SCOPE.code, ERR.OUT_OF_SCOPE.message)
}

function duplicate(message: string) {
  return new ReportServiceError(ERR.DUPLICATE.http, ERR.DUPLICATE.code, message)
}

function conflict(message: string) {
  return new ReportServiceError(ERR.CONFLICT.http, ERR.CONFLICT.code, message)
}

function validation(details: ErrorDetail[]) {
  return new ReportServiceError(ERR.VALIDATION.http, ERR.VALIDATION.code, ERR.VALIDATION.message, details)
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null
}

function reportDto(row: DailyReportRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    outlet_id: row.outletId,
    report_type: row.reportType,
    report_date: row.reportDate,
    status: row.status,
    notes: row.notes,
    submitted_by: row.submittedBy,
    submitted_at: iso(row.submittedAt),
    validated_by: row.validatedBy,
    validated_at: iso(row.validatedAt),
    rejected_by: row.rejectedBy,
    rejected_at: iso(row.rejectedAt),
    reject_reason: row.rejectReason,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

function checklistItemDto(row: ChecklistItemRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    outlet_id: row.outletId,
    report_type: row.reportType,
    label: row.label,
    display_order: row.displayOrder,
    is_active: row.isActive,
  }
}

function answerDto(row: AnswerRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    report_id: row.reportId,
    checklist_item_id: row.checklistItemId,
    is_checked: row.isChecked,
    value: row.value,
    note: row.note,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

/**
 * Resolve checklist items berlaku untuk (company, reportType, outletId):
 *  - item GLOBAL (outlet_id IS NULL) + item OUTLET-spesifik (outlet_id = outletId).
 *  - de-dup by label: OUTLET-spesifik MENANG kalau bentrok label sama.
 *  - urutkan display_order ASC, lalu created_at ASC.
 */
async function resolveChecklistForOutlet(
  db: Db,
  companyId: string,
  reportType: ReportType,
  outletId: string,
): Promise<ChecklistItemRow[]> {
  const items = await db
    .select()
    .from(reportChecklistItems)
    .where(
      and(
        eq(reportChecklistItems.companyId, companyId),
        eq(reportChecklistItems.reportType, reportType),
        eq(reportChecklistItems.isActive, true),
        isNull(reportChecklistItems.deletedAt),
        or(
          isNull(reportChecklistItems.outletId),
          eq(reportChecklistItems.outletId, outletId),
        ),
      ),
    )
    .orderBy(asc(reportChecklistItems.displayOrder), asc(reportChecklistItems.createdAt))

  // De-dup by label: outlet-specific menang. Pakai label-keyed map; tulis ulang kalau yang masuk outlet-specific.
  const byLabel = new Map<string, ChecklistItemRow>()
  for (const item of items) {
    const existing = byLabel.get(item.label)
    if (!existing) {
      byLabel.set(item.label, item)
      continue
    }
    // existing ada → kalau yang baru outlet-specific dan existing global, replace.
    if (item.outletId !== null && existing.outletId === null) {
      byLabel.set(item.label, item)
    }
    // else: existing menang (sudah outlet-specific atau dua-duanya sama tipe).
  }
  return Array.from(byLabel.values()).sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
}

async function lockReportRow(db: Db, ctx: ReportServiceContext, id: string) {
  const row = await db
    .select()
    .from(dailyReports)
    .where(
      and(
        eq(dailyReports.id, id),
        eq(dailyReports.companyId, ctx.companyId),
        isNull(dailyReports.deletedAt),
      ),
    )
    .for('update')
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) throw outOfScope()
  return row
}

// ── createDraft ─────────────────────────────────────────────────────────────

export type CreateDraftInput = {
  outletId: string
  reportType: ReportType
  reportDate: string // YYYY-MM-DD
  notes?: string | null
}

export async function createDraft(db: Db, ctx: ReportServiceContext, input: CreateDraftInput) {
  if (!['opening', 'closing', 'issue'].includes(input.reportType)) {
    throw validation([{ field: 'report_type', issue: 'harus opening, closing, atau issue' }])
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reportDate)) {
    throw validation([{ field: 'report_date', issue: 'format harus YYYY-MM-DD' }])
  }

  await assertOutletInScope(db, ctx, input.outletId, 'report.submit')

  // Cek duplikat (outlet+tipe+tanggal) yang masih hidup.
  const existing = await db
    .select({ id: dailyReports.id })
    .from(dailyReports)
    .where(
      and(
        eq(dailyReports.companyId, ctx.companyId),
        eq(dailyReports.outletId, input.outletId),
        eq(dailyReports.reportType, input.reportType),
        eq(dailyReports.reportDate, input.reportDate),
        isNull(dailyReports.deletedAt),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (existing) {
    throw duplicate('Report sudah ada untuk outlet/tipe/tanggal ini')
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const items = await resolveChecklistForOutlet(txDb, ctx.companyId, input.reportType, input.outletId)

    const [report] = await txDb
      .insert(dailyReports)
      .values({
        companyId: ctx.companyId,
        outletId: input.outletId,
        reportType: input.reportType,
        reportDate: input.reportDate,
        status: 'draft',
        notes: input.notes ?? null,
        createdBy: ctx.actorUserId,
      })
      .returning()

    let answers: AnswerRow[] = []
    if (items.length > 0) {
      answers = await txDb
        .insert(reportChecklistAnswers)
        .values(
          items.map((item) => ({
            companyId: ctx.companyId,
            reportId: report.id,
            checklistItemId: item.id,
            isChecked: false,
            value: null as string | null,
            note: null as string | null,
          })),
        )
        .returning()
    }

    await auditLog(txDb, ctx, {
      action: 'report.draft_create',
      recordType: 'daily_report',
      recordId: report.id,
      outletId: input.outletId,
      meta: { report_type: input.reportType, report_date: input.reportDate },
    })
    return {
      report: reportDto(report),
      answers: answers.map(answerDto),
    }
  })
}

// ── updateReport ────────────────────────────────────────────────────────────

export type UpdateAnswerInput = {
  checklistItemId: string
  isChecked: boolean
  value?: string | null
  note?: string | null
}

export type UpdateReportInput = {
  notes?: string | null
  answers?: UpdateAnswerInput[]
}

export async function updateReport(
  db: Db,
  ctx: ReportServiceContext,
  id: string,
  input: UpdateReportInput,
) {
  if (input.notes === undefined && (!input.answers || input.answers.length === 0)) {
    throw validation([{ field: 'body', issue: 'minimal satu field (notes atau answers)' }])
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const row = await lockReportRow(txDb, ctx, id)
    await assertOutletInScope(txDb, ctx, row.outletId, 'report.submit')

    if (row.status !== 'draft' && row.status !== 'rejected') {
      throw conflict('Report tidak bisa diedit pada status ini')
    }

    if (input.notes !== undefined) {
      await txDb
        .update(dailyReports)
        .set({ notes: input.notes ?? null, updatedAt: new Date() })
        .where(eq(dailyReports.id, id))
    }

    if (input.answers && input.answers.length > 0) {
      // Restrict ke item yang valid untuk report ini (mencegah injection answer untuk item modul/outlet lain).
      const validItemRows = await txDb
        .select({ id: reportChecklistAnswers.checklistItemId })
        .from(reportChecklistAnswers)
        .where(eq(reportChecklistAnswers.reportId, id))
      const validItemIds = new Set(validItemRows.map((r) => r.id))

      for (const ans of input.answers) {
        if (!validItemIds.has(ans.checklistItemId)) {
          throw validation([{ field: 'answers.checklist_item_id', issue: 'item tidak terdaftar untuk report ini' }])
        }
        await txDb
          .update(reportChecklistAnswers)
          .set({
            isChecked: ans.isChecked,
            value: ans.value ?? null,
            note: ans.note ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(reportChecklistAnswers.reportId, id),
              eq(reportChecklistAnswers.checklistItemId, ans.checklistItemId),
            ),
          )
      }
    }

    // Re-load report + answers manually (TIDAK panggil getReport — getReport butuh report.read scope,
    // sedangkan updateReport caller pakai report.submit scope).
    const updatedReport = await txDb
      .select()
      .from(dailyReports)
      .where(eq(dailyReports.id, id))
      .limit(1)
      .then((rows) => rows[0])
    const answers = await txDb
      .select({
        answer: reportChecklistAnswers,
        label: reportChecklistItems.label,
        displayOrder: reportChecklistItems.displayOrder,
      })
      .from(reportChecklistAnswers)
      .innerJoin(reportChecklistItems, eq(reportChecklistItems.id, reportChecklistAnswers.checklistItemId))
      .where(eq(reportChecklistAnswers.reportId, id))
      .orderBy(asc(reportChecklistItems.displayOrder), asc(reportChecklistAnswers.createdAt))

    return {
      report: reportDto(updatedReport),
      answers: answers.map((a) => ({
        ...answerDto(a.answer),
        label: a.label,
        display_order: a.displayOrder,
      })),
    }
  })
}

// ── submitReport ────────────────────────────────────────────────────────────

export async function submitReport(db: Db, ctx: ReportServiceContext, id: string) {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const row = await lockReportRow(txDb, ctx, id)
    await assertOutletInScope(txDb, ctx, row.outletId, 'report.submit')

    if (row.status !== 'draft' && row.status !== 'rejected') {
      throw conflict('Hanya report status draft atau rejected yang bisa di-submit')
    }

    const [updated] = await txDb
      .update(dailyReports)
      .set({
        status: 'submitted',
        submittedBy: ctx.actorUserId,
        submittedAt: new Date(),
        // bersihkan jejak reject sebelumnya saat revise → submit ulang
        rejectedBy: null,
        rejectedAt: null,
        rejectReason: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dailyReports.id, id),
          eq(dailyReports.companyId, ctx.companyId),
          drizzleSql`${dailyReports.status} IN ('draft', 'rejected')`,
        ),
      )
      .returning()

    if (!updated) throw conflict('Hanya report status draft atau rejected yang bisa di-submit')
    await auditLog(txDb, ctx, {
      action: 'report.submit',
      recordType: 'daily_report',
      recordId: id,
      outletId: row.outletId,
      meta: { report_type: row.reportType, report_date: row.reportDate },
    })
    return { report: reportDto(updated) }
  })
}

// ── validateReport ──────────────────────────────────────────────────────────

export async function validateReport(db: Db, ctx: ReportServiceContext, id: string) {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const row = await lockReportRow(txDb, ctx, id)
    await assertOutletInScope(txDb, ctx, row.outletId, 'report.validate')

    // NO SoD: validator boleh = submitter (spec §5/§10, beda dari approval inventory)

    if (row.status !== 'submitted') {
      throw conflict('Report bukan status submitted')
    }

    const [updated] = await txDb
      .update(dailyReports)
      .set({
        status: 'validated',
        validatedBy: ctx.actorUserId,
        validatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dailyReports.id, id),
          eq(dailyReports.companyId, ctx.companyId),
          eq(dailyReports.status, 'submitted'),
        ),
      )
      .returning()

    if (!updated) throw conflict('Report bukan status submitted')
    await auditLog(txDb, ctx, {
      action: 'report.validate',
      recordType: 'daily_report',
      recordId: id,
      outletId: row.outletId,
      meta: { report_type: row.reportType, report_date: row.reportDate },
    })
    return { report: reportDto(updated) }
  })
}

// ── rejectReport ────────────────────────────────────────────────────────────

export async function rejectReport(
  db: Db,
  ctx: ReportServiceContext,
  id: string,
  reason: string,
) {
  if (!reason || reason.trim().length === 0) {
    throw validation([{ field: 'reason', issue: 'reject reason wajib diisi' }])
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const row = await lockReportRow(txDb, ctx, id)
    await assertOutletInScope(txDb, ctx, row.outletId, 'report.validate')

    if (row.status !== 'submitted') {
      throw conflict('Report bukan status submitted')
    }

    const [updated] = await txDb
      .update(dailyReports)
      .set({
        status: 'rejected',
        rejectedBy: ctx.actorUserId,
        rejectedAt: new Date(),
        rejectReason: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dailyReports.id, id),
          eq(dailyReports.companyId, ctx.companyId),
          eq(dailyReports.status, 'submitted'),
        ),
      )
      .returning()

    if (!updated) throw conflict('Report bukan status submitted')
    await auditLog(txDb, ctx, {
      action: 'report.reject',
      recordType: 'daily_report',
      recordId: id,
      outletId: row.outletId,
      meta: { report_type: row.reportType, report_date: row.reportDate, reason },
    })
    return { report: reportDto(updated) }
  })
}

// ── listReports ─────────────────────────────────────────────────────────────

export type ListReportsQuery = {
  outletId?: string
  reportType?: ReportType
  status?: ReportStatus
  dateFrom?: string // YYYY-MM-DD
  dateTo?: string
  page?: number
  pageSize?: number
}

function pageOf(query: { page?: number }) {
  return query.page && query.page > 0 ? query.page : 1
}

function pageSizeOf(query: { pageSize?: number }) {
  return query.pageSize && query.pageSize > 0 ? query.pageSize : 50
}

export async function listReports(db: Db, ctx: ReportServiceContext, query: ListReportsQuery = {}) {
  const page = pageOf(query)
  const pageSize = pageSizeOf(query)
  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'report.read')

  if (query.outletId && !visibleOutletIds.includes(query.outletId)) {
    throw outOfScope()
  }

  if (visibleOutletIds.length === 0) {
    return { data: [], meta: { page, page_size: pageSize, total: 0 } }
  }

  const conditions = [
    eq(dailyReports.companyId, ctx.companyId),
    inArray(dailyReports.outletId, visibleOutletIds),
    isNull(dailyReports.deletedAt),
  ]
  if (query.outletId) conditions.push(eq(dailyReports.outletId, query.outletId))
  if (query.reportType) conditions.push(eq(dailyReports.reportType, query.reportType))
  if (query.status) conditions.push(eq(dailyReports.status, query.status))
  if (query.dateFrom) conditions.push(gte(dailyReports.reportDate, query.dateFrom))
  if (query.dateTo) conditions.push(lte(dailyReports.reportDate, query.dateTo))

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(dailyReports)
      .where(and(...conditions))
      .orderBy(desc(dailyReports.reportDate), desc(dailyReports.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(dailyReports)
      .where(and(...conditions)),
  ])

  return {
    data: rows.map(reportDto),
    meta: { page, page_size: pageSize, total: countRows[0]?.count ?? 0 },
  }
}

// ── getReport ───────────────────────────────────────────────────────────────

export async function getReport(db: Db, ctx: ReportServiceContext, id: string) {
  const row = await db
    .select()
    .from(dailyReports)
    .where(
      and(
        eq(dailyReports.id, id),
        eq(dailyReports.companyId, ctx.companyId),
        isNull(dailyReports.deletedAt),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!row) throw outOfScope()

  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'report.read')
  if (!visibleOutletIds.includes(row.outletId)) throw outOfScope()

  const answers = await db
    .select({
      answer: reportChecklistAnswers,
      label: reportChecklistItems.label,
      displayOrder: reportChecklistItems.displayOrder,
    })
    .from(reportChecklistAnswers)
    .innerJoin(
      reportChecklistItems,
      eq(reportChecklistItems.id, reportChecklistAnswers.checklistItemId),
    )
    .where(eq(reportChecklistAnswers.reportId, id))
    .orderBy(asc(reportChecklistItems.displayOrder), asc(reportChecklistAnswers.createdAt))

  return {
    report: reportDto(row),
    answers: answers.map((a) => ({
      ...answerDto(a.answer),
      label: a.label,
      display_order: a.displayOrder,
    })),
  }
}

// ── listChecklistItems ──────────────────────────────────────────────────────

export type ListChecklistItemsQuery = {
  reportType?: ReportType
  outletId?: string
}

export async function listChecklistItems(
  db: Db,
  ctx: ReportServiceContext,
  query: ListChecklistItemsQuery = {},
) {
  // outletId opsional: kalau dikasih, validate scope; kalau null/undefined, list semua item visible (yang outlet-spesifik dibatasi visibleOutletIds).
  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'report.read')

  if (query.outletId && !visibleOutletIds.includes(query.outletId)) {
    throw outOfScope()
  }

  const conditions = [
    eq(reportChecklistItems.companyId, ctx.companyId),
    eq(reportChecklistItems.isActive, true),
    isNull(reportChecklistItems.deletedAt),
  ]
  if (query.reportType) conditions.push(eq(reportChecklistItems.reportType, query.reportType))

  if (query.outletId) {
    // Spesifik outlet: global (null) + outlet itu.
    conditions.push(
      or(
        isNull(reportChecklistItems.outletId),
        eq(reportChecklistItems.outletId, query.outletId),
      )!,
    )
  } else if (visibleOutletIds.length > 0) {
    // Tanpa filter outlet: global (null) + outlet-spesifik dari visible scope.
    conditions.push(
      or(
        isNull(reportChecklistItems.outletId),
        inArray(reportChecklistItems.outletId, visibleOutletIds),
      )!,
    )
  } else {
    // Tidak punya outlet visible & tidak filter outlet → hanya item global.
    conditions.push(isNull(reportChecklistItems.outletId))
  }

  const rows = await db
    .select()
    .from(reportChecklistItems)
    .where(and(...conditions))
    .orderBy(asc(reportChecklistItems.reportType), asc(reportChecklistItems.displayOrder))

  return { data: rows.map(checklistItemDto) }
}

// ── complianceKpi ───────────────────────────────────────────────────────────

export type ComplianceKpiQuery = {
  outletId?: string
  month: string // YYYY-MM
}

function monthRange(month: string): { startDate: string; nextMonthStart: string; calendarDays: number } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw validation([{ field: 'month', issue: 'format harus YYYY-MM' }])
  }
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthNum = Number(monthStr) // 1-12
  if (monthNum < 1 || monthNum > 12) {
    throw validation([{ field: 'month', issue: 'bulan harus antara 01 dan 12' }])
  }
  const startDate = `${month}-01`
  const nextYear = monthNum === 12 ? year + 1 : year
  const nextMonth = monthNum === 12 ? 1 : monthNum + 1
  const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
  // calendarDays via Date(year, month, 0): month 1-indexed → day 0 dari bulan BERIKUTNYA = hari terakhir bulan ini.
  const calendarDays = new Date(year, monthNum, 0).getDate()
  return { startDate, nextMonthStart, calendarDays }
}

// BATASAN: penyebut = hari kalender penuh (28-31). Valid untuk BULAN LENGKAP (tarik di akhir bulan).
// Kalau ditarik mid-bulan, hari yang belum terjadi ikut jadi penyebut → compliance terlihat rendah palsu.
// Enhancement (penyebut = hari operasi / min hari-ini) ditunda ke modul Komersial. Lihat spec §5.
export async function complianceKpi(db: Db, ctx: ReportServiceContext, query: ComplianceKpiQuery) {
  const { startDate, nextMonthStart, calendarDays } = monthRange(query.month)
  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'report.read')

  if (query.outletId && !visibleOutletIds.includes(query.outletId)) {
    throw outOfScope()
  }

  const targetOutletIds = query.outletId ? [query.outletId] : visibleOutletIds
  if (targetOutletIds.length === 0) {
    return { data: [], meta: { month: query.month, calendar_days: calendarDays } }
  }

  // KETAT: hari "compliant" = punya BOTH opening 'validated' AND closing 'validated' di tanggal itu.
  // Fetch validated opening/closing dalam range bulan via query builder, aggregate di TS — data volume bounded.
  const rows = await db
    .select({
      outletId: dailyReports.outletId,
      reportDate: dailyReports.reportDate,
      reportType: dailyReports.reportType,
    })
    .from(dailyReports)
    .where(
      and(
        eq(dailyReports.companyId, ctx.companyId),
        inArray(dailyReports.outletId, targetOutletIds),
        gte(dailyReports.reportDate, startDate),
        lt(dailyReports.reportDate, nextMonthStart),
        eq(dailyReports.status, 'validated'),
        isNull(dailyReports.deletedAt),
        inArray(dailyReports.reportType, ['opening', 'closing']),
      ),
    )

  // Group by (outlet, date) → cek both opening+closing ada.
  const typesPerDay = new Map<string, Set<string>>()
  for (const r of rows) {
    const key = `${r.outletId}|${r.reportDate}`
    if (!typesPerDay.has(key)) typesPerDay.set(key, new Set())
    typesPerDay.get(key)!.add(r.reportType)
  }
  const compliantDaysPerOutlet = new Map<string, number>()
  for (const [key, types] of typesPerDay) {
    if (types.has('opening') && types.has('closing')) {
      const [outletId] = key.split('|')
      compliantDaysPerOutlet.set(outletId, (compliantDaysPerOutlet.get(outletId) ?? 0) + 1)
    }
  }

  const data = targetOutletIds.map((outletId) => {
    const compliantDays = compliantDaysPerOutlet.get(outletId) ?? 0
    const compliancePct = calendarDays > 0 ? Math.round((compliantDays / calendarDays) * 10000) / 100 : 0
    return {
      outlet_id: outletId,
      compliant_days: compliantDays,
      calendar_days: calendarDays,
      compliance_pct: compliancePct,
    }
  })

  return { data, meta: { month: query.month, calendar_days: calendarDays } }
}
