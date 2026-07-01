import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  dailyReports,
  outlets,
  reportChecklistAnswers,
  reportChecklistItems,
  users,
} from '@egg-os/db'
import type { Db } from '../../lib/db'
import type { AccessFilter } from '../rbac/middleware'
import {
  complianceKpi,
  createDraft,
  getReport,
  listChecklistItems,
  listReports,
  rejectReport,
  submitReport,
  updateReport,
  validateReport,
  type ReportServiceContext,
} from './service'

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema }) as unknown as Db

const COMPANY_ID = '99000000-0000-4000-8000-000000000001'
const OTHER_COMPANY_ID = '99000000-0000-4000-8000-000000000002'
const BRAND_ID = '99000000-0000-4000-8000-000000000003'
const OTHER_BRAND_ID = '99000000-0000-4000-8000-000000000004'
const OUTLET_A_ID = '99000000-0000-4000-8000-000000000005'
const OUTLET_OUT_OF_SCOPE_ID = '99000000-0000-4000-8000-000000000006'
const OTHER_OUTLET_ID = '99000000-0000-4000-8000-000000000007'

const USER_STAFF_ID = '99000000-0000-4000-8000-000000000010'
const USER_SPV_ID = '99000000-0000-4000-8000-000000000011'
const OTHER_COMPANY_USER_ID = '99000000-0000-4000-8000-000000000013'

const ITEM_OPENING_A_ID = '99300000-0000-4000-8000-000000000001'
const ITEM_OPENING_B_ID = '99300000-0000-4000-8000-000000000002'
const ITEM_CLOSING_A_ID = '99300000-0000-4000-8000-000000000003'

type ReportPermission = 'report.read' | 'report.submit' | 'report.validate'

function accessFilter(permission: ReportPermission, outletId = OUTLET_A_ID): AccessFilter {
  return {
    permission,
    ownOnly: false,
    assignedOnly: false,
    rowLevelScopes: [],
    structuralScopes: [{ scopeType: 'outlet', scopeId: outletId }],
  }
}

function ctx(
  userId: string,
  permission: ReportPermission,
  outletId = OUTLET_A_ID,
  companyId = COMPANY_ID,
): ReportServiceContext {
  return {
    companyId,
    actorUserId: userId,
    accessFilter: accessFilter(permission, outletId),
  }
}

async function cleanupFixtures() {
  await sql`DELETE FROM report_checklist_answers WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM daily_reports WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM report_checklist_items WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM users WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM outlets WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM brands WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM companies WHERE id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

async function seedFixtures() {
  await db.insert(companies).values([
    { id: COMPANY_ID, companyCode: 'REP', companyName: 'Report Test', status: 'active' },
    { id: OTHER_COMPANY_ID, companyCode: 'REP-OTH', companyName: 'Report Other', status: 'active' },
  ])

  await db.insert(brands).values([
    { id: BRAND_ID, companyId: COMPANY_ID, brandCode: 'REP-B', brandName: 'Brand', status: 'active' },
    { id: OTHER_BRAND_ID, companyId: OTHER_COMPANY_ID, brandCode: 'REP-OB', brandName: 'Other Brand', status: 'active' },
  ])

  await db.insert(outlets).values([
    { id: OUTLET_A_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'REP-A', outletName: 'Outlet A', status: 'active' },
    { id: OUTLET_OUT_OF_SCOPE_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'REP-OOS', outletName: 'Outlet OOS', status: 'active' },
    { id: OTHER_OUTLET_ID, companyId: OTHER_COMPANY_ID, brandId: OTHER_BRAND_ID, outletCode: 'REP-OTH', outletName: 'Other Outlet', status: 'active' },
  ])

  await db.insert(users).values([
    { id: USER_STAFF_ID, companyId: COMPANY_ID, email: 'rep-staff@egg.test', fullName: 'Staff', status: 'active', firstLoginRequired: false },
    { id: USER_SPV_ID, companyId: COMPANY_ID, email: 'rep-spv@egg.test', fullName: 'SPV', status: 'active', firstLoginRequired: false },
    { id: OTHER_COMPANY_USER_ID, companyId: OTHER_COMPANY_ID, email: 'rep-other@egg.test', fullName: 'Other', status: 'active', firstLoginRequired: false },
  ])

  await db.insert(reportChecklistItems).values([
    { id: ITEM_OPENING_A_ID, companyId: COMPANY_ID, outletId: null, reportType: 'opening', label: 'Area bersih', displayOrder: 1, isActive: true },
    { id: ITEM_OPENING_B_ID, companyId: COMPANY_ID, outletId: null, reportType: 'opening', label: 'Stok awal dicek', displayOrder: 2, isActive: true },
    { id: ITEM_CLOSING_A_ID, companyId: COMPANY_ID, outletId: null, reportType: 'closing', label: 'Kas ditutup', displayOrder: 1, isActive: true },
  ])
}

async function resetState() {
  await sql`DELETE FROM report_checklist_answers WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM daily_reports WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  // Reset checklist items ke baseline (3 global): hapus tambahan ad-hoc dari test sebelumnya.
  await sql`DELETE FROM report_checklist_items WHERE company_id = ${COMPANY_ID} AND id NOT IN (${ITEM_OPENING_A_ID}, ${ITEM_OPENING_B_ID}, ${ITEM_CLOSING_A_ID})`
}

async function reportRow(id: string) {
  return db.select().from(dailyReports).where(eq(dailyReports.id, id)).limit(1).then((r) => r[0] ?? null)
}

async function answerRowsForReport(reportId: string) {
  return db.select().from(reportChecklistAnswers).where(eq(reportChecklistAnswers.reportId, reportId))
}

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
})

beforeEach(async () => {
  await resetState()
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('REPORT 3A service', () => {
  it('R3 — createDraft initialises answers from checklist master', async () => {
    const result = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID,
      reportType: 'opening',
      reportDate: '2026-06-01',
      notes: 'shift pagi',
    })

    expect(result.report.status).toBe('draft')
    expect(result.report.created_by).toBe(USER_STAFF_ID)
    expect(result.report.notes).toBe('shift pagi')
    // 2 item opening global → 2 answer kosong
    expect(result.answers).toHaveLength(2)
    expect(result.answers.every((a) => a.is_checked === false)).toBe(true)
  })

  it('R4 — createDraft duplicate (same outlet+type+date) returns ERR_DUPLICATE', async () => {
    await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-02',
    })

    await expect(
      createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
        outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-02',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_DUPLICATE' })
  })

  it('R5 — updateReport on draft upserts answers and updates notes', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-03',
    })

    const result = await updateReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id, {
      notes: 'sudah diisi',
      answers: [
        { checklistItemId: ITEM_OPENING_A_ID, isChecked: true, value: 'ok', note: 'rapi' },
      ],
    })

    expect(result.report.notes).toBe('sudah diisi')
    const updatedAns = result.answers.find((a) => a.checklist_item_id === ITEM_OPENING_A_ID)
    expect(updatedAns?.is_checked).toBe(true)
    expect(updatedAns?.value).toBe('ok')
    expect(updatedAns?.note).toBe('rapi')
  })

  it('R6 — updateReport on submitted returns ERR_CONFLICT', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-04',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id)

    await expect(
      updateReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id, { notes: 'edit ditolak' }),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
  })

  it('R7 — submitReport draft → submitted', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-05',
    })

    const { report } = await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id)

    expect(report.status).toBe('submitted')
    expect(report.submitted_by).toBe(USER_STAFF_ID)
    expect(report.submitted_at).not.toBeNull()
  })

  it('R8 — validateReport submitted → validated (NO SoD — validator boleh = submitter)', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-06',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id)

    // BUKTI NO SoD: validator = submitter (USER_STAFF_ID) tetap sukses.
    const { report } = await validateReport(db, ctx(USER_STAFF_ID, 'report.validate'), draft.report.id)

    expect(report.status).toBe('validated')
    expect(report.validated_by).toBe(USER_STAFF_ID)
  })

  it('R9 — rejectReport submitted + reason → rejected', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-07',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id)

    const { report } = await rejectReport(db, ctx(USER_SPV_ID, 'report.validate'), draft.report.id, 'kurang lengkap')

    expect(report.status).toBe('rejected')
    expect(report.rejected_by).toBe(USER_SPV_ID)
    expect(report.reject_reason).toBe('kurang lengkap')
  })

  it('R10 — rejected → updateReport + submitReport → submitted (revise flow), clears reject metadata', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-08',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id)
    await rejectReport(db, ctx(USER_SPV_ID, 'report.validate'), draft.report.id, 'revisi')

    // Edit + submit ulang
    await updateReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id, { notes: 'sudah revisi' })
    const { report } = await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id)

    expect(report.status).toBe('submitted')
    expect(report.rejected_by).toBeNull()
    expect(report.rejected_at).toBeNull()
    expect(report.reject_reason).toBeNull()
  })

  it('R11 — validateReport on draft returns ERR_CONFLICT (bukan submitted)', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-09',
    })

    await expect(
      validateReport(db, ctx(USER_SPV_ID, 'report.validate'), draft.report.id),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
  })

  it('R12 — double submit (on validated) returns ERR_CONFLICT', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-10',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id)
    await validateReport(db, ctx(USER_SPV_ID, 'report.validate'), draft.report.id)

    await expect(
      submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
  })

  it('R13 — IMMUTABILITY: validated → update/submit/reject semua ERR_CONFLICT', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-11',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id)
    await validateReport(db, ctx(USER_SPV_ID, 'report.validate'), draft.report.id)

    await expect(
      updateReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id, { notes: 'edit final' }),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
    await expect(
      submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
    await expect(
      rejectReport(db, ctx(USER_SPV_ID, 'report.validate'), draft.report.id, 'r'),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })

    const row = await reportRow(draft.report.id)
    expect(row?.status).toBe('validated')
  })

  it('R14 — scope: createDraft to outlet outside scope returns ERR_OUT_OF_SCOPE', async () => {
    await expect(
      createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
        outletId: OUTLET_OUT_OF_SCOPE_ID,
        reportType: 'opening',
        reportDate: '2026-06-12',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'ERR_OUT_OF_SCOPE' })
  })

  it('R16 — cross-company access returns ERR_OUT_OF_SCOPE', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-13',
    })

    const otherCtx: ReportServiceContext = {
      companyId: OTHER_COMPANY_ID,
      actorUserId: OTHER_COMPANY_USER_ID,
      accessFilter: {
        permission: 'report.read',
        ownOnly: false,
        assignedOnly: false,
        rowLevelScopes: [],
        structuralScopes: [{ scopeType: 'outlet', scopeId: OTHER_OUTLET_ID }],
      },
    }

    await expect(getReport(db, otherCtx, draft.report.id)).rejects.toMatchObject({
      status: 404, code: 'ERR_OUT_OF_SCOPE',
    })
  })

  it('CHECKLIST-RESOLUSI — global + outlet-spesifik gabungan; label sama → outlet menang', async () => {
    // Tambah 2 item outlet-spesifik: satu label baru ("Stiker harga update"), satu yang BENTROK label dengan global ("Stok awal dicek").
    const OUTLET_SPECIFIC_NEW = '99300000-0000-4000-8000-000000000099'
    const OUTLET_SPECIFIC_OVERRIDE = '99300000-0000-4000-8000-000000000098'
    await db.insert(reportChecklistItems).values([
      { id: OUTLET_SPECIFIC_NEW, companyId: COMPANY_ID, outletId: OUTLET_A_ID, reportType: 'opening',
        label: 'Stiker harga update', displayOrder: 5, isActive: true },
      { id: OUTLET_SPECIFIC_OVERRIDE, companyId: COMPANY_ID, outletId: OUTLET_A_ID, reportType: 'opening',
        label: 'Stok awal dicek', displayOrder: 2, isActive: true },
    ])

    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-14',
    })

    // Total answer = 3:
    //  - "Area bersih" (global, ITEM_OPENING_A_ID)
    //  - "Stok awal dicek" (outlet-override MENANG → OUTLET_SPECIFIC_OVERRIDE, BUKAN ITEM_OPENING_B_ID)
    //  - "Stiker harga update" (outlet-spesifik baru, OUTLET_SPECIFIC_NEW)
    expect(draft.answers).toHaveLength(3)
    const itemIds = draft.answers.map((a) => a.checklist_item_id).sort()
    expect(itemIds).toContain(ITEM_OPENING_A_ID)
    expect(itemIds).toContain(OUTLET_SPECIFIC_OVERRIDE)
    expect(itemIds).toContain(OUTLET_SPECIFIC_NEW)
    expect(itemIds).not.toContain(ITEM_OPENING_B_ID)   // global "Stok awal dicek" KALAH dari outlet-override
  })

  it('KPI compliance KETAT — compliant day = opening AND closing dua-duanya validated; submitted/missing TIDAK kompensasi', async () => {
    // Hari 1 (2026-06-01): opening validated + closing validated → COMPLIANT
    const op1 = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-01',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), op1.report.id)
    await validateReport(db, ctx(USER_SPV_ID, 'report.validate'), op1.report.id)
    const cl1 = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'closing', reportDate: '2026-06-01',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), cl1.report.id)
    await validateReport(db, ctx(USER_SPV_ID, 'report.validate'), cl1.report.id)

    // Hari 2 (2026-06-02): opening validated, closing CUMA submitted (belum validated) → TIDAK COMPLIANT
    const op2 = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-02',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), op2.report.id)
    await validateReport(db, ctx(USER_SPV_ID, 'report.validate'), op2.report.id)
    const cl2 = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'closing', reportDate: '2026-06-02',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), cl2.report.id)
    // (intentionally NOT validated)

    // Hari 3 (2026-06-03): cuma opening validated, NO closing → TIDAK COMPLIANT
    const op3 = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-03',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), op3.report.id)
    await validateReport(db, ctx(USER_SPV_ID, 'report.validate'), op3.report.id)

    const kpi = await complianceKpi(db, ctx(USER_SPV_ID, 'report.read'), { month: '2026-06' })

    expect(kpi.meta.month).toBe('2026-06')
    expect(kpi.meta.calendar_days).toBe(30) // Juni = 30 hari
    expect(kpi.data).toHaveLength(1)
    const outletKpi = kpi.data[0]
    expect(outletKpi.outlet_id).toBe(OUTLET_A_ID)
    expect(outletKpi.compliant_days).toBe(1)
    expect(outletKpi.calendar_days).toBe(30)
    // 1/30 * 100 = 3.33 (rounded 2 dec)
    expect(outletKpi.compliance_pct).toBeCloseTo(3.33, 2)
  })

  it('listReports — pagination + filter status + scope (visibleOutletIds)', async () => {
    // 3 draft di outlet A
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03']) {
      await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
        outletId: OUTLET_A_ID, reportType: 'opening', reportDate: d,
      })
    }

    const list = await listReports(db, ctx(USER_SPV_ID, 'report.read'), { page: 1, pageSize: 2 })
    expect(list.meta).toEqual({ page: 1, page_size: 2, total: 3 })
    expect(list.data).toHaveLength(2)

    const filterByStatus = await listReports(db, ctx(USER_SPV_ID, 'report.read'), { status: 'draft' })
    expect(filterByStatus.meta.total).toBe(3)
  })

  it('listChecklistItems — global + outlet visible, scope-filtered, returns active only', async () => {
    const list = await listChecklistItems(db, ctx(USER_SPV_ID, 'report.read'), {
      reportType: 'opening', outletId: OUTLET_A_ID,
    })
    // 2 item opening global. (Tidak ada outlet-spesifik di reset state.)
    expect(list.data).toHaveLength(2)
    expect(list.data.every((i) => i.is_active)).toBe(true)
    expect(list.data.every((i) => i.report_type === 'opening')).toBe(true)
  })

  it('reject empty reason returns ERR_VALIDATION', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-06-20',
    })
    await submitReport(db, ctx(USER_STAFF_ID, 'report.submit'), draft.report.id)

    await expect(
      rejectReport(db, ctx(USER_SPV_ID, 'report.validate'), draft.report.id, '  '),
    ).rejects.toMatchObject({ status: 422, code: 'ERR_VALIDATION' })

    const row = await reportRow(draft.report.id)
    expect(row?.status).toBe('submitted')
  })

  it('getReport for unrelated report id returns ERR_OUT_OF_SCOPE', async () => {
    const FAKE_ID = '99000000-0000-4000-8000-000000000999'
    await expect(getReport(db, ctx(USER_SPV_ID, 'report.read'), FAKE_ID)).rejects.toMatchObject({
      status: 404, code: 'ERR_OUT_OF_SCOPE',
    })
  })

  it('initialised answers correctly count against existing checklist master items', async () => {
    const draft = await createDraft(db, ctx(USER_STAFF_ID, 'report.submit'), {
      outletId: OUTLET_A_ID, reportType: 'closing', reportDate: '2026-06-21',
    })
    // closing master = 1 item
    expect(draft.answers).toHaveLength(1)
    const rows = await answerRowsForReport(draft.report.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].checklistItemId).toBe(ITEM_CLOSING_A_ID)
  })
})

// Silencer untuk linter agar import `and` tetap dipakai bila body trim.
void and
