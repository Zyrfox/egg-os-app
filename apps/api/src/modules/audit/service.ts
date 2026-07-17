import { and, desc, eq, gte, lt, sql as drizzleSql } from 'drizzle-orm'
import { auditLogs } from '@egg-os/db'
import type { Db } from '../../lib/db'

export type AuditReadContext = { companyId: string }

export type ListAuditLogsQuery = {
  actorUserId?: string
  action?: string
  recordType?: string
  recordId?: string
  dateFrom?: string   // YYYY-MM-DD WIB
  dateTo?: string     // YYYY-MM-DD WIB
  outletId?: string
  page?: number
  pageSize?: number
}

function auditLogDto(row: typeof auditLogs.$inferSelect) {
  return {
    id: row.id,
    company_id: row.companyId,
    actor_user_id: row.actorUserId,
    action: row.action,
    record_type: row.recordType,
    record_id: row.recordId,
    outlet_id: row.outletId,
    meta: row.meta,
    ip: row.ip,
    created_at: row.createdAt.toISOString(),
  }
}

export async function listAuditLogs(
  db: Db,
  ctx: AuditReadContext,
  query: ListAuditLogsQuery = {},
) {
  const page = query.page && query.page > 0 ? query.page : 1
  const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 20

  const conditions = [eq(auditLogs.companyId, ctx.companyId)]

  if (query.actorUserId) conditions.push(eq(auditLogs.actorUserId, query.actorUserId))
  if (query.action) conditions.push(eq(auditLogs.action, query.action))
  if (query.recordType) conditions.push(eq(auditLogs.recordType, query.recordType))
  if (query.recordId) conditions.push(eq(auditLogs.recordId, query.recordId))
  if (query.outletId) conditions.push(eq(auditLogs.outletId, query.outletId))

  // TODO: konsolidasi ke lib/date (utang §9) — lib/date saat ini hanya string→string WIB, belum ada YYYY-MM-DD→Date UTC
  if (query.dateFrom) {
    conditions.push(gte(auditLogs.createdAt, new Date(`${query.dateFrom}T00:00:00+07:00`)))
  }
  if (query.dateTo) {
    const startOfDay = new Date(`${query.dateTo}T00:00:00+07:00`)
    conditions.push(lt(auditLogs.createdAt, new Date(startOfDay.getTime() + 86_400_000)))
  }

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(...conditions)),
  ])

  return {
    data: rows.map(auditLogDto),
    meta: { page, page_size: pageSize, total: countRows[0]?.count ?? 0 },
  }
}
