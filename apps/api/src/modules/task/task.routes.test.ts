import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  auditLogs,
  brands,
  companies,
  evidence,
  outlets,
  permissions,
  rolePermissions,
  roles,
  tasks,
  userRoles,
  users,
} from '@egg-os/db'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import type { TestResponseBody } from '../../test/types'

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars'

const mockR2Bucket = {
  head: async () => null as { size: number } | null,
  delete: async () => {},
  put: async () => null as unknown as R2Object,
  get: async () => null as unknown as R2ObjectBody,
}

const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
  EVIDENCE_BUCKET: mockR2Bucket,
  R2_ACCESS_KEY_ID: 'test-key-id',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  R2_ACCOUNT_ID: 'test-account-id',
}

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

// UUID prefix d2* — registered in EGG_OS_AUDIT_4B_SPEC_BUILDABLE_v0_1.md §9
const D2_COMPANY       = 'd2000000-0000-4000-8000-000000000001'
const D2_BRAND         = 'd2000000-0000-4000-8000-000000000002'
const D2_OUTLET_A      = 'd2000000-0000-4000-8000-000000000003'
const D2_OUTLET_B      = 'd2000000-0000-4000-8000-000000000004'
const D2_SPV           = 'd2000000-0000-4000-8000-000000000010'
const D2_STAFF_A       = 'd2000000-0000-4000-8000-000000000011'
const D2_VERIFIER      = 'd2000000-0000-4000-8000-000000000012'
const D2_AUDITOR       = 'd2000000-0000-4000-8000-000000000013'
const D2_SPV_ROLE      = 'd2100000-0000-4000-8000-000000000001'
const D2_STAFF_ROLE    = 'd2100000-0000-4000-8000-000000000002'
const D2_VERIFIER_ROLE = 'd2100000-0000-4000-8000-000000000003'
const D2_AUDITOR_ROLE  = 'd2100000-0000-4000-8000-000000000004'

const permissionCodes = [
  'task.create', 'task.update_own', 'task.verify', 'task.read',
  'evidence.upload', 'evidence.read',
]
const permissionIds = new Map<string, string>()

let spvToken = ''
let staffToken = ''
let verifierToken = ''
let auditorToken = ''

async function req(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: TestResponseBody }> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await app.request(
    `http://localhost${path}`,
    { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined },
    TEST_ENV,
  )
  return { status: res.status, body: (await res.json()) as TestResponseBody }
}

async function tokenFor(userId: string, companyId = D2_COMPANY) {
  return signAccessToken(
    { sub: userId, company_id: companyId, roles: [], scopes: [], first_login_required: false },
    TEST_JWT_SECRET,
  )
}

async function cleanupFixtures() {
  await sql`DELETE FROM audit_logs WHERE company_id = ${D2_COMPANY}`
  await sql`DELETE FROM evidence WHERE company_id = ${D2_COMPANY}`
  await sql`DELETE FROM tasks WHERE company_id = ${D2_COMPANY}`
  await sql`DELETE FROM user_roles WHERE company_id = ${D2_COMPANY}`
  await sql`DELETE FROM role_permissions WHERE company_id = ${D2_COMPANY}`
  await sql`DELETE FROM roles WHERE company_id = ${D2_COMPANY}`
  await sql`DELETE FROM users WHERE company_id = ${D2_COMPANY}`
  await sql`DELETE FROM outlets WHERE company_id = ${D2_COMPANY}`
  await sql`DELETE FROM brands WHERE company_id = ${D2_COMPANY}`
  await sql`DELETE FROM companies WHERE id = ${D2_COMPANY}`
}

async function resetTasks() {
  await sql`DELETE FROM audit_logs WHERE company_id = ${D2_COMPANY}`
  await sql`DELETE FROM evidence WHERE company_id = ${D2_COMPANY}`
  await sql`DELETE FROM tasks WHERE company_id = ${D2_COMPANY}`
}

async function insertPermissionCatalog() {
  await db
    .insert(permissions)
    .values(permissionCodes.map((code) => {
      const [module, action] = code.split('.')
      return { code, module, action, description: `Task route test ${code}` }
    }))
    .onConflictDoNothing()

  const rows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, permissionCodes))

  for (const row of rows) permissionIds.set(row.code, row.id)
}

async function assignPermissions(roleId: string, codes: string[]) {
  await db.insert(rolePermissions).values(
    codes.map((code) => ({ roleId, permissionId: permissionIds.get(code)!, companyId: D2_COMPANY })),
  )
}

async function seedFixtures() {
  await insertPermissionCatalog()

  await db.insert(companies).values({
    id: D2_COMPANY, companyCode: 'TSK-R', companyName: 'Task Routes Test', status: 'active',
  })
  await db.insert(brands).values({
    id: D2_BRAND, companyId: D2_COMPANY, brandCode: 'TSK-RB', brandName: 'Task Brand', status: 'active',
  })
  await db.insert(outlets).values([
    { id: D2_OUTLET_A, companyId: D2_COMPANY, brandId: D2_BRAND, outletCode: 'TSK-A', outletName: 'Outlet A', status: 'active' },
    { id: D2_OUTLET_B, companyId: D2_COMPANY, brandId: D2_BRAND, outletCode: 'TSK-B', outletName: 'Outlet B', status: 'active' },
  ])
  await db.insert(users).values([
    { id: D2_SPV,      companyId: D2_COMPANY, email: 'tsk-r-spv@egg.test',      fullName: 'SPV',      status: 'active', firstLoginRequired: false },
    { id: D2_STAFF_A,  companyId: D2_COMPANY, email: 'tsk-r-staff@egg.test',    fullName: 'Staff A',  status: 'active', firstLoginRequired: false },
    { id: D2_VERIFIER, companyId: D2_COMPANY, email: 'tsk-r-verifier@egg.test', fullName: 'Verifier', status: 'active', firstLoginRequired: false },
    { id: D2_AUDITOR,  companyId: D2_COMPANY, email: 'tsk-r-auditor@egg.test',  fullName: 'Auditor',  status: 'active', firstLoginRequired: false },
  ])
  await db.insert(roles).values([
    { id: D2_SPV_ROLE,      companyId: D2_COMPANY, code: 'TSK_R_SPV',      name: 'SPV role',      defaultScopeType: 'outlet',   isSystem: false },
    { id: D2_STAFF_ROLE,    companyId: D2_COMPANY, code: 'TSK_R_STAFF',    name: 'Staff role',    defaultScopeType: 'outlet',   isSystem: false },
    { id: D2_VERIFIER_ROLE, companyId: D2_COMPANY, code: 'TSK_R_VERIFIER', name: 'Verifier role', defaultScopeType: 'outlet',   isSystem: false },
    { id: D2_AUDITOR_ROLE,  companyId: D2_COMPANY, code: 'TSK_R_AUDITOR',  name: 'Auditor role',  defaultScopeType: 'company',  isSystem: false },
  ])
  await assignPermissions(D2_SPV_ROLE,      ['task.create', 'task.update_own', 'task.verify', 'task.read', 'evidence.upload', 'evidence.read'])
  await assignPermissions(D2_STAFF_ROLE,    ['task.update_own', 'task.read', 'evidence.upload', 'evidence.read'])
  await assignPermissions(D2_VERIFIER_ROLE, ['task.verify', 'task.read'])
  await assignPermissions(D2_AUDITOR_ROLE,  ['task.read'])

  await db.insert(userRoles).values([
    { userId: D2_SPV,      roleId: D2_SPV_ROLE,      companyId: D2_COMPANY, scopeType: 'outlet',  scopeId: D2_OUTLET_A, grantedBy: D2_SPV },
    { userId: D2_STAFF_A,  roleId: D2_STAFF_ROLE,    companyId: D2_COMPANY, scopeType: 'outlet',  scopeId: D2_OUTLET_A, grantedBy: D2_SPV },
    { userId: D2_VERIFIER, roleId: D2_VERIFIER_ROLE, companyId: D2_COMPANY, scopeType: 'outlet',  scopeId: D2_OUTLET_A, grantedBy: D2_SPV },
    { userId: D2_AUDITOR,  roleId: D2_AUDITOR_ROLE,  companyId: D2_COMPANY, scopeType: 'company', scopeId: null,        grantedBy: D2_SPV },
  ])
}

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
  spvToken      = await tokenFor(D2_SPV)
  staffToken    = await tokenFor(D2_STAFF_A)
  verifierToken = await tokenFor(D2_VERIFIER)
  auditorToken  = await tokenFor(D2_AUDITOR)
})

beforeEach(async () => {
  await resetTasks()
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createTaskViaApi(title = 'Test Task', dueAt?: string) {
  const body: Record<string, unknown> = {
    outlet_id: D2_OUTLET_A,
    assignee_user_id: D2_STAFF_A,
    title,
  }
  if (dueAt !== undefined) body.due_at = dueAt
  const { status, body: res } = await req('POST', '/api/v1/tasks', spvToken, body)
  expect(status).toBe(201)
  return (res.data as { id: string }).id
}

async function advanceToState(taskId: string, targetStatus: 'in_progress' | 'done' | 'verified' | 'rejected') {
  if (targetStatus === 'in_progress' || targetStatus === 'done' || targetStatus === 'verified' || targetStatus === 'rejected') {
    if (targetStatus !== 'in_progress') {
      await req('POST', `/api/v1/tasks/${taskId}/done`, staffToken)
    } else {
      await req('POST', `/api/v1/tasks/${taskId}/start`, staffToken)
      return
    }
  }
  if (targetStatus === 'verified') {
    await req('POST', `/api/v1/tasks/${taskId}/verify`, verifierToken)
  }
  if (targetStatus === 'rejected') {
    await req('POST', `/api/v1/tasks/${taskId}/reject`, verifierToken, { reason: 'tidak sesuai' })
  }
}

// ── Happy path ────────────────────────────────────────────────────────────────

describe('Task routes — happy path', () => {
  it('full cycle: create → start → done → verify → 201/200/200/200', async () => {
    const taskId = await createTaskViaApi('Full Cycle Task')

    const startRes = await req('POST', `/api/v1/tasks/${taskId}/start`, staffToken)
    expect(startRes.status).toBe(200)
    expect((startRes.body.data as { status: string }).status).toBe('in_progress')

    const doneRes = await req('POST', `/api/v1/tasks/${taskId}/done`, staffToken)
    expect(doneRes.status).toBe(200)
    expect((doneRes.body.data as { status: string }).status).toBe('done')

    const verifyRes = await req('POST', `/api/v1/tasks/${taskId}/verify`, verifierToken)
    expect(verifyRes.status).toBe(200)
    expect((verifyRes.body.data as { status: string }).status).toBe('verified')
  })

  it('create → done (skip in_progress) → reject → done → verify', async () => {
    const taskId = await createTaskViaApi('Skip Start Task')

    await req('POST', `/api/v1/tasks/${taskId}/done`, staffToken)
    const rejectRes = await req('POST', `/api/v1/tasks/${taskId}/reject`, verifierToken, { reason: 'revisi dulu' })
    expect(rejectRes.status).toBe(200)
    expect((rejectRes.body.data as { status: string }).status).toBe('rejected')

    await req('POST', `/api/v1/tasks/${taskId}/done`, staffToken)
    const verifyRes = await req('POST', `/api/v1/tasks/${taskId}/verify`, verifierToken)
    expect(verifyRes.status).toBe(200)
    expect((verifyRes.body.data as { status: string }).status).toBe('verified')
  })

  it('PATCH title/description → 200 updated', async () => {
    const taskId = await createTaskViaApi('Original Title')

    const patchRes = await req('PATCH', `/api/v1/tasks/${taskId}`, spvToken, {
      title: 'Updated Title',
      description: 'New description',
    })
    expect(patchRes.status).toBe(200)
    const data = patchRes.body.data as { title: string; description: string }
    expect(data.title).toBe('Updated Title')
    expect(data.description).toBe('New description')
  })

  it('cancel open task → 200 cancelled', async () => {
    const taskId = await createTaskViaApi('Cancel Task')
    const cancelRes = await req('POST', `/api/v1/tasks/${taskId}/cancel`, spvToken)
    expect(cancelRes.status).toBe(200)
    expect((cancelRes.body.data as { status: string }).status).toBe('cancelled')
  })

  it('GET /tasks/:id returns task detail', async () => {
    const taskId = await createTaskViaApi('Detail Task')
    const { status, body } = await req('GET', `/api/v1/tasks/${taskId}`, spvToken)
    expect(status).toBe(200)
    const data = body.data as { id: string; status: string; evidence: unknown[] }
    expect(data.id).toBe(taskId)
    expect(data.status).toBe('open')
    expect(Array.isArray(data.evidence)).toBe(true)
  })
})

// ── B7 — Permission matrix ────────────────────────────────────────────────────

describe('B7 — permission matrix', () => {
  it('no Bearer → 401', async () => {
    const { status } = await req('GET', '/api/v1/tasks')
    expect(status).toBe(401)
  })

  it('STAFF cannot create task → 403', async () => {
    const { status } = await req('POST', '/api/v1/tasks', staffToken, {
      outlet_id: D2_OUTLET_A, assignee_user_id: D2_SPV, title: 'Test',
    })
    expect(status).toBe(403)
  })

  it('STAFF cannot verify task → 403', async () => {
    const taskId = await createTaskViaApi('Staff Verify Test')
    await req('POST', `/api/v1/tasks/${taskId}/done`, staffToken)
    const { status } = await req('POST', `/api/v1/tasks/${taskId}/verify`, staffToken)
    expect(status).toBe(403)
  })

  it('AUDITOR can read tasks → 200', async () => {
    const { status } = await req('GET', '/api/v1/tasks', auditorToken)
    expect(status).toBe(200)
  })

  it('AUDITOR cannot create task → 403', async () => {
    const { status } = await req('POST', '/api/v1/tasks', auditorToken, {
      outlet_id: D2_OUTLET_A, assignee_user_id: D2_STAFF_A, title: 'Test',
    })
    expect(status).toBe(403)
  })

  it('AUDITOR cannot start/done/verify/cancel task → 403', async () => {
    const taskId = await createTaskViaApi('Auditor Action Test')
    const startRes = await req('POST', `/api/v1/tasks/${taskId}/start`, auditorToken)
    expect(startRes.status).toBe(403)
  })
})

// ── B6 — WIB overdue boundary ─────────────────────────────────────────────────

describe('B6 — overdue derived correctly', () => {
  it('past due_at + open → overdue=true; future → overdue=false; no due_at → overdue=false', async () => {
    const pastId   = await createTaskViaApi('Past Due Task', '1970-01-01')
    const futureId = await createTaskViaApi('Future Due Task', '2099-12-31')
    const noDueId  = await createTaskViaApi('No Due Task')

    const { status, body } = await req('GET', `/api/v1/tasks?overdue=true`, spvToken)
    expect(status).toBe(200)
    const data = body.data as Array<{ id: string; overdue: boolean }>

    const pastTask   = data.find((t) => t.id === pastId)
    const futureTask = data.find((t) => t.id === futureId)
    const noDueTask  = data.find((t) => t.id === noDueId)

    expect(pastTask).toBeDefined()
    expect(pastTask?.overdue).toBe(true)
    expect(futureTask).toBeUndefined()
    expect(noDueTask).toBeUndefined()

    // Also verify individual task DTO overdue field
    const pastDetail = (await req('GET', `/api/v1/tasks/${pastId}`, spvToken)).body.data as { overdue: boolean }
    expect(pastDetail.overdue).toBe(true)
    const futureDetail = (await req('GET', `/api/v1/tasks/${futureId}`, spvToken)).body.data as { overdue: boolean }
    expect(futureDetail.overdue).toBe(false)
    const noDueDetail = (await req('GET', `/api/v1/tasks/${noDueId}`, spvToken)).body.data as { overdue: boolean }
    expect(noDueDetail.overdue).toBe(false)
  })

  it('done/verified/cancelled task with past due_at → overdue=false', async () => {
    const taskId = await createTaskViaApi('Done Past Due', '1970-01-01')
    await req('POST', `/api/v1/tasks/${taskId}/done`, staffToken)

    const { body } = await req('GET', `/api/v1/tasks/${taskId}`, spvToken)
    const data = body.data as { status: string; overdue: boolean }
    expect(data.status).toBe('done')
    expect(data.overdue).toBe(false)

    // Should NOT appear in overdue=true list
    const listRes = await req('GET', `/api/v1/tasks?overdue=true`, spvToken)
    const listData = listRes.body.data as Array<{ id: string }>
    expect(listData.find((t) => t.id === taskId)).toBeUndefined()
  })

  it('WIB boundary: due_to filter is end-of-day WIB', async () => {
    // due_at = 2020-01-01T23:59:59+07:00 = 2020-01-01T16:59:59Z
    // due_to=2020-01-01 means < 2020-01-02T00:00:00+07:00 = 2020-01-01T17:00:00Z
    // Task due_at (16:59:59Z) < filter end (17:00:00Z) → should appear
    const taskId = await createTaskViaApi('WIB Boundary Task', '2020-01-01T23:59:59+07:00')

    const inRange = await req('GET', `/api/v1/tasks?due_to=2020-01-01`, spvToken)
    const inRangeData = inRange.body.data as Array<{ id: string }>
    expect(inRangeData.find((t) => t.id === taskId)).toBeDefined()

    const outOfRange = await req('GET', `/api/v1/tasks?due_from=2020-01-02`, spvToken)
    const outData = outOfRange.body.data as Array<{ id: string }>
    expect(outData.find((t) => t.id === taskId)).toBeUndefined()
  })
})

// ── B8 — Evidence ─────────────────────────────────────────────────────────────

describe('B8 — evidence', () => {
  it('evidence pre-seeded for task appears in GET /tasks/:id', async () => {
    const taskId = await createTaskViaApi('Evidence Task')

    // Insert evidence directly (no R2 available in test env)
    await db.insert(evidence).values({
      companyId: D2_COMPANY,
      outletId: D2_OUTLET_A,
      recordType: 'task',
      recordId: taskId,
      storageKey: `${D2_COMPANY}/${D2_OUTLET_A}/task/${taskId}/test.jpg`,
      fileName: 'test.jpg',
      contentType: 'image/jpeg',
      fileSize: 1024,
      status: 'confirmed',
      uploadedBy: D2_SPV,
    })

    const { status, body } = await req('GET', `/api/v1/tasks/${taskId}`, spvToken)
    expect(status).toBe(200)
    const data = body.data as { id: string; evidence: Array<{ record_type: string; status: string }> }
    expect(data.evidence).toHaveLength(1)
    expect(data.evidence[0].record_type).toBe('task')
    expect(data.evidence[0].status).toBe('confirmed')
  })

  it('verified task → evidence immutable (delete returns 409 ERR_CONFLICT)', async () => {
    const taskId = await createTaskViaApi('Immutable Evidence Task')

    // Pre-seed evidence before verifying
    const [evidenceRow] = await db.insert(evidence).values({
      companyId: D2_COMPANY,
      outletId: D2_OUTLET_A,
      recordType: 'task',
      recordId: taskId,
      storageKey: `${D2_COMPANY}/${D2_OUTLET_A}/task/${taskId}/immutable.jpg`,
      fileName: 'immutable.jpg',
      contentType: 'image/jpeg',
      fileSize: 1024,
      status: 'confirmed',
      uploadedBy: D2_SPV,
    }).returning()

    // Advance to verified
    await req('POST', `/api/v1/tasks/${taskId}/done`, staffToken)
    await req('POST', `/api/v1/tasks/${taskId}/verify`, verifierToken)

    const detail = (await req('GET', `/api/v1/tasks/${taskId}`, spvToken)).body.data as { status: string }
    expect(detail.status).toBe('verified')

    // Try to delete evidence on a verified task → 409 (immutable)
    const deleteRes = await req('DELETE', `/api/v1/evidence/${evidenceRow.id}`, spvToken)
    expect(deleteRes.status).toBe(409)
    expect(deleteRes.body.error.code).toBe('ERR_CONFLICT')
  })
})

// ── B9 (HTTP) — Audit trail ───────────────────────────────────────────────────

describe('B9 HTTP — audit trail', () => {
  it('create → done → verify produces audit rows with correct action strings', async () => {
    const taskId = await createTaskViaApi('Audit Task')
    await req('POST', `/api/v1/tasks/${taskId}/done`, staffToken)
    await req('POST', `/api/v1/tasks/${taskId}/verify`, verifierToken)

    const rows = await db
      .select({ action: auditLogs.action, actorUserId: auditLogs.actorUserId })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.companyId, D2_COMPANY),
          eq(auditLogs.recordType, 'task'),
          eq(auditLogs.recordId, taskId),
        ),
      )
      .orderBy(auditLogs.createdAt)

    const actions = rows.map((r) => r.action)
    expect(actions).toContain('task.create')
    expect(actions).toContain('task.done')
    expect(actions).toContain('task.verify')
    // Exactly 1 row per action
    expect(actions.filter((a) => a === 'task.create')).toHaveLength(1)
    expect(actions.filter((a) => a === 'task.done')).toHaveLength(1)
    expect(actions.filter((a) => a === 'task.verify')).toHaveLength(1)
  })
})

// ── List + filter ─────────────────────────────────────────────────────────────

describe('GET /tasks — list and filter', () => {
  it('filters by status', async () => {
    const openId  = await createTaskViaApi('Open Task')
    const doneId  = await createTaskViaApi('Done Task')
    await req('POST', `/api/v1/tasks/${doneId}/done`, staffToken)

    const { body } = await req('GET', `/api/v1/tasks?status=open`, spvToken)
    const data = body.data as Array<{ id: string; status: string }>
    expect(data.every((t) => t.status === 'open')).toBe(true)
    expect(data.find((t) => t.id === openId)).toBeDefined()
    expect(data.find((t) => t.id === doneId)).toBeUndefined()
  })

  it('filters by assignee_user_id', async () => {
    const taskId = await createTaskViaApi('Assignee Filter Task')
    const { body } = await req('GET', `/api/v1/tasks?assignee_user_id=${D2_STAFF_A}`, spvToken)
    const data = body.data as Array<{ id: string; assignee_user_id: string }>
    expect(data.every((t) => t.assignee_user_id === D2_STAFF_A)).toBe(true)
    expect(data.find((t) => t.id === taskId)).toBeDefined()
  })

  it('filters by outlet_id', async () => {
    const taskId = await createTaskViaApi('Outlet Filter Task')
    const { body } = await req('GET', `/api/v1/tasks?outlet_id=${D2_OUTLET_A}`, spvToken)
    const data = body.data as Array<{ id: string; outlet_id: string }>
    expect(data.every((t) => t.outlet_id === D2_OUTLET_A)).toBe(true)
    expect(data.find((t) => t.id === taskId)).toBeDefined()
  })

  it('pagination meta is correct', async () => {
    // Create 3 tasks
    await Promise.all([
      createTaskViaApi('Page Task 1'),
      createTaskViaApi('Page Task 2'),
      createTaskViaApi('Page Task 3'),
    ])

    const { body } = await req('GET', `/api/v1/tasks?page=1&page_size=2`, spvToken)
    const meta = body.meta as { page: number; page_size: number; total: number }
    expect(meta.page).toBe(1)
    expect(meta.page_size).toBe(2)
    expect(meta.total).toBeGreaterThanOrEqual(3)
    expect((body.data as unknown[]).length).toBe(2)
  })

  it('assignee can see their own tasks regardless of scope', async () => {
    // STAFF_A has outlet scope on OUTLET_A — normal visibility
    const taskId = await createTaskViaApi('Staff Assignee Task')
    const { body } = await req('GET', `/api/v1/tasks`, staffToken)
    const data = body.data as Array<{ id: string }>
    expect(data.find((t) => t.id === taskId)).toBeDefined()
  })
})

// ── B4 / B5 (HTTP) — State machine guards ────────────────────────────────────

describe('state machine guards via HTTP', () => {
  it('SoD: assignee verifying own task → 403 ERR_SELF_APPROVAL', async () => {
    // VERIFIER has task.verify permission; insert task in 'done' state with VERIFIER as assignee
    const taskId = crypto.randomUUID()
    await db.insert(tasks).values({
      id: taskId,
      companyId: D2_COMPANY,
      outletId: D2_OUTLET_A,
      title: 'SoD Task',
      assignerUserId: D2_SPV,
      assigneeUserId: D2_VERIFIER,
      status: 'done',
    })
    // VERIFIER tries to verify their own task
    const { status, body } = await req('POST', `/api/v1/tasks/${taskId}/verify`, verifierToken)
    expect(status).toBe(403)
    expect(body.error.code).toBe('ERR_SELF_APPROVAL')
  })

  it('reject without reason → 422 ERR_VALIDATION', async () => {
    const taskId = await createTaskViaApi('Reject No Reason')
    await req('POST', `/api/v1/tasks/${taskId}/done`, staffToken)
    const { status, body } = await req('POST', `/api/v1/tasks/${taskId}/reject`, verifierToken, { reason: '' })
    expect(status).toBe(422)
    expect(body.error.code).toBe('ERR_VALIDATION')
  })

  it('action on verified task → 409 ERR_CONFLICT', async () => {
    const taskId = await createTaskViaApi('Terminal Task')
    await advanceToState(taskId, 'verified')
    const { status, body } = await req('POST', `/api/v1/tasks/${taskId}/start`, staffToken)
    expect(status).toBe(409)
    expect(body.error.code).toBe('ERR_CONFLICT')
  })

  it('PATCH on in_progress task → 409 ERR_CONFLICT', async () => {
    const taskId = await createTaskViaApi('PATCH Guard Task')
    await req('POST', `/api/v1/tasks/${taskId}/start`, staffToken)
    const { status, body } = await req('PATCH', `/api/v1/tasks/${taskId}`, spvToken, { title: 'New' })
    expect(status).toBe(409)
    expect(body.error.code).toBe('ERR_CONFLICT')
  })
})
