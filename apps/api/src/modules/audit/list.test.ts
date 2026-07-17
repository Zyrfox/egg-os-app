import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { inArray } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  auditLogs,
  brands,
  companies,
  outlets,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@egg-os/db'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import type { TestResponseBody } from '../../test/types'

type AuditInsert = typeof auditLogs.$inferInsert

// UUID prefix: c1 — exclusive to this file (registry: see spec 4B §9)
const COMPANY_ID      = 'c1000000-0000-4000-8000-000000000001'
const BRAND_ID        = 'c1000000-0000-4000-8000-000000000002'
const OUTLET_ID       = 'c1000000-0000-4000-8000-000000000003'
const AUDITOR_USER_ID = 'c1000000-0000-4000-8000-000000000010'
const DIREKSI_USER_ID = 'c1000000-0000-4000-8000-000000000011'
const ITEM_ID         = 'c1000000-0000-4000-8000-000000000040'
const AUDITOR_ROLE_ID = 'c1100000-0000-4000-8000-000000000001'
const DIREKSI_ROLE_ID = 'c1100000-0000-4000-8000-000000000002'

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars'
const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
}

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

let auditorToken = ''
let direksiToken = ''

async function req(
  path: string,
  token?: string,
): Promise<{ status: number; body: TestResponseBody }> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await app.request(`http://localhost${path}`, { method: 'GET', headers }, TEST_ENV)
  return { status: res.status, body: (await res.json()) as TestResponseBody }
}

async function tokenFor(userId: string) {
  return signAccessToken(
    { sub: userId, company_id: COMPANY_ID, roles: [], scopes: [], first_login_required: false },
    TEST_JWT_SECRET,
  )
}

async function cleanupFixtures() {
  await sql`DELETE FROM audit_logs WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM user_roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM role_permissions WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM users WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM outlets WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM brands WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM companies WHERE id = ${COMPANY_ID}`
}

async function insertLogs(rows: Omit<AuditInsert, 'id'>[]) {
  await db.insert(auditLogs).values(rows as AuditInsert[])
}

beforeAll(async () => {
  await cleanupFixtures()

  await db.insert(companies).values({
    id: COMPANY_ID, companyCode: '9DAUDIT', companyName: 'Audit List Test Co', status: 'active',
  })
  await db.insert(brands).values({
    id: BRAND_ID, companyId: COMPANY_ID, brandCode: 'BRD9D', brandName: 'Brand 9D', status: 'active',
  })
  await db.insert(outlets).values({
    id: OUTLET_ID, companyId: COMPANY_ID, brandId: BRAND_ID,
    outletCode: 'OUT9D', outletName: 'Outlet 9D', status: 'active',
  })
  await db.insert(users).values([
    {
      id: AUDITOR_USER_ID, companyId: COMPANY_ID, email: 'auditor@c1.test',
      fullName: 'Auditor 9D', status: 'active', firstLoginRequired: false,
    },
    {
      id: DIREKSI_USER_ID, companyId: COMPANY_ID, email: 'direksi@c1.test',
      fullName: 'Direksi 9D', status: 'active', firstLoginRequired: false,
    },
  ])

  // Ensure audit.read permission exists
  await db.insert(permissions).values({
    code: 'audit.read', module: 'audit', action: 'read', description: 'Read audit logs',
  }).onConflictDoNothing()

  const [auditReadRow] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.code, ['audit.read']))

  // AUDITOR role: has audit.read
  await db.insert(roles).values({
    id: AUDITOR_ROLE_ID, companyId: COMPANY_ID, code: 'AUDITOR_9D',
    name: 'Auditor 9D', description: 'Test auditor', defaultScopeType: 'global', isSystem: false,
  })
  await db.insert(rolePermissions).values({
    roleId: AUDITOR_ROLE_ID, permissionId: auditReadRow.id, companyId: COMPANY_ID,
  }).onConflictDoNothing()
  await db.insert(userRoles).values({
    userId: AUDITOR_USER_ID, roleId: AUDITOR_ROLE_ID, companyId: COMPANY_ID,
    scopeType: 'global', scopeId: null, grantedBy: AUDITOR_USER_ID,
  }).onConflictDoNothing()

  // DIREKSI role: no audit.read
  await db.insert(roles).values({
    id: DIREKSI_ROLE_ID, companyId: COMPANY_ID, code: 'DIREKSI_9D',
    name: 'Direksi 9D', description: 'Test direksi no audit', defaultScopeType: 'global', isSystem: false,
  })
  await db.insert(userRoles).values({
    userId: DIREKSI_USER_ID, roleId: DIREKSI_ROLE_ID, companyId: COMPANY_ID,
    scopeType: 'global', scopeId: null, grantedBy: DIREKSI_USER_ID,
  }).onConflictDoNothing()

  auditorToken = await tokenFor(AUDITOR_USER_ID)
  direksiToken = await tokenFor(DIREKSI_USER_ID)
})

beforeEach(async () => {
  await sql`DELETE FROM audit_logs WHERE company_id = ${COMPANY_ID}`
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

// ── A6: permission guards ─────────────────────────────────────────────────────

describe('AUDIT 4B L4 — A6: permission guards', () => {
  it('tanpa Bearer → 401', async () => {
    const { status, body } = await req('/api/v1/audit-logs')
    expect(status).toBe(401)
    expect(body.success).toBe(false)
  })

  it('DIREKSI (no audit.read) → 403', async () => {
    const { status, body } = await req('/api/v1/audit-logs', direksiToken)
    expect(status).toBe(403)
    expect(body.success).toBe(false)
  })

  it('AUDITOR (audit.read) → 200, empty data', async () => {
    const { status, body } = await req('/api/v1/audit-logs', auditorToken)
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray((body as Record<string, unknown>).data)).toBe(true)
  })
})

// ── A5: filter + pagination ───────────────────────────────────────────────────

describe('AUDIT 4B L4 — A5: filter, pagination, order', () => {
  it('tanpa filter → semua baris company, order DESC', async () => {
    const base = new Date('2026-05-01T10:00:00Z')
    await insertLogs([
      { companyId: COMPANY_ID, action: 'users.create', createdAt: new Date(base.getTime()) },
      { companyId: COMPANY_ID, action: 'users.update', createdAt: new Date(base.getTime() + 1000) },
      { companyId: COMPANY_ID, action: 'rbac.role_create', createdAt: new Date(base.getTime() + 2000) },
    ])

    const { status, body } = await req(`/api/v1/audit-logs`, auditorToken)
    expect(status).toBe(200)
    const b = body as { success: boolean; data: { action: string; created_at: string }[]; meta: { page: number; page_size: number; total: number } }
    expect(b.data).toHaveLength(3)
    expect(b.meta.total).toBe(3)
    // ORDER DESC: latest first
    expect(b.data[0].action).toBe('rbac.role_create')
    expect(b.data[1].action).toBe('users.update')
    expect(b.data[2].action).toBe('users.create')
  })

  it('filter action → hanya baris dengan action itu', async () => {
    await sql`
      INSERT INTO audit_logs (company_id, action) VALUES
      (${COMPANY_ID}, 'report.submit'),
      (${COMPANY_ID}, 'report.submit'),
      (${COMPANY_ID}, 'report.validate')
    `

    const { status, body } = await req(
      `/api/v1/audit-logs?action=report.submit`,
      auditorToken,
    )
    expect(status).toBe(200)
    const b = body as { data: { action: string }[]; meta: { total: number } }
    expect(b.meta.total).toBe(2)
    expect(b.data.every((r) => r.action === 'report.submit')).toBe(true)
  })

  it('filter record_type + record_id → hanya baris pasangan itu', async () => {
    await sql`
      INSERT INTO audit_logs (company_id, action, record_type, record_id) VALUES
      (${COMPANY_ID}, 'inventory.stock_in', 'stock_movement', ${ITEM_ID}),
      (${COMPANY_ID}, 'inventory.stock_in', 'stock_movement', ${'c1000000-0000-4000-8000-000000000099'}),
      (${COMPANY_ID}, 'report.submit', 'daily_report', ${ITEM_ID})
    `

    const { status, body } = await req(
      `/api/v1/audit-logs?record_type=stock_movement&record_id=${ITEM_ID}`,
      auditorToken,
    )
    expect(status).toBe(200)
    const b = body as { data: { record_type: string; record_id: string }[]; meta: { total: number } }
    expect(b.meta.total).toBe(1)
    expect(b.data[0].record_type).toBe('stock_movement')
    expect(b.data[0].record_id).toBe(ITEM_ID)
  })

  it('pagination: page_size + total benar, page 2 dapat baris berikutnya', async () => {
    // Insert 5 rows
    await sql`
      INSERT INTO audit_logs (company_id, action) VALUES
      (${COMPANY_ID}, 'users.create'),
      (${COMPANY_ID}, 'users.update'),
      (${COMPANY_ID}, 'users.suspend'),
      (${COMPANY_ID}, 'users.archive'),
      (${COMPANY_ID}, 'rbac.role_create')
    `

    const page1 = await req(`/api/v1/audit-logs?page=1&page_size=3`, auditorToken)
    expect(page1.status).toBe(200)
    const b1 = page1.body as { data: unknown[]; meta: { page: number; page_size: number; total: number } }
    expect(b1.meta.page).toBe(1)
    expect(b1.meta.page_size).toBe(3)
    expect(b1.meta.total).toBe(5)
    expect(b1.data).toHaveLength(3)

    const page2 = await req(`/api/v1/audit-logs?page=2&page_size=3`, auditorToken)
    expect(page2.status).toBe(200)
    const b2 = page2.body as { data: unknown[]; meta: { total: number } }
    expect(b2.data).toHaveLength(2)
    expect(b2.meta.total).toBe(5)
  })

  it('filter date range WIB: boundary hari — log tepat di 23:59:59 WIB masuk ke hari yang benar', async () => {
    // Timestamps in WIB (UTC+7):
    // T1 = 2026-06-14 23:59:59 WIB = 2026-06-14 16:59:59 UTC — hari 14
    // T2 = 2026-06-15 00:00:00 WIB = 2026-06-14 17:00:00 UTC — hari 15 (tepat batas bawah)
    // T3 = 2026-06-15 23:59:59 WIB = 2026-06-15 16:59:59 UTC — hari 15 (tepat batas atas)
    // T4 = 2026-06-16 00:00:00 WIB = 2026-06-15 17:00:00 UTC — hari 16
    const T1 = new Date('2026-06-14T16:59:59Z')  // WIB hari-14 23:59:59
    const T2 = new Date('2026-06-14T17:00:00Z')  // WIB hari-15 00:00:00
    const T3 = new Date('2026-06-15T16:59:59Z')  // WIB hari-15 23:59:59
    const T4 = new Date('2026-06-15T17:00:00Z')  // WIB hari-16 00:00:00

    await insertLogs([
      { companyId: COMPANY_ID, action: 'users.create', createdAt: T1 },
      { companyId: COMPANY_ID, action: 'users.update', createdAt: T2 },
      { companyId: COMPANY_ID, action: 'users.suspend', createdAt: T3 },
      { companyId: COMPANY_ID, action: 'users.archive', createdAt: T4 },
    ])

    // date_from=2026-06-15 & date_to=2026-06-15 → hanya T2 dan T3
    const { status, body } = await req(
      `/api/v1/audit-logs?date_from=2026-06-15&date_to=2026-06-15`,
      auditorToken,
    )
    expect(status).toBe(200)
    const b = body as { data: { action: string }[]; meta: { total: number } }
    expect(b.meta.total).toBe(2)
    const actions = b.data.map((r) => r.action).sort()
    expect(actions).toContain('users.update')
    expect(actions).toContain('users.suspend')
    expect(actions).not.toContain('users.create')
    expect(actions).not.toContain('users.archive')
  })

  it('filter date_to saja: log di tepi akhir hari WIB masuk', async () => {
    const T_last  = new Date('2026-07-10T16:59:59Z')  // WIB 2026-07-10 23:59:59 — masuk
    const T_next  = new Date('2026-07-10T17:00:00Z')  // WIB 2026-07-11 00:00:00 — tidak masuk

    await insertLogs([
      { companyId: COMPANY_ID, action: 'evidence.confirm', createdAt: T_last },
      { companyId: COMPANY_ID, action: 'evidence.delete', createdAt: T_next },
    ])

    const { body } = await req(`/api/v1/audit-logs?date_to=2026-07-10`, auditorToken)
    const b = body as { data: { action: string }[]; meta: { total: number } }
    expect(b.meta.total).toBe(1)
    expect(b.data[0].action).toBe('evidence.confirm')
  })

  it('kombinasi filter action + date range → interseksi, bukan union', async () => {
    const inRange = new Date('2026-08-01T05:00:00Z')  // WIB 2026-08-01 12:00:00
    const outRange = new Date('2026-08-02T05:00:00Z') // WIB 2026-08-02 12:00:00

    await insertLogs([
      { companyId: COMPANY_ID, action: 'report.submit', createdAt: inRange },
      { companyId: COMPANY_ID, action: 'report.submit', createdAt: outRange },
      { companyId: COMPANY_ID, action: 'report.validate', createdAt: inRange },
    ])

    const { body } = await req(
      `/api/v1/audit-logs?action=report.submit&date_from=2026-08-01&date_to=2026-08-01`,
      auditorToken,
    )
    const b = body as { data: { action: string }[]; meta: { total: number } }
    expect(b.meta.total).toBe(1)
    expect(b.data[0].action).toBe('report.submit')
  })

  it('page_size default = 20', async () => {
    const { body } = await req(`/api/v1/audit-logs`, auditorToken)
    const b = body as { meta: { page_size: number } }
    expect(b.meta.page_size).toBe(20)
  })

  it('page_size max 100 — 101 ditolak 422', async () => {
    const { status } = await req(`/api/v1/audit-logs?page_size=101`, auditorToken)
    expect(status).toBe(422)
  })
})
