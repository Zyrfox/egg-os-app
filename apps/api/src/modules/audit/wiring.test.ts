import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  auditLogs,
  brands,
  companies,
  outlets,
  passwordTokens,
  permissions,
  refreshTokens,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@egg-os/db'
import app from '../../index'
import { updateUser, resetPasswordForUser } from '../users/service'
import { createRole } from '../rbac/service'
import { auditLog } from '../../lib/audit'
import { hashPassword, generateToken, hashToken } from '../../lib/crypto'
import type { Db } from '../../lib/db'

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars'
const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
}

const COMPANY_ID = '9f000000-0000-4000-8000-000000000001'
const BRAND_ID = '9f000000-0000-4000-8000-000000000002'
const OUTLET_ID = '9f000000-0000-4000-8000-000000000003'
const ACTOR_ID = '9f000000-0000-4000-8000-000000000010'
const TARGET_ID = '9f000000-0000-4000-8000-000000000011'
const LOGIN_USER_ID = '9f000000-0000-4000-8000-000000000012'
const TEST_ROLE_ID = '9f000000-0000-4000-8000-000000000020'

const LOGIN_PASSWORD = 'Test#1234'
const LOGIN_EMAIL = 'wiring-login@9f.test'

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema }) as unknown as Db

async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }
  const res = await app.request(`http://localhost${path}`, init, TEST_ENV)
  const json = await res.json()
  return { status: res.status, body: json as Record<string, unknown> }
}

async function cleanupAll() {
  await sql`DELETE FROM user_roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM role_permissions WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM password_tokens WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM refresh_tokens WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM auth_events WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM audit_logs WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM users WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM outlets WHERE id = ${OUTLET_ID}`
  await sql`DELETE FROM brands WHERE id = ${BRAND_ID}`
  await sql`DELETE FROM companies WHERE id = ${COMPANY_ID}`
}

beforeAll(async () => {
  await cleanupAll()

  await db.insert(companies).values({
    id: COMPANY_ID,
    companyCode: 'WIRE9F',
    companyName: 'Wiring Test Co 9f',
    status: 'active',
  })
  await db.insert(brands).values({
    id: BRAND_ID,
    companyId: COMPANY_ID,
    brandCode: 'BRD9F',
    brandName: 'Brand 9f',
    status: 'active',
  })
  await db.insert(outlets).values({
    id: OUTLET_ID,
    companyId: COMPANY_ID,
    brandId: BRAND_ID,
    outletCode: 'OUT9F',
    outletName: 'Outlet 9f',
    status: 'active',
  })

  await db.insert(users).values({
    id: LOGIN_USER_ID,
    companyId: COMPANY_ID,
    email: LOGIN_EMAIL,
    fullName: 'Wiring Login User',
    passwordHash: hashPassword(LOGIN_PASSWORD),
    status: 'active',
    firstLoginRequired: false,
  })
  await db.insert(users).values({
    id: ACTOR_ID,
    companyId: COMPANY_ID,
    email: 'wiring-actor@9f.test',
    fullName: 'Wiring Actor',
    status: 'active',
    firstLoginRequired: false,
  })
  await db.insert(users).values({
    id: TARGET_ID,
    companyId: COMPANY_ID,
    email: 'wiring-target@9f.test',
    fullName: 'Wiring Target',
    status: 'active',
    firstLoginRequired: false,
  })

  // WIRING_ADMIN role — not system (so createRole tests can also delete it later)
  await db.insert(roles).values({
    id: TEST_ROLE_ID,
    companyId: COMPANY_ID,
    code: 'WIRING_ADMIN',
    name: 'Wiring Test Admin',
    description: 'Test role for wiring tests',
    defaultScopeType: 'global',
    isSystem: false,
  })

  // Wire up all permissions the actor needs for service tests
  const permsNeeded = [
    'users.update', 'users.suspend', 'users.archive',
    'rbac.role_assign', 'rbac.role_create', 'rbac.role_update',
    'rbac.role_delete', 'rbac.role_permissions_set', 'rbac.override_manage',
  ]
  const permRows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, permsNeeded))

  if (permRows.length > 0) {
    await db.insert(rolePermissions).values(
      permRows.map((p) => ({ roleId: TEST_ROLE_ID, permissionId: p.id, companyId: COMPANY_ID }))
    ).onConflictDoNothing()
  }

  await db.insert(userRoles).values({
    userId: ACTOR_ID,
    roleId: TEST_ROLE_ID,
    companyId: COMPANY_ID,
    scopeType: 'global',
    scopeId: null,
    grantedBy: ACTOR_ID,
  }).onConflictDoNothing()
})

afterEach(async () => {
  await sql`DELETE FROM audit_logs WHERE company_id = ${COMPANY_ID}`
})

afterAll(async () => {
  await cleanupAll()
  await sql.end()
})

const ctx = { companyId: COMPANY_ID, actorUserId: ACTOR_ID }

describe('AUDIT 4B L2 — wiring smoke tests', () => {
  // ── A1: login sukses ──────────────────────────────────────────────────────────
  it('login sukses → 1 baris auth.login, actorUserId benar, meta.email ada', async () => {
    const res = await req('POST', '/api/v1/auth/login', { email: LOGIN_EMAIL, password: LOGIN_PASSWORD })
    expect(res.status).toBe(200)

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('auth.login')
    expect(rows[0].actorUserId).toBe(LOGIN_USER_ID)
    expect(rows[0].recordType).toBe('user')
    expect(rows[0].recordId).toBe(LOGIN_USER_ID)
    expect((rows[0].meta as Record<string, unknown>)?.email).toBe(LOGIN_EMAIL)
  })

  // ── A3: login_failed — dua varian ────────────────────────────────────────────
  it('login user tak dikenal → NOL baris audit_logs (skip — no companyId)', async () => {
    await req('POST', '/api/v1/auth/login', { email: 'nobody@9f.test', password: 'whatever' })
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(0)
  })

  it('login password salah → 1 baris auth.login_failed, actorUserId=user.id, meta.email ada', async () => {
    const res = await req('POST', '/api/v1/auth/login', { email: LOGIN_EMAIL, password: 'wrong#Pass99' })
    expect(res.status).toBe(401)

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('auth.login_failed')
    expect(rows[0].actorUserId).toBe(LOGIN_USER_ID)
    expect((rows[0].meta as Record<string, unknown>)?.email).toBe(LOGIN_EMAIL)
  })

  // ── A1: users.update ─────────────────────────────────────────────────────────
  it('users.update → 1 baris audit, meta.changed_fields ada, TANPA password/hash', async () => {
    await updateUser(db, ctx, TARGET_ID, { full_name: 'Updated Name' })

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('users.update')
    expect(rows[0].actorUserId).toBe(ACTOR_ID)
    const meta = rows[0].meta as Record<string, unknown>
    expect(meta?.changed_fields).toContain('full_name')
    const metaStr = JSON.stringify(meta)
    expect(metaStr).not.toMatch(/password/i)
    expect(metaStr).not.toMatch(/hash/i)
  })

  // ── A1: rbac.role_create ─────────────────────────────────────────────────────
  it('rbac.role_create → 1 baris audit dengan role.id sebagai record_id', async () => {
    const role = await createRole(db, COMPANY_ID, {
      code: 'WIRE_CUSTOM',
      name: 'Wiring Custom',
      description: 'test',
      default_scope_type: 'outlet',
    })

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('rbac.role_create')
    expect(rows[0].recordType).toBe('role')
    expect(rows[0].recordId).toBe(role.id)
    expect((rows[0].meta as Record<string, unknown>)?.code).toBe('WIRE_CUSTOM')
  })

  // ── A9: password tidak bocor ke meta ─────────────────────────────────────────
  it('users.password_reset meta TIDAK mengandung token/hash substring', async () => {
    await resetPasswordForUser(db, ctx, TARGET_ID)

    const rows = await db.select().from(auditLogs).where(
      and(eq(auditLogs.companyId, COMPANY_ID), eq(auditLogs.action, 'users.password_reset'))
    )
    expect(rows).toHaveLength(1)
    const metaStr = JSON.stringify(rows[0].meta)
    expect(metaStr).not.toMatch(/token/i)
    expect(metaStr).not.toMatch(/hash/i)
    expect(metaStr).not.toMatch(/password/i)
  })

  it('auth.password_changed meta TIDAK mengandung password substring', async () => {
    const rawToken = generateToken()
    const tHash = hashToken(rawToken)
    await db.insert(passwordTokens).values({
      userId: LOGIN_USER_ID,
      companyId: COMPANY_ID,
      tokenHash: tHash,
      type: 'set_password',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    })

    const res = await req('POST', '/api/v1/auth/set-password', { token: rawToken, new_password: 'New#Pass99' })
    expect(res.status).toBe(200)

    const rows = await db.select().from(auditLogs).where(
      and(eq(auditLogs.companyId, COMPANY_ID), eq(auditLogs.action, 'auth.password_changed'))
    )
    expect(rows).toHaveLength(1)
    const metaStr = JSON.stringify(rows[0].meta)
    expect(metaStr).not.toMatch(/new_password/i)
    expect(metaStr).not.toMatch(/password_hash/i)
    expect(metaStr).not.toMatch(/token_hash/i)
  })

  // ── Noise-gate: /refresh tidak dilog ─────────────────────────────────────────
  it('POST /auth/refresh → NOL baris audit_logs baru', async () => {
    const rawRefresh = generateToken()
    const refreshHash = hashToken(rawRefresh)
    await db.insert(refreshTokens).values({
      userId: LOGIN_USER_ID,
      companyId: COMPANY_ID,
      tokenHash: refreshHash,
      expiresAt: new Date(Date.now() + 3600 * 1000),
    })

    const res = await req('POST', '/api/v1/auth/refresh', { refresh_token: rawRefresh })
    expect(res.status).toBe(200)

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(0)
  })

  // ── A2: rollback wiring proof ─────────────────────────────────────────────────
  it('rbac.role_create + forced auditLog failure → role TIDAK terbuat (rollback)', async () => {
    const NONEXISTENT = '9f000000-0000-4000-8000-000000000099'
    const BAD_CODE = 'WIRE_ROLLBACK'

    let threw = false
    try {
      await (db as ReturnType<typeof drizzle>).transaction(async (tx) => {
        const txDb = tx as unknown as Db
        await txDb.insert(roles).values({
          companyId: COMPANY_ID,
          code: BAD_CODE,
          name: 'Rollback Test',
          description: 'should not exist',
          defaultScopeType: 'outlet',
        })
        await auditLog(txDb, { companyId: NONEXISTENT }, { action: 'rbac.role_create' })
      })
    } catch {
      threw = true
    }

    expect(threw).toBe(true)
    const roleRows = await db
      .select()
      .from(roles)
      .where(and(eq(roles.companyId, COMPANY_ID), eq(roles.code, BAD_CODE)))
    expect(roleRows).toHaveLength(0)
  })
})
