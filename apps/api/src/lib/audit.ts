import type { Db } from './db'
import { auditLogs } from '@egg-os/db'

export type AuditEntry = {
  action: string
  recordType?: string
  recordId?: string
  outletId?: string
  meta?: Record<string, unknown>
  ip?: string
  actorUserId?: string
}

export async function auditLog(
  db: Db,
  ctx: { companyId: string; actorUserId?: string },
  entry: AuditEntry,
): Promise<void> {
  await db.insert(auditLogs).values({
    companyId: ctx.companyId,
    actorUserId: entry.actorUserId ?? ctx.actorUserId ?? null,
    action: entry.action,
    recordType: entry.recordType ?? null,
    recordId: entry.recordId ?? null,
    outletId: entry.outletId ?? null,
    meta: (entry.meta ?? null) as Record<string, unknown> | null,
    ip: entry.ip ?? null,
  })
}
