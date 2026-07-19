import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, count, eq } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  auditLogs,
  brands,
  companies,
  outlets,
  roles,
  tasks,
  userRoles,
  users,
} from '@egg-os/db'
import type { Db } from '../../lib/db'
import type { AccessFilter } from '../rbac/middleware'
import {
  cancelTask,
  createTask,
  doneTask,
  rejectTask,
  startTask,
  TaskServiceError,
  updateTask,
  verifyTask,
  type TaskServiceContext,
} from './service'

// UUID prefix d1* — registered in docs/EGG_OS_AUDIT_4B_SPEC_BUILDABLE_v0_1.md §9
const D1_COMPANY  = 'd1000000-0000-4000-8000-000000000001'
const D1_BRAND    = 'd1000000-0000-4000-8000-000000000002'
const D1_OUTLET_A = 'd1000000-0000-4000-8000-000000000003'
const D1_OUTLET_B = 'd1000000-0000-4000-8000-000000000004'
const D1_SPV      = 'd1000000-0000-4000-8000-000000000010'  // assigner, outlet A
const D1_STAFF_A  = 'd1000000-0000-4000-8000-000000000011'  // assignee valid, outlet A
const D1_STAFF_B  = 'd1000000-0000-4000-8000-000000000012'  // assignee out-of-scope (outlet B only)
const D1_VERIFIER = 'd1000000-0000-4000-8000-000000000013'  // verifier, outlet A
const D1_ROLE     = 'd1000000-0000-4000-8000-000000000020'  // test role

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema }) as unknown as Db

function accessFilter(permission: string, outletId = D1_OUTLET_A): AccessFilter {
  return {
    permission,
    ownOnly: false,
    assignedOnly: false,
    rowLevelScopes: [],
    structuralScopes: [{ scopeType: 'outlet', scopeId: outletId }],
  }
}

function spvCtx(outletId = D1_OUTLET_A): TaskServiceContext {
  return {
    companyId: D1_COMPANY,
    actorUserId: D1_SPV,
    accessFilter: accessFilter('task.create', outletId),
  }
}

function staffCtx(userId: string, outletId = D1_OUTLET_A): TaskServiceContext {
  return {
    companyId: D1_COMPANY,
    actorUserId: userId,
    accessFilter: accessFilter('task.update_own', outletId),
  }
}

function verifierCtx(outletId = D1_OUTLET_A): TaskServiceContext {
  return {
    companyId: D1_COMPANY,
    actorUserId: D1_VERIFIER,
    accessFilter: accessFilter('task.verify', outletId),
  }
}

async function cleanupFixtures() {
  await sql`DELETE FROM audit_logs WHERE company_id = ${D1_COMPANY}`
  await sql`DELETE FROM tasks WHERE company_id = ${D1_COMPANY}`
  await sql`DELETE FROM user_roles WHERE company_id = ${D1_COMPANY}`
  await sql`DELETE FROM role_permissions WHERE company_id = ${D1_COMPANY}`
  await sql`DELETE FROM roles WHERE company_id = ${D1_COMPANY}`
  await sql`DELETE FROM users WHERE company_id = ${D1_COMPANY}`
  await sql`DELETE FROM outlets WHERE company_id = ${D1_COMPANY}`
  await sql`DELETE FROM brands WHERE company_id = ${D1_COMPANY}`
  await sql`DELETE FROM companies WHERE id = ${D1_COMPANY}`
}

async function seedFixtures() {
  await db.insert(companies).values({
    id: D1_COMPANY,
    companyCode: 'TASK-SVC',
    companyName: 'Task Service Company',
    status: 'active',
  })

  await db.insert(brands).values({
    id: D1_BRAND,
    companyId: D1_COMPANY,
    brandCode: 'TASK-BRAND',
    brandName: 'Task Brand',
    status: 'active',
  })

  await db.insert(outlets).values([
    {
      id: D1_OUTLET_A,
      companyId: D1_COMPANY,
      brandId: D1_BRAND,
      outletCode: 'TASK-A',
      outletName: 'Task Outlet A',
      status: 'active',
    },
    {
      id: D1_OUTLET_B,
      companyId: D1_COMPANY,
      brandId: D1_BRAND,
      outletCode: 'TASK-B',
      outletName: 'Task Outlet B',
      status: 'active',
    },
  ])

  await db.insert(users).values([
    {
      id: D1_SPV,
      companyId: D1_COMPANY,
      email: 'task-spv@egg.test',
      fullName: 'Task SPV',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: D1_STAFF_A,
      companyId: D1_COMPANY,
      email: 'task-staff-a@egg.test',
      fullName: 'Task Staff A',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: D1_STAFF_B,
      companyId: D1_COMPANY,
      email: 'task-staff-b@egg.test',
      fullName: 'Task Staff B',
      status: 'active',
      firstLoginRequired: false,
    },
    {
      id: D1_VERIFIER,
      companyId: D1_COMPANY,
      email: 'task-verifier@egg.test',
      fullName: 'Task Verifier',
      status: 'active',
      firstLoginRequired: false,
    },
  ])

  await db.insert(roles).values({
    id: D1_ROLE,
    companyId: D1_COMPANY,
    code: 'TASK_TEST_ROLE',
    name: 'Task Test Role',
    description: 'Role for task service tests',
    defaultScopeType: 'outlet',
    isSystem: false,
  })

  // D1_SPV and D1_STAFF_A at outlet A; D1_STAFF_B at outlet B only; D1_VERIFIER at outlet A
  await db.insert(userRoles).values([
    {
      userId: D1_SPV,
      roleId: D1_ROLE,
      companyId: D1_COMPANY,
      scopeType: 'outlet',
      scopeId: D1_OUTLET_A,
    },
    {
      userId: D1_STAFF_A,
      roleId: D1_ROLE,
      companyId: D1_COMPANY,
      scopeType: 'outlet',
      scopeId: D1_OUTLET_A,
    },
    {
      userId: D1_STAFF_B,
      roleId: D1_ROLE,
      companyId: D1_COMPANY,
      scopeType: 'outlet',
      scopeId: D1_OUTLET_B,
    },
    {
      userId: D1_VERIFIER,
      roleId: D1_ROLE,
      companyId: D1_COMPANY,
      scopeType: 'outlet',
      scopeId: D1_OUTLET_A,
    },
  ])
}

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
})

beforeEach(async () => {
  await sql`DELETE FROM audit_logs WHERE company_id = ${D1_COMPANY}`
  await sql`DELETE FROM tasks WHERE company_id = ${D1_COMPANY}`
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

// ── B1: Scope checks ──────────────────────────────────────────────────────────

describe('B1: create scope', () => {
  it('B1a: creates task with in-scope assignee', async () => {
    const task = await createTask(db, spvCtx(), {
      outletId: D1_OUTLET_A,
      assigneeUserId: D1_STAFF_A,
      title: 'Test Task B1a',
    })

    expect(task.status).toBe('open')
    expect(task.assignerUserId).toBe(D1_SPV)
    expect(task.assigneeUserId).toBe(D1_STAFF_A)
    expect(task.companyId).toBe(D1_COMPANY)
  })

  it('B1b: rejects out-of-scope assignee (outlet B only) with 404', async () => {
    await expect(
      createTask(db, spvCtx(), {
        outletId: D1_OUTLET_A,
        assigneeUserId: D1_STAFF_B,
        title: 'Test Task B1b',
      })
    ).rejects.toMatchObject({ status: 404, code: 'ERR_OUT_OF_SCOPE' })
  })

  it('B1c: rejects out-of-scope outlet with 404', async () => {
    // SPV scope is outlet A only; outlet B is out of scope
    await expect(
      createTask(db, spvCtx(D1_OUTLET_B), {
        outletId: D1_OUTLET_B,
        assigneeUserId: D1_STAFF_A,
        title: 'Test Task B1c',
      })
    ).rejects.toMatchObject({ status: 404, code: 'ERR_OUT_OF_SCOPE' })
  })
})

// ── B2: SoD verify ───────────────────────────────────────────────────────────

describe('B2: SoD verify', () => {
  it('B2: assignee cannot verify own task, status stays done', async () => {
    const task = await createTask(db, spvCtx(), {
      outletId: D1_OUTLET_A,
      assigneeUserId: D1_STAFF_A,
      title: 'Test Task B2',
    })

    await doneTask(db, staffCtx(D1_STAFF_A), task.id)

    await expect(
      verifyTask(db, staffCtx(D1_STAFF_A), task.id)
    ).rejects.toMatchObject({ status: 403, code: 'ERR_SELF_APPROVAL' })

    // Status must remain 'done' — transaction rolled back
    const [current] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, task.id))
    expect(current.status).toBe('done')
  })
})

// ── B3: Self-assignment ───────────────────────────────────────────────────────

describe('B3: self-assignment', () => {
  it('B3: rejects create with assignee == actor (422)', async () => {
    await expect(
      createTask(db, spvCtx(), {
        outletId: D1_OUTLET_A,
        assigneeUserId: D1_SPV,
        title: 'Test Task B3 self',
      })
    ).rejects.toMatchObject({ status: 422, code: 'ERR_VALIDATION' })
  })
})

// ── B4: Terminal state + illegal transitions ──────────────────────────────────

describe('B4: terminal states and illegal transitions', () => {
  it('B4a: verifyTask on open task → 409', async () => {
    const task = await createTask(db, spvCtx(), {
      outletId: D1_OUTLET_A,
      assigneeUserId: D1_STAFF_A,
      title: 'Test Task B4a',
    })

    await expect(
      verifyTask(db, verifierCtx(), task.id)
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
  })

  it('B4b: action on verified task → 409', async () => {
    const task = await createTask(db, spvCtx(), {
      outletId: D1_OUTLET_A,
      assigneeUserId: D1_STAFF_A,
      title: 'Test Task B4b',
    })
    await doneTask(db, staffCtx(D1_STAFF_A), task.id)
    await verifyTask(db, verifierCtx(), task.id)

    await expect(
      startTask(db, staffCtx(D1_STAFF_A), task.id)
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
  })

  it('B4c: action on cancelled task → 409', async () => {
    const task = await createTask(db, spvCtx(), {
      outletId: D1_OUTLET_A,
      assigneeUserId: D1_STAFF_A,
      title: 'Test Task B4c',
    })
    await cancelTask(db, spvCtx(), task.id)

    await expect(
      doneTask(db, staffCtx(D1_STAFF_A), task.id)
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
  })
})

// ── B5: Reject flow ───────────────────────────────────────────────────────────

describe('B5: reject flow', () => {
  it('B5a: rejectTask with empty reason → 422', async () => {
    const task = await createTask(db, spvCtx(), {
      outletId: D1_OUTLET_A,
      assigneeUserId: D1_STAFF_A,
      title: 'Test Task B5a',
    })
    await doneTask(db, staffCtx(D1_STAFF_A), task.id)

    await expect(
      rejectTask(db, verifierCtx(), task.id, '')
    ).rejects.toMatchObject({ status: 422, code: 'ERR_VALIDATION' })
  })

  it('B5b: full cycle — create → done → reject → done(revisi) → verify', async () => {
    const task = await createTask(db, spvCtx(), {
      outletId: D1_OUTLET_A,
      assigneeUserId: D1_STAFF_A,
      title: 'Test Task B5b full cycle',
    })
    expect(task.status).toBe('open')

    const done1 = await doneTask(db, staffCtx(D1_STAFF_A), task.id)
    expect(done1.status).toBe('done')
    expect(done1.doneAt).not.toBeNull()

    const rejected = await rejectTask(db, verifierCtx(), task.id, 'Perlu perbaikan')
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectReason).toBe('Perlu perbaikan')

    const done2 = await doneTask(db, staffCtx(D1_STAFF_A), task.id)
    expect(done2.status).toBe('done')

    const verified = await verifyTask(db, verifierCtx(), task.id)
    expect(verified.status).toBe('verified')
    expect(verified.verifiedAt).not.toBeNull()
    expect(verified.verifiedBy).toBe(D1_VERIFIER)
  })
})

// ── B9: Audit trail ───────────────────────────────────────────────────────────

describe('B9: audit trail — 1 row per action', () => {
  async function auditCount(taskId: string, action: string) {
    const [row] = await db
      .select({ n: count() })
      .from(auditLogs)
      .where(and(eq(auditLogs.companyId, D1_COMPANY), eq(auditLogs.recordId, taskId), eq(auditLogs.action, action)))
    return Number(row.n)
  }

  it('B9: each action writes exactly 1 audit row', async () => {
    const task = await createTask(db, spvCtx(), {
      outletId: D1_OUTLET_A,
      assigneeUserId: D1_STAFF_A,
      title: 'Test Task B9',
    })
    expect(await auditCount(task.id, 'task.create')).toBe(1)

    await doneTask(db, staffCtx(D1_STAFF_A), task.id)
    expect(await auditCount(task.id, 'task.done')).toBe(1)

    await rejectTask(db, verifierCtx(), task.id, 'B9 reject')
    expect(await auditCount(task.id, 'task.reject')).toBe(1)

    await doneTask(db, staffCtx(D1_STAFF_A), task.id)

    await verifyTask(db, verifierCtx(), task.id)
    expect(await auditCount(task.id, 'task.verify')).toBe(1)

    // Cancel test on a separate task
    const task2 = await createTask(db, spvCtx(), {
      outletId: D1_OUTLET_A,
      assigneeUserId: D1_STAFF_A,
      title: 'Test Task B9 cancel',
    })
    await cancelTask(db, spvCtx(), task2.id)
    expect(await auditCount(task2.id, 'task.cancel')).toBe(1)
  })
})

// ── B10: PATCH constraints ────────────────────────────────────────────────────

describe('B10: updateTask constraints', () => {
  it('B10a: PATCH non-open task → 409', async () => {
    const task = await createTask(db, spvCtx(), {
      outletId: D1_OUTLET_A,
      assigneeUserId: D1_STAFF_A,
      title: 'Test Task B10a',
    })
    await startTask(db, staffCtx(D1_STAFF_A), task.id)

    await expect(
      updateTask(db, spvCtx(), task.id, { title: 'Updated' })
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
  })

  it('B10b: PATCH by non-assigner → 403', async () => {
    const task = await createTask(db, spvCtx(), {
      outletId: D1_OUTLET_A,
      assigneeUserId: D1_STAFF_A,
      title: 'Test Task B10b',
    })

    await expect(
      updateTask(db, staffCtx(D1_STAFF_A), task.id, { title: 'Updated by staff' })
    ).rejects.toMatchObject({ status: 403, code: 'ERR_FORBIDDEN' })
  })
})
