import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { evidence, outlets, tasks, userRoles } from '@egg-os/db'
import { ERR } from '../../lib/errors'
import type { Db } from '../../lib/db'
import type { AccessFilter } from '../rbac/middleware'
import type { ResolvedAccess } from '../rbac/resolve'
import { assertOutletInScope, visibleOutletIdsForPermission } from '../../lib/scope'
import { auditLog } from '../../lib/audit'

type ErrorDetail = { field: string; issue: string }

export type TaskServiceContext = {
  companyId: string
  actorUserId: string
  access?: ResolvedAccess
  accessFilter?: AccessFilter
}

export type CreateTaskInput = {
  outletId: string
  assigneeUserId: string
  title: string
  description?: string | null
  dueAt?: Date | null
}

export type UpdateTaskInput = {
  title?: string
  description?: string | null
  dueAt?: Date | null
}

type Task = typeof tasks.$inferSelect

export class TaskServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[]
  ) {
    super(message)
  }
}

async function getTask(db: Db, companyId: string, taskId: string): Promise<Task> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.companyId, companyId)))
    .limit(1)

  if (!task) {
    throw new TaskServiceError(ERR.NOT_FOUND.http, ERR.NOT_FOUND.code, ERR.NOT_FOUND.message)
  }

  return task
}

function assertNotTerminal(task: Task): void {
  if (task.status === 'verified' || task.status === 'cancelled') {
    throw new TaskServiceError(ERR.CONFLICT.http, ERR.CONFLICT.code, 'Task sudah dalam status terminal')
  }
}

async function assertAssigneeVisible(
  db: Db,
  companyId: string,
  outletId: string,
  assigneeUserId: string
): Promise<void> {
  const [outletRow] = await db
    .select({ brandId: outlets.brandId })
    .from(outlets)
    .where(and(eq(outlets.id, outletId), eq(outlets.companyId, companyId)))
    .limit(1)

  if (!outletRow) {
    throw new TaskServiceError(ERR.NOT_FOUND.http, ERR.NOT_FOUND.code, ERR.NOT_FOUND.message)
  }

  const visible = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, assigneeUserId),
        eq(userRoles.companyId, companyId),
        isNull(userRoles.deletedAt),
        or(
          and(eq(userRoles.scopeType, 'outlet'), eq(userRoles.scopeId, outletId)),
          and(eq(userRoles.scopeType, 'brand'), eq(userRoles.scopeId, outletRow.brandId)),
          inArray(userRoles.scopeType, ['company', 'global'])
        )
      )
    )
    .limit(1)

  if (visible.length === 0) {
    throw new TaskServiceError(ERR.OUT_OF_SCOPE.http, ERR.OUT_OF_SCOPE.code, ERR.OUT_OF_SCOPE.message)
  }
}

function auditMeta(task: Task, extra?: Record<string, unknown>) {
  return {
    task_id: task.id,
    outlet_id: task.outletId,
    assignee_user_id: task.assigneeUserId,
    ...extra,
  }
}

export async function createTask(db: Db, ctx: TaskServiceContext, input: CreateTaskInput): Promise<Task> {
  if (input.assigneeUserId === ctx.actorUserId) {
    throw new TaskServiceError(
      ERR.VALIDATION.http,
      ERR.VALIDATION.code,
      'Assigner tidak boleh mengassign task ke diri sendiri',
      [{ field: 'assignee_user_id', issue: 'self-assignment dilarang' }]
    )
  }

  await assertOutletInScope(db, ctx, input.outletId, 'task.create')
  await assertAssigneeVisible(db, ctx.companyId, input.outletId, input.assigneeUserId)

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db

    const [task] = await txDb
      .insert(tasks)
      .values({
        companyId: ctx.companyId,
        outletId: input.outletId,
        title: input.title,
        description: input.description ?? null,
        assignerUserId: ctx.actorUserId,
        assigneeUserId: input.assigneeUserId,
        status: 'open',
        dueAt: input.dueAt ?? null,
      })
      .returning()

    await auditLog(txDb, ctx, {
      action: 'task.create',
      recordType: 'task',
      recordId: task.id,
      outletId: task.outletId,
      meta: auditMeta(task),
    })

    return task
  })
}

export async function startTask(db: Db, ctx: TaskServiceContext, taskId: string): Promise<Task> {
  const task = await getTask(db, ctx.companyId, taskId)
  assertNotTerminal(task)

  if (task.status !== 'open' && task.status !== 'rejected') {
    throw new TaskServiceError(ERR.CONFLICT.http, ERR.CONFLICT.code, 'Transisi tidak valid: start hanya dari open atau rejected')
  }

  if (task.assigneeUserId !== ctx.actorUserId) {
    throw new TaskServiceError(ERR.FORBIDDEN.http, ERR.FORBIDDEN.code, 'Hanya assignee yang bisa start task')
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db

    const [updated] = await txDb
      .update(tasks)
      .set({ status: 'in_progress', updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning()

    await auditLog(txDb, ctx, {
      action: 'task.start',
      recordType: 'task',
      recordId: task.id,
      outletId: task.outletId,
      meta: auditMeta(task),
    })

    return updated
  })
}

export async function doneTask(db: Db, ctx: TaskServiceContext, taskId: string): Promise<Task> {
  const task = await getTask(db, ctx.companyId, taskId)
  assertNotTerminal(task)

  if (task.status !== 'open' && task.status !== 'in_progress' && task.status !== 'rejected') {
    throw new TaskServiceError(ERR.CONFLICT.http, ERR.CONFLICT.code, 'Transisi tidak valid: done hanya dari open, in_progress, atau rejected')
  }

  if (task.assigneeUserId !== ctx.actorUserId) {
    throw new TaskServiceError(ERR.FORBIDDEN.http, ERR.FORBIDDEN.code, 'Hanya assignee yang bisa menyelesaikan task')
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db

    const [updated] = await txDb
      .update(tasks)
      .set({ status: 'done', doneAt: new Date(), updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning()

    await auditLog(txDb, ctx, {
      action: 'task.done',
      recordType: 'task',
      recordId: task.id,
      outletId: task.outletId,
      meta: auditMeta(task),
    })

    return updated
  })
}

export async function verifyTask(db: Db, ctx: TaskServiceContext, taskId: string): Promise<Task> {
  const task = await getTask(db, ctx.companyId, taskId)
  assertNotTerminal(task)

  if (task.status !== 'done') {
    throw new TaskServiceError(ERR.CONFLICT.http, ERR.CONFLICT.code, 'Transisi tidak valid: verify hanya dari status done')
  }

  // SoD: assignee tidak boleh verify task sendiri — tanpa pengecualian, termasuk data anomali
  if (task.assigneeUserId === ctx.actorUserId) {
    throw new TaskServiceError(ERR.SELF_APPROVAL.http, ERR.SELF_APPROVAL.code, ERR.SELF_APPROVAL.message)
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db

    const [updated] = await txDb
      .update(tasks)
      .set({ status: 'verified', verifiedAt: new Date(), verifiedBy: ctx.actorUserId, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning()

    await auditLog(txDb, ctx, {
      action: 'task.verify',
      recordType: 'task',
      recordId: task.id,
      outletId: task.outletId,
      meta: auditMeta(task),
    })

    return updated
  })
}

export async function rejectTask(db: Db, ctx: TaskServiceContext, taskId: string, reason: string): Promise<Task> {
  const task = await getTask(db, ctx.companyId, taskId)
  assertNotTerminal(task)

  if (task.status !== 'done') {
    throw new TaskServiceError(ERR.CONFLICT.http, ERR.CONFLICT.code, 'Transisi tidak valid: reject hanya dari status done')
  }

  // SoD: sama dengan verify
  if (task.assigneeUserId === ctx.actorUserId) {
    throw new TaskServiceError(ERR.SELF_APPROVAL.http, ERR.SELF_APPROVAL.code, ERR.SELF_APPROVAL.message)
  }

  if (!reason?.trim()) {
    throw new TaskServiceError(
      ERR.VALIDATION.http,
      ERR.VALIDATION.code,
      'Alasan reject wajib diisi',
      [{ field: 'reason', issue: 'reason wajib diisi' }]
    )
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db

    const [updated] = await txDb
      .update(tasks)
      .set({ status: 'rejected', rejectReason: reason, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning()

    await auditLog(txDb, ctx, {
      action: 'task.reject',
      recordType: 'task',
      recordId: task.id,
      outletId: task.outletId,
      meta: auditMeta(task, { reason }),
    })

    return updated
  })
}

export async function cancelTask(db: Db, ctx: TaskServiceContext, taskId: string): Promise<Task> {
  const task = await getTask(db, ctx.companyId, taskId)
  assertNotTerminal(task)

  if (task.status !== 'open' && task.status !== 'in_progress') {
    throw new TaskServiceError(ERR.CONFLICT.http, ERR.CONFLICT.code, 'Transisi tidak valid: cancel hanya dari open atau in_progress')
  }

  if (task.assignerUserId !== ctx.actorUserId) {
    throw new TaskServiceError(ERR.FORBIDDEN.http, ERR.FORBIDDEN.code, 'Hanya assigner yang bisa cancel task')
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db

    const [updated] = await txDb
      .update(tasks)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning()

    await auditLog(txDb, ctx, {
      action: 'task.cancel',
      recordType: 'task',
      recordId: task.id,
      outletId: task.outletId,
      meta: auditMeta(task),
    })

    return updated
  })
}

export async function updateTask(
  db: Db,
  ctx: TaskServiceContext,
  taskId: string,
  input: UpdateTaskInput
): Promise<Task> {
  const task = await getTask(db, ctx.companyId, taskId)
  assertNotTerminal(task)

  if (task.status !== 'open') {
    throw new TaskServiceError(ERR.CONFLICT.http, ERR.CONFLICT.code, 'Task hanya bisa diedit saat status open')
  }

  if (task.assignerUserId !== ctx.actorUserId) {
    throw new TaskServiceError(ERR.FORBIDDEN.http, ERR.FORBIDDEN.code, 'Hanya assigner yang bisa edit task')
  }

  const changedFields: string[] = []
  const setValues: Partial<typeof tasks.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() }

  if (input.title !== undefined) {
    setValues.title = input.title
    changedFields.push('title')
  }
  if ('description' in input) {
    setValues.description = input.description ?? null
    changedFields.push('description')
  }
  if ('dueAt' in input) {
    setValues.dueAt = input.dueAt ?? null
    changedFields.push('due_at')
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db

    const [updated] = await txDb
      .update(tasks)
      .set(setValues)
      .where(eq(tasks.id, taskId))
      .returning()

    await auditLog(txDb, ctx, {
      action: 'task.update',
      recordType: 'task',
      recordId: task.id,
      outletId: task.outletId,
      meta: auditMeta(task, { changed_fields: changedFields }),
    })

    return updated
  })
}

// ── Read layer ────────────────────────────────────────────────────────────────

function taskDto(task: Task) {
  const now = new Date()
  const terminalStatuses = ['done', 'verified', 'cancelled']
  return {
    id: task.id,
    company_id: task.companyId,
    outlet_id: task.outletId,
    title: task.title,
    description: task.description,
    assigner_user_id: task.assignerUserId,
    assignee_user_id: task.assigneeUserId,
    status: task.status,
    due_at: task.dueAt?.toISOString() ?? null,
    overdue: task.dueAt ? (task.dueAt < now && !terminalStatuses.includes(task.status)) : false,
    done_at: task.doneAt?.toISOString() ?? null,
    verified_at: task.verifiedAt?.toISOString() ?? null,
    verified_by: task.verifiedBy,
    reject_reason: task.rejectReason,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
  }
}

export type ListTasksServiceQuery = {
  outletId?: string
  assigneeUserId?: string
  status?: string
  dueFrom?: string
  dueTo?: string
  overdue?: boolean
  page: number
  pageSize: number
}

export async function listTasks(db: Db, ctx: TaskServiceContext, query: ListTasksServiceQuery) {
  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'task.read')

  const scopeCondition = or(
    visibleOutletIds.length > 0 ? inArray(tasks.outletId, visibleOutletIds) : sql`false`,
    eq(tasks.assigneeUserId, ctx.actorUserId),
  )

  const conditions = [eq(tasks.companyId, ctx.companyId), scopeCondition]

  if (query.outletId) conditions.push(eq(tasks.outletId, query.outletId))
  if (query.assigneeUserId) conditions.push(eq(tasks.assigneeUserId, query.assigneeUserId))
  if (query.status) conditions.push(eq(tasks.status, query.status))

  if (query.dueFrom) {
    conditions.push(gte(tasks.dueAt, new Date(`${query.dueFrom}T00:00:00+07:00`)))
  }
  if (query.dueTo) {
    const to = new Date(new Date(`${query.dueTo}T00:00:00+07:00`).getTime() + 86_400_000)
    conditions.push(lt(tasks.dueAt, to))
  }

  if (query.overdue === true) {
    conditions.push(isNotNull(tasks.dueAt))
    conditions.push(lt(tasks.dueAt, new Date()))
    conditions.push(
      sql`${tasks.status} NOT IN ('done','verified','cancelled')`,
    )
  }

  const whereClause = and(...conditions)
  const offset = (query.page - 1) * query.pageSize

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(whereClause)
      .orderBy(sql`${tasks.dueAt} ASC NULLS LAST`, desc(tasks.createdAt))
      .limit(query.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(tasks)
      .where(whereClause),
  ])

  return {
    data: rows.map(taskDto),
    meta: { page: query.page, page_size: query.pageSize, total: countResult[0].count },
  }
}

export async function getTaskById(db: Db, ctx: TaskServiceContext, taskId: string) {
  const task = await getTask(db, ctx.companyId, taskId)

  const visibleOutletIds = await visibleOutletIdsForPermission(db, ctx, 'task.read')
  const isInScope = visibleOutletIds.includes(task.outletId)
  const isAssignee = task.assigneeUserId === ctx.actorUserId
  if (!isInScope && !isAssignee) {
    throw new TaskServiceError(ERR.OUT_OF_SCOPE.http, ERR.OUT_OF_SCOPE.code, ERR.OUT_OF_SCOPE.message)
  }

  const evidenceRows = await db
    .select()
    .from(evidence)
    .where(
      and(
        eq(evidence.companyId, ctx.companyId),
        eq(evidence.recordType, 'task'),
        eq(evidence.recordId, task.id),
        isNull(evidence.deletedAt),
      ),
    )
    .orderBy(evidence.createdAt)

  const evidenceDtos = evidenceRows.map((row) => ({
    id: row.id,
    record_type: row.recordType,
    record_id: row.recordId,
    file_name: row.fileName,
    content_type: row.contentType,
    file_size: row.fileSize,
    status: row.status,
    storage_key: row.storageKey,
    uploaded_by: row.uploadedBy,
    uploaded_at: row.uploadedAt.toISOString(),
    confirmed_at: row.confirmedAt?.toISOString() ?? null,
  }))

  return { ...taskDto(task), evidence: evidenceDtos }
}
