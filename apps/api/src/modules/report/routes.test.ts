import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, inArray } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  dailyReports,
  outlets,
  permissions,
  reportChecklistAnswers,
  reportChecklistItems,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@egg-os/db'
import app from '../../index'
import { signAccessToken } from '../../lib/jwt'
import type { TestResponseBody } from '../../test/types'

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars'
const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
}

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

const COMPANY_ID = '9a000000-0000-4000-8000-000000000001'
const OTHER_COMPANY_ID = '9a000000-0000-4000-8000-000000000002'
const BRAND_ID = '9a000000-0000-4000-8000-000000000003'
const OTHER_BRAND_ID = '9a000000-0000-4000-8000-000000000004'
const OUTLET_A_ID = '9a000000-0000-4000-8000-000000000005'
const OUTLET_B_ID = '9a000000-0000-4000-8000-000000000006'
const OTHER_OUTLET_ID = '9a000000-0000-4000-8000-000000000007'

const STAFF_USER_ID = '9a000000-0000-4000-8000-000000000010'
const SPV_USER_ID = '9a000000-0000-4000-8000-000000000011'
const READ_ONLY_USER_ID = '9a000000-0000-4000-8000-000000000012'
const OTHER_ACTOR_USER_ID = '9a000000-0000-4000-8000-000000000013'

const STAFF_ROLE_ID = '9a100000-0000-4000-8000-000000000001'
const SPV_ROLE_ID = '9a100000-0000-4000-8000-000000000002'
const READ_ONLY_ROLE_ID = '9a100000-0000-4000-8000-000000000003'

const ITEM_OPENING_A_ID = '9a300000-0000-4000-8000-000000000001'
const ITEM_OPENING_B_ID = '9a300000-0000-4000-8000-000000000002'
const ITEM_CLOSING_A_ID = '9a300000-0000-4000-8000-000000000003'

const permissionCodes = ['report.read', 'report.submit', 'report.validate']
const permissionIds = new Map<string, string>()

let staffToken = ''
let spvToken = ''
let readOnlyToken = ''

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
    {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    TEST_ENV,
  )
  return { status: res.status, body: (await res.json()) as TestResponseBody }
}

async function tokenFor(userId: string) {
  return signAccessToken(
    { sub: userId, company_id: COMPANY_ID, roles: [], scopes: [], first_login_required: false },
    TEST_JWT_SECRET,
  )
}

async function cleanupFixtures() {
  await sql`DELETE FROM report_checklist_answers WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM daily_reports WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM report_checklist_items WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM access_overrides WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM user_roles WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM role_permissions WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM roles WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM users WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM outlets WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM brands WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM companies WHERE id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

async function insertPermissionCatalog() {
  await db.insert(permissions).values(
    permissionCodes.map((code) => {
      const [module, action] = code.split('.')
      return { code, module, action, description: `Report route test permission ${code}` }
    }),
  ).onConflictDoNothing()

  const rows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, permissionCodes))

  for (const row of rows) permissionIds.set(row.code, row.id)
}

async function assignPermissions(roleId: string, codes: string[]) {
  await db.insert(rolePermissions).values(
    codes.map((code) => ({ roleId, permissionId: permissionIds.get(code)!, companyId: COMPANY_ID })),
  )
}

async function seedFixtures() {
  await insertPermissionCatalog()

  await db.insert(companies).values([
    { id: COMPANY_ID, companyCode: 'REP-R', companyName: 'Report Routes', status: 'active' },
    { id: OTHER_COMPANY_ID, companyCode: 'REP-R-OTH', companyName: 'Report Routes Other', status: 'active' },
  ])

  await db.insert(brands).values([
    { id: BRAND_ID, companyId: COMPANY_ID, brandCode: 'REP-RB', brandName: 'Report Brand', status: 'active' },
    { id: OTHER_BRAND_ID, companyId: OTHER_COMPANY_ID, brandCode: 'REP-RB-O', brandName: 'Other Brand', status: 'active' },
  ])

  await db.insert(outlets).values([
    { id: OUTLET_A_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'REP-A', outletName: 'Outlet A', status: 'active' },
    { id: OUTLET_B_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'REP-B', outletName: 'Outlet B', status: 'active' },
    { id: OTHER_OUTLET_ID, companyId: OTHER_COMPANY_ID, brandId: OTHER_BRAND_ID, outletCode: 'REP-OTH', outletName: 'Other Outlet', status: 'active' },
  ])

  await db.insert(users).values([
    { id: STAFF_USER_ID, companyId: COMPANY_ID, email: 'rep-r-staff@egg.test', fullName: 'Staff', status: 'active', firstLoginRequired: false },
    { id: SPV_USER_ID, companyId: COMPANY_ID, email: 'rep-r-spv@egg.test', fullName: 'SPV', status: 'active', firstLoginRequired: false },
    { id: READ_ONLY_USER_ID, companyId: COMPANY_ID, email: 'rep-r-readonly@egg.test', fullName: 'ReadOnly', status: 'active', firstLoginRequired: false },
    { id: OTHER_ACTOR_USER_ID, companyId: OTHER_COMPANY_ID, email: 'rep-r-other@egg.test', fullName: 'Other', status: 'active', firstLoginRequired: false },
  ])

  await db.insert(roles).values([
    { id: STAFF_ROLE_ID, companyId: COMPANY_ID, code: 'REP_R_STAFF', name: 'Report Staff', defaultScopeType: 'outlet', isSystem: false },
    { id: SPV_ROLE_ID, companyId: COMPANY_ID, code: 'REP_R_SPV', name: 'Report SPV', defaultScopeType: 'outlet', isSystem: false },
    { id: READ_ONLY_ROLE_ID, companyId: COMPANY_ID, code: 'REP_R_READ', name: 'Report Read Only', defaultScopeType: 'outlet', isSystem: false },
  ])

  // STAFF: read + submit di outlet A. SPV: read + submit + validate di outlet A. READ_ONLY: read saja di outlet A.
  await assignPermissions(STAFF_ROLE_ID, ['report.read', 'report.submit'])
  await assignPermissions(SPV_ROLE_ID, ['report.read', 'report.submit', 'report.validate'])
  await assignPermissions(READ_ONLY_ROLE_ID, ['report.read'])

  await db.insert(userRoles).values([
    { userId: STAFF_USER_ID, roleId: STAFF_ROLE_ID, companyId: COMPANY_ID, scopeType: 'outlet', scopeId: OUTLET_A_ID, grantedBy: STAFF_USER_ID },
    { userId: SPV_USER_ID, roleId: SPV_ROLE_ID, companyId: COMPANY_ID, scopeType: 'outlet', scopeId: OUTLET_A_ID, grantedBy: STAFF_USER_ID },
    { userId: READ_ONLY_USER_ID, roleId: READ_ONLY_ROLE_ID, companyId: COMPANY_ID, scopeType: 'outlet', scopeId: OUTLET_A_ID, grantedBy: STAFF_USER_ID },
  ])

  await db.insert(reportChecklistItems).values([
    { id: ITEM_OPENING_A_ID, companyId: COMPANY_ID, outletId: null, reportType: 'opening', label: 'Area bersih', displayOrder: 1, isActive: true },
    { id: ITEM_OPENING_B_ID, companyId: COMPANY_ID, outletId: null, reportType: 'opening', label: 'Stok awal', displayOrder: 2, isActive: true },
    { id: ITEM_CLOSING_A_ID, companyId: COMPANY_ID, outletId: null, reportType: 'closing', label: 'Kas ditutup', displayOrder: 1, isActive: true },
  ])
}

async function resetReports() {
  await sql`DELETE FROM report_checklist_answers WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM daily_reports WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

function expectSuccess(body: TestResponseBody) {
  expect(body.success).toBe(true)
  expect(body.data).toBeDefined()
}

async function reportDbRow(id: string) {
  return db.select().from(dailyReports).where(eq(dailyReports.id, id)).limit(1).then((r) => r[0] ?? null)
}

async function makeDraft(dateStr: string, type: 'opening' | 'closing' = 'opening') {
  const { status, body } = await req('POST', '/api/v1/reports/draft', staffToken, {
    outlet_id: OUTLET_A_ID,
    report_type: type,
    report_date: dateStr,
  })
  expect(status).toBe(201)
  return (body.data as { report: { id: string } }).report.id
}

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
  staffToken = await tokenFor(STAFF_USER_ID)
  spvToken = await tokenFor(SPV_USER_ID)
  readOnlyToken = await tokenFor(READ_ONLY_USER_ID)
})

beforeEach(async () => {
  await resetReports()
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('REPORT 3A routes', () => {
  it('POST /reports/draft → 201 pending draft + answers initialised', async () => {
    const { status, body } = await req('POST', '/api/v1/reports/draft', staffToken, {
      outlet_id: OUTLET_A_ID,
      report_type: 'opening',
      report_date: '2026-07-01',
      notes: 'shift pagi',
    })

    expect(status).toBe(201)
    expectSuccess(body)
    const data = body.data as { report: { status: string; created_by: string }; answers: unknown[] }
    expect(data.report.status).toBe('draft')
    expect(data.report.created_by).toBe(STAFF_USER_ID)
    expect(data.answers).toHaveLength(2)
  })

  it('POST /reports/draft duplicate (outlet+type+date) → 409 ERR_DUPLICATE', async () => {
    await makeDraft('2026-07-02', 'opening')

    const { status, body } = await req('POST', '/api/v1/reports/draft', staffToken, {
      outlet_id: OUTLET_A_ID, report_type: 'opening', report_date: '2026-07-02',
    })

    expect(status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_DUPLICATE')
  })

  it('PATCH /reports/:id on draft → 200, answers upserted, notes updated', async () => {
    const id = await makeDraft('2026-07-03')

    const { status, body } = await req('PATCH', `/api/v1/reports/${id}`, staffToken, {
      notes: 'diisi',
      answers: [{ checklist_item_id: ITEM_OPENING_A_ID, is_checked: true, value: 'ok', note: null }],
    })

    expect(status).toBe(200)
    expectSuccess(body)
    const data = body.data as {
      report: { notes: string }
      answers: Array<{ checklist_item_id: string; is_checked: boolean; value: string | null }>
    }
    expect(data.report.notes).toBe('diisi')
    const updated = data.answers.find((a) => a.checklist_item_id === ITEM_OPENING_A_ID)
    expect(updated?.is_checked).toBe(true)
    expect(updated?.value).toBe('ok')
  })

  it('PATCH /reports/:id on validated → 409 (immutable)', async () => {
    const id = await makeDraft('2026-07-04')
    await req('POST', `/api/v1/reports/${id}/submit`, staffToken)
    await req('POST', `/api/v1/reports/${id}/validate`, spvToken)

    const { status, body } = await req('PATCH', `/api/v1/reports/${id}`, staffToken, { notes: 'edit final' })
    expect(status).toBe(409)
    expect(body.error.code).toBe('ERR_CONFLICT')
  })

  it('POST /reports/:id/submit draft → 200 submitted; validate on draft → 409', async () => {
    const id = await makeDraft('2026-07-05')

    const validateOnDraft = await req('POST', `/api/v1/reports/${id}/validate`, spvToken)
    expect(validateOnDraft.status).toBe(409)
    expect(validateOnDraft.body.error.code).toBe('ERR_CONFLICT')

    const submitRes = await req('POST', `/api/v1/reports/${id}/submit`, staffToken)
    expect(submitRes.status).toBe(200)
    const data = submitRes.body.data as { report: { status: string; submitted_by: string } }
    expect(data.report.status).toBe('submitted')
    expect(data.report.submitted_by).toBe(STAFF_USER_ID)
  })

  it('POST /reports/:id/validate submitted → 200 validated', async () => {
    const id = await makeDraft('2026-07-06')
    await req('POST', `/api/v1/reports/${id}/submit`, staffToken)

    const { status, body } = await req('POST', `/api/v1/reports/${id}/validate`, spvToken)
    expect(status).toBe(200)
    const data = body.data as { report: { status: string; validated_by: string } }
    expect(data.report.status).toBe('validated')
    expect(data.report.validated_by).toBe(SPV_USER_ID)
  })

  it('POST /reports/:id/reject with reason → 200 rejected; without reason → 422', async () => {
    const id = await makeDraft('2026-07-07')
    await req('POST', `/api/v1/reports/${id}/submit`, staffToken)

    const noReason = await req('POST', `/api/v1/reports/${id}/reject`, spvToken, {})
    expect(noReason.status).toBe(422)
    expect(noReason.body.error.code).toBe('ERR_VALIDATION')

    const withReason = await req('POST', `/api/v1/reports/${id}/reject`, spvToken, { reason: 'kurang lengkap' })
    expect(withReason.status).toBe(200)
    const data = withReason.body.data as { report: { status: string; reject_reason: string } }
    expect(data.report.status).toBe('rejected')
    expect(data.report.reject_reason).toBe('kurang lengkap')
  })

  it('GET /reports returns paginated meta + status filter', async () => {
    for (const d of ['2026-07-10', '2026-07-11', '2026-07-12']) await makeDraft(d)

    const paged = await req('GET', '/api/v1/reports?page=1&page_size=2', spvToken)
    expect(paged.status).toBe(200)
    expect(paged.body.meta).toEqual({ page: 1, page_size: 2, total: 3 })
    expect((paged.body.data as unknown[])).toHaveLength(2)

    const byStatus = await req('GET', '/api/v1/reports?status=draft', spvToken)
    expect(byStatus.body.meta.total).toBe(3)
  })

  it('GET /reports/:id → 200 detail + answers with labels', async () => {
    const id = await makeDraft('2026-07-13')

    const { status, body } = await req('GET', `/api/v1/reports/${id}`, spvToken)
    expect(status).toBe(200)
    const data = body.data as {
      report: { id: string }
      answers: Array<{ label: string }>
    }
    expect(data.report.id).toBe(id)
    expect(data.answers).toHaveLength(2)
    expect(data.answers.every((a) => typeof a.label === 'string' && a.label.length > 0)).toBe(true)
  })

  it('GET /reports/checklist-items?report_type=opening returns master items (NOT shadowed by /:id)', async () => {
    const { status, body } = await req(
      'GET',
      `/api/v1/reports/checklist-items?report_type=opening&outlet_id=${OUTLET_A_ID}`,
      spvToken,
    )
    expect(status).toBe(200)
    const items = body.data as Array<{ label: string; report_type: string; is_active: boolean }>
    expect(items.length).toBeGreaterThanOrEqual(2)
    expect(items.every((i) => i.report_type === 'opening' && i.is_active)).toBe(true)
    // Bukti tidak ke-shadow /:id: kalau ke-shadow, request akan sampai getReport dengan id="checklist-items" → 422/404.
    expect(body.success).toBe(true)
  })

  it('GET /reports/kpi/compliance returns numeric compliance (NOT shadowed by /:id)', async () => {
    // 1 hari compliant di Juli
    const op = await makeDraft('2026-07-20', 'opening')
    await req('POST', `/api/v1/reports/${op}/submit`, staffToken)
    await req('POST', `/api/v1/reports/${op}/validate`, spvToken)
    const cl = await makeDraft('2026-07-20', 'closing')
    await req('POST', `/api/v1/reports/${cl}/submit`, staffToken)
    await req('POST', `/api/v1/reports/${cl}/validate`, spvToken)

    const { status, body } = await req('GET', '/api/v1/reports/kpi/compliance?month=2026-07', spvToken)
    expect(status).toBe(200)
    expect(body.meta).toEqual({ month: '2026-07', calendar_days: 31 })
    const rows = body.data as Array<{ outlet_id: string; compliant_days: number; calendar_days: number }>
    const outletKpi = rows.find((r) => r.outlet_id === OUTLET_A_ID)
    expect(outletKpi?.compliant_days).toBe(1)
    expect(outletKpi?.calendar_days).toBe(31)
  })

  it('PERMISSION — read-only user: GET ok, POST /draft/submit/validate → 403', async () => {
    const listRes = await req('GET', '/api/v1/reports', readOnlyToken)
    expect(listRes.status).toBe(200)

    const draftRes = await req('POST', '/api/v1/reports/draft', readOnlyToken, {
      outlet_id: OUTLET_A_ID, report_type: 'opening', report_date: '2026-07-25',
    })
    expect(draftRes.status).toBe(403)
    expect(draftRes.body.error.code).toBe('ERR_FORBIDDEN')

    const id = await makeDraft('2026-07-26')
    await req('POST', `/api/v1/reports/${id}/submit`, staffToken)
    const validateRes = await req('POST', `/api/v1/reports/${id}/validate`, readOnlyToken)
    expect(validateRes.status).toBe(403)
    expect(validateRes.body.error.code).toBe('ERR_FORBIDDEN')
  })

  it('PERMISSION — staff (no report.validate) cannot validate → 403', async () => {
    const id = await makeDraft('2026-07-27')
    await req('POST', `/api/v1/reports/${id}/submit`, staffToken)

    const { status, body } = await req('POST', `/api/v1/reports/${id}/validate`, staffToken)
    expect(status).toBe(403)
    expect(body.error.code).toBe('ERR_FORBIDDEN')
  })

  it('SCOPE — POST /reports/draft to outlet outside scope → 404 ERR_OUT_OF_SCOPE', async () => {
    const { status, body } = await req('POST', '/api/v1/reports/draft', staffToken, {
      outlet_id: OUTLET_B_ID,   // staff scoped to outlet A only
      report_type: 'opening',
      report_date: '2026-07-28',
    })
    expect(status).toBe(404)
    expect(body.error.code).toBe('ERR_OUT_OF_SCOPE')
  })

  it('SCOPE — GET /reports/:id for cross-company report → 404', async () => {
    // Insert pending report langsung di OTHER_COMPANY (bypass service).
    const rows = await db
      .insert(dailyReports)
      .values({
        companyId: OTHER_COMPANY_ID,
        outletId: OTHER_OUTLET_ID,
        reportType: 'opening',
        reportDate: '2026-07-29',
        status: 'draft',
        notes: null,
        createdBy: OTHER_ACTOR_USER_ID,
      })
      .returning({ id: dailyReports.id })

    const { status, body } = await req('GET', `/api/v1/reports/${rows[0].id}`, spvToken)
    expect(status).toBe(404)
    expect(body.error.code).toBe('ERR_OUT_OF_SCOPE')
  })

  it('TENANT — company_id in body is ignored (created row uses ctx company)', async () => {
    const { status, body } = await req('POST', '/api/v1/reports/draft', staffToken, {
      company_id: OTHER_COMPANY_ID,       // should be IGNORED
      created_by: OTHER_ACTOR_USER_ID,    // should be IGNORED
      outlet_id: OUTLET_A_ID,
      report_type: 'opening',
      report_date: '2026-07-30',
    })
    expect(status).toBe(201)
    const data = body.data as { report: { id: string; company_id: string; created_by: string } }
    expect(data.report.company_id).toBe(COMPANY_ID)
    expect(data.report.created_by).toBe(STAFF_USER_ID)

    const row = await reportDbRow(data.report.id)
    expect(row?.companyId).toBe(COMPANY_ID)
    expect(row?.createdBy).toBe(STAFF_USER_ID)
  })
})

// keep unused imports happy under linter noise-tolerant setup
void reportChecklistAnswers
void reportChecklistItems
