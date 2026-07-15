import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import { auditLogs, brands, companies, outlets, users } from '@egg-os/db'
import type { Db } from './db'
import { auditLog } from './audit'

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema }) as unknown as Db

const COMPANY_ID = '9e000000-0000-4000-8000-000000000001'
const BRAND_ID = '9e000000-0000-4000-8000-000000000002'
const OUTLET_ID = '9e000000-0000-4000-8000-000000000003'
const ACTOR_ID = '9e000000-0000-4000-8000-000000000010'

async function cleanupAll() {
  await sql`DELETE FROM audit_logs WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM users WHERE id = ${ACTOR_ID}`
  await sql`DELETE FROM outlets WHERE id = ${OUTLET_ID}`
  await sql`DELETE FROM brands WHERE id = ${BRAND_ID}`
  await sql`DELETE FROM companies WHERE id = ${COMPANY_ID}`
}

async function seedFixtures() {
  await db.insert(companies).values({
    id: COMPANY_ID,
    companyCode: 'AUDIT9E',
    companyName: 'Audit Test Co 9e',
    status: 'active',
  })
  await db.insert(brands).values({
    id: BRAND_ID,
    companyId: COMPANY_ID,
    brandCode: 'BRD9E',
    brandName: 'Brand 9e',
    status: 'active',
  })
  await db.insert(outlets).values({
    id: OUTLET_ID,
    companyId: COMPANY_ID,
    brandId: BRAND_ID,
    outletCode: 'OUT9E',
    outletName: 'Outlet 9e',
    status: 'active',
  })
  await db.insert(users).values({
    id: ACTOR_ID,
    companyId: COMPANY_ID,
    email: 'audit-actor@9e.test',
    fullName: 'Audit Actor 9e',
    status: 'active',
    firstLoginRequired: false,
  })
}

beforeAll(async () => {
  await cleanupAll()
  await seedFixtures()
})

afterEach(async () => {
  await sql`DELETE FROM audit_logs WHERE company_id = ${COMPANY_ID}`
})

afterAll(async () => {
  await cleanupAll()
  await sql.end()
})

describe('lib/audit — auditLog helper', () => {
  it('insert sukses → baris dengan field benar (action, actor, meta jsonb round-trip)', async () => {
    const meta = { reason: 'test', count: 42 }
    await auditLog(db, { companyId: COMPANY_ID, actorUserId: ACTOR_ID }, {
      action: 'user.login',
      recordType: 'user',
      recordId: ACTOR_ID,
      outletId: OUTLET_ID,
      meta,
      ip: '127.0.0.1',
    })

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('user.login')
    expect(rows[0].actorUserId).toBe(ACTOR_ID)
    expect(rows[0].recordType).toBe('user')
    expect(rows[0].recordId).toBe(ACTOR_ID)
    expect(rows[0].outletId).toBe(OUTLET_ID)
    expect(rows[0].meta).toEqual(meta)
    expect(rows[0].ip).toBe('127.0.0.1')
    expect(rows[0].createdAt).toBeInstanceOf(Date)
  })

  it('actorUserId null path: entry tanpa actor, ctx tanpa actor → actor_user_id NULL', async () => {
    await auditLog(db, { companyId: COMPANY_ID }, { action: 'system.event' })

    const rows = await db.select().from(auditLogs).where(
      and(eq(auditLogs.companyId, COMPANY_ID), eq(auditLogs.action, 'system.event'))
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].actorUserId).toBeNull()
  })

  it('error path: company_id FK violation → throw (tidak ditelan)', async () => {
    const NONEXISTENT = '9e000000-0000-4000-8000-000000000099'
    await expect(
      auditLog(db, { companyId: NONEXISTENT }, { action: 'x' })
    ).rejects.toThrow()
  })

  it('IN TRANSACTION: auditLog gagal → seluruh transaksi rollback (row dummy ikut hilang)', async () => {
    const DUMMY_COMPANY = '9e000000-0000-4000-8000-000000000098'
    let threw = false
    try {
      await (db as ReturnType<typeof drizzle>).transaction(async (tx) => {
        await tx.insert(auditLogs).values({
          companyId: COMPANY_ID,
          action: 'dummy.before.fail',
          actorUserId: null,
        })
        await auditLog(tx as unknown as Db, { companyId: DUMMY_COMPANY }, { action: 'will.fail' })
      })
    } catch {
      threw = true
    }

    expect(threw).toBe(true)
    const rows = await db.select().from(auditLogs).where(
      and(eq(auditLogs.companyId, COMPANY_ID), eq(auditLogs.action, 'dummy.before.fail'))
    )
    expect(rows).toHaveLength(0)
  })
})
