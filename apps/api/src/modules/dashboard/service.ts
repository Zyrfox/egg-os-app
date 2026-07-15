import { and, desc, eq, gte, inArray, isNull, lt, sql as drizzleSql } from 'drizzle-orm'
import {
  dailyReports,
  evidence,
  items,
  outlets,
  pendingStockMovements,
  reportChecklistAnswers,
  stockBalances,
  stockMovements,
  users,
} from '@egg-os/db'
import type { Db } from '../../lib/db'
import { type ScopeContext, visibleOutletIdsForPermission } from '../../lib/scope'
import { monthRangeWIB, todayWIB } from '../../lib/date'

export type DashboardServiceContext = ScopeContext

// ── executiveDashboard ────────────────────────────────────────────────────

export async function executiveDashboard(
  db: Db,
  ctx: DashboardServiceContext,
  query: { date?: string; month?: string },
  now?: () => Date,
) {
  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'dashboard.executive')
  if (visibleOutletIds.length === 0) {
    return { outlet_status: [], report_compliance: [], approval_pending: [], stock_discrepancy: [] }
  }

  const date = query.date ?? todayWIB(now)
  const month = query.month ?? date.slice(0, 7)
  const { startDate, nextMonthStart, calendarDays, elapsedDays } = monthRangeWIB(month, now)

  // outlet_status: all visible outlets × {opening,closing} for `date`
  const allOutlets = await db
    .select({ id: outlets.id, name: outlets.outletName })
    .from(outlets)
    .where(and(inArray(outlets.id, visibleOutletIds), isNull(outlets.deletedAt)))

  const reportsForDate = await db
    .select({ outletId: dailyReports.outletId, reportType: dailyReports.reportType, status: dailyReports.status })
    .from(dailyReports)
    .where(and(
      eq(dailyReports.companyId, ctx.companyId),
      inArray(dailyReports.outletId, visibleOutletIds),
      eq(dailyReports.reportDate, date),
      inArray(dailyReports.reportType, ['opening', 'closing']),
      isNull(dailyReports.deletedAt),
    ))

  const rMap = new Map<string, { opening?: string; closing?: string }>()
  for (const r of reportsForDate) {
    const e = rMap.get(r.outletId) ?? {}
    if (r.reportType === 'opening') e.opening = r.status
    else e.closing = r.status
    rMap.set(r.outletId, e)
  }

  const outlet_status = allOutlets.map((o) => {
    const r = rMap.get(o.id) ?? {}
    return { outlet_id: o.id, outlet_name: o.name, opening_status: r.opening ?? 'missing', closing_status: r.closing ?? 'missing' }
  })

  // report_compliance: validated opening+closing per outlet in month
  const validatedRows = await db
    .select({ outletId: dailyReports.outletId, reportDate: dailyReports.reportDate, reportType: dailyReports.reportType })
    .from(dailyReports)
    .where(and(
      eq(dailyReports.companyId, ctx.companyId),
      inArray(dailyReports.outletId, visibleOutletIds),
      eq(dailyReports.status, 'validated'),
      inArray(dailyReports.reportType, ['opening', 'closing']),
      gte(dailyReports.reportDate, startDate),
      lt(dailyReports.reportDate, nextMonthStart),
      isNull(dailyReports.deletedAt),
    ))

  // outletId → date → set of reportTypes
  const compMap = new Map<string, Map<string, Set<string>>>()
  for (const r of validatedRows) {
    if (!compMap.has(r.outletId)) compMap.set(r.outletId, new Map())
    const dm = compMap.get(r.outletId)!
    if (!dm.has(r.reportDate)) dm.set(r.reportDate, new Set())
    dm.get(r.reportDate)!.add(r.reportType)
  }

  const report_compliance = allOutlets.map((o) => {
    const dm = compMap.get(o.id)
    let compliant_days = 0
    if (dm) for (const types of dm.values()) if (types.has('opening') && types.has('closing')) compliant_days++
    return {
      outlet_id: o.id,
      compliant_days,
      elapsed_days: elapsedDays,
      calendar_days: calendarDays,
      compliance_to_date_pct: elapsedDays > 0 ? parseFloat((compliant_days / elapsedDays * 100).toFixed(2)) : null,
    }
  })

  // approval_pending: pending_stock_movements grouped by outlet
  const pendingRows = await db
    .select({ outletId: pendingStockMovements.outletId, status: pendingStockMovements.status })
    .from(pendingStockMovements)
    .where(and(
      eq(pendingStockMovements.companyId, ctx.companyId),
      inArray(pendingStockMovements.outletId, visibleOutletIds),
      inArray(pendingStockMovements.status, ['pending', 'validated']),
    ))

  const apMap = new Map<string, { submitted_count: number; validated_count: number }>()
  for (const r of pendingRows) {
    const e = apMap.get(r.outletId) ?? { submitted_count: 0, validated_count: 0 }
    if (r.status === 'pending') e.submitted_count++
    else e.validated_count++
    apMap.set(r.outletId, e)
  }

  const approval_pending = [...apMap.entries()].map(([outlet_id, counts]) => ({ outlet_id, ...counts }))

  // stock_discrepancy: opname movements in month, group by (outlet,item), SUM qtyBase
  const discRows = await db
    .select({
      outletId: stockMovements.outletId,
      itemId: stockMovements.itemId,
      itemName: items.name,
      totalDelta: drizzleSql<string>`SUM(${stockMovements.qtyBase})`.as('total_delta'),
    })
    .from(stockMovements)
    .innerJoin(items, eq(stockMovements.itemId, items.id))
    .where(and(
      eq(stockMovements.companyId, ctx.companyId),
      inArray(stockMovements.outletId, visibleOutletIds),
      eq(stockMovements.movementType, 'opname'),
      drizzleSql`DATE(${stockMovements.createdAt} AT TIME ZONE 'Asia/Jakarta') >= ${startDate}::date`,
      drizzleSql`DATE(${stockMovements.createdAt} AT TIME ZONE 'Asia/Jakarta') < ${nextMonthStart}::date`,
    ))
    .groupBy(stockMovements.outletId, stockMovements.itemId, items.name)
    .orderBy(drizzleSql`ABS(SUM(${stockMovements.qtyBase})) DESC`)
    .limit(10)

  const stock_discrepancy = discRows.map((r) => ({
    outlet_id: r.outletId,
    item_id: r.itemId,
    item_name: r.itemName,
    total_delta: r.totalDelta,
  }))

  return { outlet_status, report_compliance, approval_pending, stock_discrepancy }
}

// ── spvDashboard ──────────────────────────────────────────────────────────

export async function spvDashboard(
  db: Db,
  ctx: DashboardServiceContext,
  query: { date?: string },
  now?: () => Date,
) {
  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'dashboard.spv')
  if (visibleOutletIds.length === 0) {
    return {
      report_today: [],
      pending_validation: { reports_submitted: { count: 0, items: [] }, movements_submitted_count: 0, movements_validated_count: 0 },
      opname_today: [],
      issue_log: [],
      evidence_missing: [],
    }
  }

  const date = query.date ?? todayWIB(now)

  // report_today: visible outlets × {opening,closing}, missing slots included
  const reportsToday = await db
    .select({
      id: dailyReports.id,
      outletId: dailyReports.outletId,
      reportType: dailyReports.reportType,
      status: dailyReports.status,
      submitterName: users.fullName,
    })
    .from(dailyReports)
    .leftJoin(users, eq(dailyReports.submittedBy, users.id))
    .where(and(
      eq(dailyReports.companyId, ctx.companyId),
      inArray(dailyReports.outletId, visibleOutletIds),
      eq(dailyReports.reportDate, date),
      inArray(dailyReports.reportType, ['opening', 'closing']),
      isNull(dailyReports.deletedAt),
    ))

  const reportTodayIds = reportsToday.map((r) => r.id)
  const checklistCounts =
    reportTodayIds.length > 0
      ? await db
          .select({
            reportId: reportChecklistAnswers.reportId,
            checkedCount: drizzleSql<number>`COUNT(*) FILTER (WHERE ${reportChecklistAnswers.isChecked} = true)::int`.as('checked_count'),
            totalCount: drizzleSql<number>`COUNT(*)::int`.as('total_count'),
          })
          .from(reportChecklistAnswers)
          .where(inArray(reportChecklistAnswers.reportId, reportTodayIds))
          .groupBy(reportChecklistAnswers.reportId)
      : []

  const slotMap = new Map<string, (typeof reportsToday)[number]>()
  for (const r of reportsToday) slotMap.set(`${r.outletId}:${r.reportType}`, r)

  const checkMap = new Map<string, { checkedCount: number; totalCount: number }>()
  for (const c of checklistCounts) checkMap.set(c.reportId, { checkedCount: c.checkedCount, totalCount: c.totalCount })

  const report_today: {
    outlet_id: string
    report_type: string
    report_id: string | null
    status: string | null
    submitted_by_name: string | null
    checked_count: number
    total_count: number
  }[] = []
  for (const outletId of visibleOutletIds) {
    for (const reportType of ['opening', 'closing'] as const) {
      const r = slotMap.get(`${outletId}:${reportType}`)
      const cl = r ? (checkMap.get(r.id) ?? { checkedCount: 0, totalCount: 0 }) : { checkedCount: 0, totalCount: 0 }
      report_today.push({
        outlet_id: outletId,
        report_type: reportType,
        report_id: r?.id ?? null,
        status: r?.status ?? null,
        submitted_by_name: r?.submitterName ?? null,
        checked_count: cl.checkedCount,
        total_count: cl.totalCount,
      })
    }
  }

  // pending_validation
  const submittedReports = await db
    .select({ id: dailyReports.id, outletId: dailyReports.outletId, reportType: dailyReports.reportType, reportDate: dailyReports.reportDate })
    .from(dailyReports)
    .where(and(
      eq(dailyReports.companyId, ctx.companyId),
      inArray(dailyReports.outletId, visibleOutletIds),
      eq(dailyReports.status, 'submitted'),
      isNull(dailyReports.deletedAt),
    ))

  const pendingMovementCounts = await db
    .select({
      status: pendingStockMovements.status,
      count: drizzleSql<number>`COUNT(*)::int`.as('count'),
    })
    .from(pendingStockMovements)
    .where(and(
      eq(pendingStockMovements.companyId, ctx.companyId),
      inArray(pendingStockMovements.outletId, visibleOutletIds),
      inArray(pendingStockMovements.status, ['pending', 'validated']),
    ))
    .groupBy(pendingStockMovements.status)

  const movCountMap = new Map(pendingMovementCounts.map((r) => [r.status, r.count]))

  const pending_validation = {
    reports_submitted: {
      count: submittedReports.length,
      items: submittedReports.map((r) => ({ id: r.id, outlet_id: r.outletId, report_type: r.reportType, report_date: r.reportDate })),
    },
    movements_submitted_count: movCountMap.get('pending') ?? 0,
    movements_validated_count: movCountMap.get('validated') ?? 0,
  }

  // opname_today: pending_stock_movements type=opname, WIB date = date, status in (pending,validated)
  const opnameToday = await db
    .select({ id: pendingStockMovements.id, outletId: pendingStockMovements.outletId, status: pendingStockMovements.status })
    .from(pendingStockMovements)
    .where(and(
      eq(pendingStockMovements.companyId, ctx.companyId),
      inArray(pendingStockMovements.outletId, visibleOutletIds),
      eq(pendingStockMovements.movementType, 'opname'),
      inArray(pendingStockMovements.status, ['pending', 'validated']),
      drizzleSql`DATE(${pendingStockMovements.submittedAt} AT TIME ZONE 'Asia/Jakarta') = ${date}::date`,
    ))

  const opname_today = opnameToday.map((r) => ({ id: r.id, outlet_id: r.outletId, status: r.status }))

  // issue_log
  const issueRows = await db
    .select({ id: dailyReports.id, outletId: dailyReports.outletId, reportDate: dailyReports.reportDate, status: dailyReports.status, notes: dailyReports.notes })
    .from(dailyReports)
    .where(and(
      eq(dailyReports.companyId, ctx.companyId),
      inArray(dailyReports.outletId, visibleOutletIds),
      eq(dailyReports.reportType, 'issue'),
      isNull(dailyReports.deletedAt),
    ))
    .orderBy(desc(dailyReports.reportDate))
    .limit(10)

  const issue_log = issueRows.map((r) => ({
    id: r.id,
    outlet_id: r.outletId,
    report_date: r.reportDate,
    status: r.status,
    notes: r.notes ?? null,
  }))

  // evidence_missing: reports on `date` with status submitted/validated but NO confirmed evidence
  const candidateReports = await db
    .select({ id: dailyReports.id, outletId: dailyReports.outletId, reportType: dailyReports.reportType })
    .from(dailyReports)
    .where(and(
      eq(dailyReports.companyId, ctx.companyId),
      inArray(dailyReports.outletId, visibleOutletIds),
      eq(dailyReports.reportDate, date),
      inArray(dailyReports.status, ['submitted', 'validated']),
      isNull(dailyReports.deletedAt),
    ))

  const candidateIds = candidateReports.map((r) => r.id)
  const confirmedSet = new Set(
    candidateIds.length > 0
      ? (
          await db
            .select({ recordId: evidence.recordId })
            .from(evidence)
            .where(and(
              eq(evidence.recordType, 'daily_report'),
              inArray(evidence.recordId, candidateIds),
              eq(evidence.status, 'confirmed'),
              isNull(evidence.deletedAt),
            ))
        ).map((e) => e.recordId)
      : [],
  )

  const evidence_missing = candidateReports
    .filter((r) => !confirmedSet.has(r.id))
    .map((r) => ({ report_id: r.id, outlet_id: r.outletId, report_type: r.reportType }))

  return { report_today, pending_validation, opname_today, issue_log, evidence_missing }
}

// ── inventoryDashboard ────────────────────────────────────────────────────

export async function inventoryDashboard(
  db: Db,
  ctx: DashboardServiceContext,
  query: { date?: string; month?: string },
  now?: () => Date,
) {
  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'dashboard.inventory')
  if (visibleOutletIds.length === 0) {
    return { stock_critical: [], movement_today: [], waste_summary: [], pending_validation: { submitted_count: 0, validated_count: 0 }, top_discrepancy: [] }
  }

  const date = query.date ?? todayWIB(now)
  const month = query.month ?? date.slice(0, 7)
  const { startDate, nextMonthStart } = monthRangeWIB(month, now)

  // stock_critical: balances below min_stock
  const criticalRows = await db
    .select({
      outletId: stockBalances.outletId,
      itemId: stockBalances.itemId,
      itemName: items.name,
      balance: stockBalances.qtyBase,
      minStock: items.minStock,
    })
    .from(stockBalances)
    .innerJoin(items, eq(stockBalances.itemId, items.id))
    .where(and(
      eq(stockBalances.companyId, ctx.companyId),
      inArray(stockBalances.outletId, visibleOutletIds),
      drizzleSql`${items.minStock} IS NOT NULL`,
      drizzleSql`${items.minStock}::numeric > 0`,
      drizzleSql`${stockBalances.qtyBase}::numeric < ${items.minStock}::numeric`,
    ))
    .orderBy(drizzleSql`${stockBalances.qtyBase}::numeric / ${items.minStock}::numeric ASC`)
    .limit(20)

  const stock_critical = criticalRows.map((r) => ({
    outlet_id: r.outletId,
    item_id: r.itemId,
    item_name: r.itemName,
    balance: r.balance,
    min_stock: r.minStock,
  }))

  // movement_today: stockMovements grouped by movementType for WIB date
  const movRows = await db
    .select({
      movementType: stockMovements.movementType,
      count: drizzleSql<number>`COUNT(*)::int`.as('count'),
      totalQty: drizzleSql<string>`SUM(ABS(${stockMovements.qtyBase}))`.as('total_qty'),
    })
    .from(stockMovements)
    .where(and(
      eq(stockMovements.companyId, ctx.companyId),
      inArray(stockMovements.outletId, visibleOutletIds),
      drizzleSql`DATE(${stockMovements.createdAt} AT TIME ZONE 'Asia/Jakarta') = ${date}::date`,
    ))
    .groupBy(stockMovements.movementType)

  const movement_today = movRows.map((r) => ({ movement_type: r.movementType, count: r.count, total_qty: r.totalQty }))

  // waste_summary: waste movements in month, top 10 by total_qty
  const wasteRows = await db
    .select({
      itemId: stockMovements.itemId,
      itemName: items.name,
      totalQty: drizzleSql<string>`SUM(ABS(${stockMovements.qtyBase}))`.as('total_qty'),
    })
    .from(stockMovements)
    .innerJoin(items, eq(stockMovements.itemId, items.id))
    .where(and(
      eq(stockMovements.companyId, ctx.companyId),
      inArray(stockMovements.outletId, visibleOutletIds),
      eq(stockMovements.movementType, 'waste'),
      drizzleSql`DATE(${stockMovements.createdAt} AT TIME ZONE 'Asia/Jakarta') >= ${startDate}::date`,
      drizzleSql`DATE(${stockMovements.createdAt} AT TIME ZONE 'Asia/Jakarta') < ${nextMonthStart}::date`,
    ))
    .groupBy(stockMovements.itemId, items.name)
    .orderBy(drizzleSql`SUM(ABS(${stockMovements.qtyBase})) DESC`)
    .limit(10)

  const waste_summary = wasteRows.map((r) => ({ item_id: r.itemId, item_name: r.itemName, total_qty: r.totalQty }))

  // pending_validation counts
  const pendingCounts = await db
    .select({
      status: pendingStockMovements.status,
      count: drizzleSql<number>`COUNT(*)::int`.as('count'),
    })
    .from(pendingStockMovements)
    .where(and(
      eq(pendingStockMovements.companyId, ctx.companyId),
      inArray(pendingStockMovements.outletId, visibleOutletIds),
      inArray(pendingStockMovements.status, ['pending', 'validated']),
    ))
    .groupBy(pendingStockMovements.status)

  const countMap = new Map(pendingCounts.map((r) => [r.status, r.count]))
  const pending_validation = {
    submitted_count: countMap.get('pending') ?? 0,
    validated_count: countMap.get('validated') ?? 0,
  }

  // top_discrepancy: opname in month, group by item, top 10 by abs sum
  const discRows = await db
    .select({
      itemId: stockMovements.itemId,
      itemName: items.name,
      totalDelta: drizzleSql<string>`SUM(${stockMovements.qtyBase})`.as('total_delta'),
    })
    .from(stockMovements)
    .innerJoin(items, eq(stockMovements.itemId, items.id))
    .where(and(
      eq(stockMovements.companyId, ctx.companyId),
      inArray(stockMovements.outletId, visibleOutletIds),
      eq(stockMovements.movementType, 'opname'),
      drizzleSql`DATE(${stockMovements.createdAt} AT TIME ZONE 'Asia/Jakarta') >= ${startDate}::date`,
      drizzleSql`DATE(${stockMovements.createdAt} AT TIME ZONE 'Asia/Jakarta') < ${nextMonthStart}::date`,
    ))
    .groupBy(stockMovements.itemId, items.name)
    .orderBy(drizzleSql`ABS(SUM(${stockMovements.qtyBase})) DESC`)
    .limit(10)

  const top_discrepancy = discRows.map((r) => ({ item_id: r.itemId, item_name: r.itemName, total_delta: r.totalDelta }))

  return { stock_critical, movement_today, waste_summary, pending_validation, top_discrepancy }
}

// ── approvalQueue ─────────────────────────────────────────────────────────

export async function approvalQueue(db: Db, ctx: DashboardServiceContext) {
  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'dashboard.approval_queue')
  if (visibleOutletIds.length === 0) {
    return { to_validate: [], to_finalize: [], reports_to_validate: [] }
  }

  const toValidateRows = await db
    .select({
      id: pendingStockMovements.id,
      outletId: pendingStockMovements.outletId,
      movementType: pendingStockMovements.movementType,
      submittedBy: pendingStockMovements.submittedBy,
      submittedAt: pendingStockMovements.submittedAt,
    })
    .from(pendingStockMovements)
    .where(and(
      eq(pendingStockMovements.companyId, ctx.companyId),
      inArray(pendingStockMovements.outletId, visibleOutletIds),
      eq(pendingStockMovements.status, 'pending'),
    ))

  const to_validate = toValidateRows.map((r) => ({
    id: r.id,
    outlet_id: r.outletId,
    movement_type: r.movementType,
    submitted_by: r.submittedBy,
    submitted_at: r.submittedAt.toISOString(),
    actionable: r.submittedBy !== ctx.actorUserId,
  }))

  const toFinalizeRows = await db
    .select({
      id: pendingStockMovements.id,
      outletId: pendingStockMovements.outletId,
      movementType: pendingStockMovements.movementType,
      submittedBy: pendingStockMovements.submittedBy,
      submittedAt: pendingStockMovements.submittedAt,
      validatedBy: pendingStockMovements.validatedBy,
      validatedAt: pendingStockMovements.validatedAt,
    })
    .from(pendingStockMovements)
    .where(and(
      eq(pendingStockMovements.companyId, ctx.companyId),
      inArray(pendingStockMovements.outletId, visibleOutletIds),
      eq(pendingStockMovements.status, 'validated'),
    ))

  const to_finalize = toFinalizeRows.map((r) => ({
    id: r.id,
    outlet_id: r.outletId,
    movement_type: r.movementType,
    submitted_by: r.submittedBy,
    submitted_at: r.submittedAt.toISOString(),
    validated_by: r.validatedBy ?? null,
    validated_at: r.validatedAt?.toISOString() ?? null,
    actionable: r.submittedBy !== ctx.actorUserId,
  }))

  const reportsToValidateRows = await db
    .select({
      id: dailyReports.id,
      outletId: dailyReports.outletId,
      reportType: dailyReports.reportType,
      reportDate: dailyReports.reportDate,
      submittedBy: dailyReports.submittedBy,
      submittedAt: dailyReports.submittedAt,
    })
    .from(dailyReports)
    .where(and(
      eq(dailyReports.companyId, ctx.companyId),
      inArray(dailyReports.outletId, visibleOutletIds),
      eq(dailyReports.status, 'submitted'),
      isNull(dailyReports.deletedAt),
    ))

  const reports_to_validate = reportsToValidateRows.map((r) => ({
    id: r.id,
    outlet_id: r.outletId,
    report_type: r.reportType,
    report_date: r.reportDate,
    submitted_by: r.submittedBy ?? null,
    submitted_at: r.submittedAt?.toISOString() ?? null,
  }))

  return { to_validate, to_finalize, reports_to_validate }
}
