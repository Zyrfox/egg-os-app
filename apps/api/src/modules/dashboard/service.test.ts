import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  dailyReports,
  evidence,
  items,
  outlets,
  pendingStockMovements,
  stockBalances,
  stockMovements,
  units,
  users,
} from '@egg-os/db'
import type { Db } from '../../lib/db'
import type { AccessFilter } from '../rbac/middleware'
import {
  approvalQueue,
  executiveDashboard,
  inventoryDashboard,
  spvDashboard,
  type DashboardServiceContext,
} from './service'

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema }) as unknown as Db

const COMPANY_ID = '97000000-0000-4000-8000-000000000001'
const BRAND_ID = '97000000-0000-4000-8000-000000000002'
const OUTLET_A_ID = '97000000-0000-4000-8000-000000000003'
const OUTLET_B_ID = '97000000-0000-4000-8000-000000000004'
const OUTLET_OOS_ID = '97000000-0000-4000-8000-000000000005' // out-of-scope

const ACTOR_USER_ID = '97000000-0000-4000-8000-000000000010'
const SUBMITTER_USER_ID = '97000000-0000-4000-8000-000000000011'

const UNIT_ID = '97100000-0000-4000-8000-000000000001'
const ITEM_A_ID = '97200000-0000-4000-8000-000000000001' // min_stock = NULL
const ITEM_B_ID = '97200000-0000-4000-8000-000000000002' // min_stock = '10'

const VISIBLE_OUTLET_IDS = [OUTLET_A_ID, OUTLET_B_ID]

function accessFilter(permission: string, outletIds: string[] = VISIBLE_OUTLET_IDS): AccessFilter {
  return {
    permission,
    ownOnly: false,
    assignedOnly: false,
    rowLevelScopes: [],
    structuralScopes: outletIds.map((id) => ({ scopeType: 'outlet' as const, scopeId: id })),
  }
}

function ctx(permission: string, outletIds?: string[], actorUserId = ACTOR_USER_ID): DashboardServiceContext {
  return {
    companyId: COMPANY_ID,
    actorUserId,
    accessFilter: accessFilter(permission, outletIds),
  }
}

function emptyCtx(permission: string): DashboardServiceContext {
  return {
    companyId: COMPANY_ID,
    actorUserId: ACTOR_USER_ID,
    accessFilter: { permission, ownOnly: false, assignedOnly: false, rowLevelScopes: [], structuralScopes: [] },
  }
}

async function cleanupOperational() {
  await sql`DELETE FROM evidence WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM pending_stock_movements WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM stock_movements WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM stock_balances WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM daily_reports WHERE company_id = ${COMPANY_ID}`
}

async function cleanupAll() {
  await cleanupOperational()
  await sql`DELETE FROM items WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM units WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM users WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM outlets WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM brands WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM companies WHERE id = ${COMPANY_ID}`
}

beforeAll(async () => {
  await cleanupAll()

  await db.insert(companies).values({ id: COMPANY_ID, companyCode: 'DASH-T', companyName: 'Dashboard Test', status: 'active' })
  await db.insert(brands).values({ id: BRAND_ID, companyId: COMPANY_ID, brandCode: 'DASH-B', brandName: 'Brand', status: 'active' })
  await db.insert(outlets).values([
    { id: OUTLET_A_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'DASH-A', outletName: 'Outlet A', status: 'active' },
    { id: OUTLET_B_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'DASH-B', outletName: 'Outlet B', status: 'active' },
    { id: OUTLET_OOS_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'DASH-OOS', outletName: 'Out Of Scope', status: 'active' },
  ])
  await db.insert(users).values([
    { id: ACTOR_USER_ID, companyId: COMPANY_ID, email: 'dash-actor@egg.test', fullName: 'Actor User', status: 'active', firstLoginRequired: false },
    { id: SUBMITTER_USER_ID, companyId: COMPANY_ID, email: 'dash-submitter@egg.test', fullName: 'Submitter User', status: 'active', firstLoginRequired: false },
  ])
  await db.insert(units).values({ id: UNIT_ID, companyId: COMPANY_ID, code: 'PCS', name: 'Pieces' })
  await db.insert(items).values([
    { id: ITEM_A_ID, companyId: COMPANY_ID, sku: 'DASH-A', name: 'Item A', baseUnitId: UNIT_ID, minStock: null },
    { id: ITEM_B_ID, companyId: COMPANY_ID, sku: 'DASH-B', name: 'Item B', baseUnitId: UNIT_ID, minStock: '10' },
  ])
})

beforeEach(async () => {
  await cleanupOperational()
})

afterAll(async () => {
  await cleanupAll()
  await sql.end()
})

// ── D1: outlet_status missing ─────────────────────────────────────────────
describe('D1 outlet_status missing', () => {
  it('outlet with no report → missing; outlet with opening report → opening_status = report status', async () => {
    const TODAY = '2025-03-10'

    // Outlet A: only opening report (submitted)
    await db.insert(dailyReports).values({
      companyId: COMPANY_ID,
      outletId: OUTLET_A_ID,
      reportType: 'opening',
      reportDate: TODAY,
      status: 'submitted',
      createdBy: ACTOR_USER_ID,
    })
    // Outlet B: no reports at all

    const result = await executiveDashboard(db, ctx('dashboard.executive'), { date: TODAY, month: '2025-03' })

    const outletA = result.outlet_status.find((s) => s.outlet_id === OUTLET_A_ID)
    const outletB = result.outlet_status.find((s) => s.outlet_id === OUTLET_B_ID)

    expect(outletA).toBeDefined()
    expect(outletA!.opening_status).toBe('submitted')
    expect(outletA!.closing_status).toBe('missing')

    expect(outletB).toBeDefined()
    expect(outletB!.opening_status).toBe('missing')
    expect(outletB!.closing_status).toBe('missing')
  })
})

// ── D2: elapsed_days math (compliance) ───────────────────────────────────
describe('D2 elapsed_days math', () => {
  const MONTH = '2025-06'
  const DAYS = ['2025-06-01', '2025-06-05', '2025-06-10'] // 3 compliant days

  beforeEach(async () => {
    for (const date of DAYS) {
      await db.insert(dailyReports).values([
        { companyId: COMPANY_ID, outletId: OUTLET_A_ID, reportType: 'opening', reportDate: date, status: 'validated', createdBy: ACTOR_USER_ID },
        { companyId: COMPANY_ID, outletId: OUTLET_A_ID, reportType: 'closing', reportDate: date, status: 'validated', createdBy: ACTOR_USER_ID },
      ])
    }
  })

  it('bulan berjalan (day 15): elapsed=15, pct = 3/15*100 = 20', async () => {
    const now = () => new Date('2025-06-15T10:00:00Z') // WIB = 2025-06-15
    const result = await executiveDashboard(db, ctx('dashboard.executive'), { month: MONTH }, now)
    const comp = result.report_compliance.find((c) => c.outlet_id === OUTLET_A_ID)!

    expect(comp.elapsed_days).toBe(15)
    expect(comp.calendar_days).toBe(30)
    expect(comp.compliant_days).toBe(3)
    expect(comp.compliance_to_date_pct).toBe(20)
  })

  it('bulan lampau (now = Juli): elapsed = calendarDays = 30, pct = 3/30*100 = 10', async () => {
    const now = () => new Date('2025-07-15T10:00:00Z') // past month
    const result = await executiveDashboard(db, ctx('dashboard.executive'), { month: MONTH }, now)
    const comp = result.report_compliance.find((c) => c.outlet_id === OUTLET_A_ID)!

    expect(comp.elapsed_days).toBe(30)
    expect(comp.calendar_days).toBe(30)
    expect(comp.compliance_to_date_pct).toBe(10)
  })

  it('bulan depan (now = Mei): elapsed = 0, compliance_to_date_pct = null', async () => {
    const now = () => new Date('2025-05-31T10:00:00Z') // before month
    const result = await executiveDashboard(db, ctx('dashboard.executive'), { month: MONTH }, now)
    const comp = result.report_compliance.find((c) => c.outlet_id === OUTLET_A_ID)!

    expect(comp.elapsed_days).toBe(0)
    expect(comp.compliance_to_date_pct).toBeNull()
  })
})

// ── D3: scope isolation ───────────────────────────────────────────────────
describe('D3 scope isolation', () => {
  it('outlet out of scope tidak muncul di response', async () => {
    const TODAY = '2025-03-11'

    // Data at OOS outlet
    await db.insert(dailyReports).values({
      companyId: COMPANY_ID,
      outletId: OUTLET_OOS_ID,
      reportType: 'opening',
      reportDate: TODAY,
      status: 'submitted',
      createdBy: ACTOR_USER_ID,
    })
    await db.insert(pendingStockMovements).values({
      companyId: COMPANY_ID,
      outletId: OUTLET_OOS_ID,
      itemId: ITEM_A_ID,
      movementType: 'opname',
      inputQty: '5',
      inputUnitId: UNIT_ID,
      qtyBase: '-5',
      status: 'pending',
      submittedBy: SUBMITTER_USER_ID,
    })

    const execResult = await executiveDashboard(db, ctx('dashboard.executive'), { date: TODAY, month: '2025-03' })
    const spvResult = await spvDashboard(db, ctx('dashboard.spv'), { date: TODAY })
    const invResult = await inventoryDashboard(db, ctx('dashboard.inventory'), { date: TODAY })
    const queueResult = await approvalQueue(db, ctx('dashboard.approval_queue'))

    // OOS outlet must not appear in any result
    expect(execResult.outlet_status.every((s) => s.outlet_id !== OUTLET_OOS_ID)).toBe(true)
    expect(execResult.approval_pending.every((p) => p.outlet_id !== OUTLET_OOS_ID)).toBe(true)
    expect(spvResult.report_today.every((r) => r.outlet_id !== OUTLET_OOS_ID)).toBe(true)
    expect(spvResult.opname_today.every((o) => o.outlet_id !== OUTLET_OOS_ID)).toBe(true)
    expect(invResult.pending_validation.submitted_count).toBe(0)
    expect(queueResult.to_validate.every((t) => t.outlet_id !== OUTLET_OOS_ID)).toBe(true)
    expect(queueResult.reports_to_validate.every((r) => r.outlet_id !== OUTLET_OOS_ID)).toBe(true)
  })
})

// ── D4: evidence_missing ──────────────────────────────────────────────────
describe('D4 evidence_missing', () => {
  it('confirmed evidence → not missing; pending evidence → still missing; no evidence → missing', async () => {
    const TODAY = '2025-03-12'

    // Report A: submitted + confirmed evidence → should NOT appear in evidence_missing
    const [reportA] = await db
      .insert(dailyReports)
      .values({ companyId: COMPANY_ID, outletId: OUTLET_A_ID, reportType: 'opening', reportDate: TODAY, status: 'submitted', createdBy: ACTOR_USER_ID })
      .returning()

    await db.insert(evidence).values({
      companyId: COMPANY_ID,
      outletId: OUTLET_A_ID,
      recordType: 'daily_report',
      recordId: reportA.id,
      storageKey: 'test/key-a',
      fileName: 'a.jpg',
      contentType: 'image/jpeg',
      fileSize: 1000,
      status: 'confirmed',
      uploadedBy: ACTOR_USER_ID,
    })

    // Report B: submitted + PENDING evidence → SHOULD appear in evidence_missing
    const [reportB] = await db
      .insert(dailyReports)
      .values({ companyId: COMPANY_ID, outletId: OUTLET_A_ID, reportType: 'closing', reportDate: TODAY, status: 'submitted', createdBy: ACTOR_USER_ID })
      .returning()

    await db.insert(evidence).values({
      companyId: COMPANY_ID,
      outletId: OUTLET_A_ID,
      recordType: 'daily_report',
      recordId: reportB.id,
      storageKey: 'test/key-b',
      fileName: 'b.jpg',
      contentType: 'image/jpeg',
      fileSize: 1000,
      status: 'pending',
      uploadedBy: ACTOR_USER_ID,
    })

    // Report C: submitted, NO evidence → SHOULD appear in evidence_missing
    const [reportC] = await db
      .insert(dailyReports)
      .values({ companyId: COMPANY_ID, outletId: OUTLET_B_ID, reportType: 'opening', reportDate: TODAY, status: 'validated', createdBy: ACTOR_USER_ID })
      .returning()

    const result = await spvDashboard(db, ctx('dashboard.spv'), { date: TODAY })
    const missingIds = result.evidence_missing.map((e) => e.report_id)

    expect(missingIds).not.toContain(reportA.id) // confirmed evidence → not missing
    expect(missingIds).toContain(reportB.id)       // pending evidence → still missing
    expect(missingIds).toContain(reportC.id)       // no evidence → missing
  })
})

// ── D5: stock_critical ────────────────────────────────────────────────────
describe('D5 stock_critical', () => {
  it('min_stock NULL → not critical; qty >= min → not critical; qty < min → critical', async () => {
    // ITEM_A: min_stock=null, balance=5 → not critical
    await db.insert(stockBalances).values({ companyId: COMPANY_ID, itemId: ITEM_A_ID, outletId: OUTLET_A_ID, qtyBase: '5' })

    // ITEM_B: min_stock='10', balance='15' → NOT critical (15 >= 10)
    await db.insert(stockBalances).values({ companyId: COMPANY_ID, itemId: ITEM_B_ID, outletId: OUTLET_A_ID, qtyBase: '15' })

    let result = await inventoryDashboard(db, ctx('dashboard.inventory'), {})
    expect(result.stock_critical).toHaveLength(0)

    // Update balance to below min_stock
    await sql`UPDATE stock_balances SET qty_base = '3' WHERE item_id = ${ITEM_B_ID} AND outlet_id = ${OUTLET_A_ID}`

    result = await inventoryDashboard(db, ctx('dashboard.inventory'), {})
    expect(result.stock_critical).toHaveLength(1)
    expect(result.stock_critical[0]!.item_id).toBe(ITEM_B_ID)
    expect(result.stock_critical[0]!.balance).toBe('3.000000')
    expect(result.stock_critical[0]!.min_stock).toBe('10.000000')
  })
})

// ── D7: approvalQueue actionable ─────────────────────────────────────────
describe('D7 approvalQueue actionable (SoD for movements)', () => {
  it('submittedBy !== actorUserId → actionable=true; submittedBy === actorUserId → actionable=false', async () => {
    // pending submitted by SUBMITTER (not ACTOR) → actionable=true
    await db.insert(pendingStockMovements).values({
      companyId: COMPANY_ID,
      outletId: OUTLET_A_ID,
      itemId: ITEM_A_ID,
      movementType: 'opname',
      inputQty: '5',
      inputUnitId: UNIT_ID,
      qtyBase: '-5',
      status: 'pending',
      submittedBy: SUBMITTER_USER_ID,
    })

    // pending submitted by ACTOR (self) → actionable=false
    await db.insert(pendingStockMovements).values({
      companyId: COMPANY_ID,
      outletId: OUTLET_B_ID,
      itemId: ITEM_A_ID,
      movementType: 'opname',
      inputQty: '3',
      inputUnitId: UNIT_ID,
      qtyBase: '-3',
      status: 'pending',
      submittedBy: ACTOR_USER_ID,
    })

    const result = await approvalQueue(db, ctx('dashboard.approval_queue', VISIBLE_OUTLET_IDS, ACTOR_USER_ID))

    const byOtherPerson = result.to_validate.find((t) => t.submitted_by === SUBMITTER_USER_ID)
    const bySelf = result.to_validate.find((t) => t.submitted_by === ACTOR_USER_ID)

    expect(byOtherPerson!.actionable).toBe(true)
    expect(bySelf!.actionable).toBe(false)
  })
})

// ── D8: reports_to_validate has no actionable ─────────────────────────────
describe('D8 reports_to_validate no actionable field', () => {
  it('reports_to_validate entries do not have an actionable property', async () => {
    await db.insert(dailyReports).values({
      companyId: COMPANY_ID,
      outletId: OUTLET_A_ID,
      reportType: 'opening',
      reportDate: '2025-03-13',
      status: 'submitted',
      submittedBy: SUBMITTER_USER_ID,
      submittedAt: new Date('2025-03-13T08:00:00Z'),
      createdBy: SUBMITTER_USER_ID,
    })

    const result = await approvalQueue(db, ctx('dashboard.approval_queue'))

    expect(result.reports_to_validate).toHaveLength(1)
    expect('actionable' in result.reports_to_validate[0]!).toBe(false)
  })
})

// ── empty-scope: all widgets return empty ─────────────────────────────────
describe('empty-scope → all widgets empty', () => {
  it('executiveDashboard: empty scope → empty widgets', async () => {
    const result = await executiveDashboard(db, emptyCtx('dashboard.executive'), {})
    expect(result.outlet_status).toHaveLength(0)
    expect(result.report_compliance).toHaveLength(0)
    expect(result.approval_pending).toHaveLength(0)
    expect(result.stock_discrepancy).toHaveLength(0)
  })

  it('spvDashboard: empty scope → empty widgets', async () => {
    const result = await spvDashboard(db, emptyCtx('dashboard.spv'), {})
    expect(result.report_today).toHaveLength(0)
    expect(result.opname_today).toHaveLength(0)
    expect(result.issue_log).toHaveLength(0)
    expect(result.evidence_missing).toHaveLength(0)
    expect(result.pending_validation.reports_submitted.count).toBe(0)
    expect(result.pending_validation.movements_submitted_count).toBe(0)
  })

  it('inventoryDashboard: empty scope → empty widgets', async () => {
    const result = await inventoryDashboard(db, emptyCtx('dashboard.inventory'), {})
    expect(result.stock_critical).toHaveLength(0)
    expect(result.movement_today).toHaveLength(0)
    expect(result.waste_summary).toHaveLength(0)
    expect(result.top_discrepancy).toHaveLength(0)
    expect(result.pending_validation.submitted_count).toBe(0)
  })

  it('approvalQueue: empty scope → empty queues', async () => {
    const result = await approvalQueue(db, emptyCtx('dashboard.approval_queue'))
    expect(result.to_validate).toHaveLength(0)
    expect(result.to_finalize).toHaveLength(0)
    expect(result.reports_to_validate).toHaveLength(0)
  })
})
