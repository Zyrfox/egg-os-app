import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  dailyReports,
  evidence,
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
import { EVIDENCE_MAX_SIZE, EVIDENCE_UPLOAD_EXPIRES_IN, EVIDENCE_VIEW_EXPIRES_IN } from './service'

const TEST_JWT_SECRET = 'dev-egg-os-jwt-secret-change-in-production-min32chars'

// ── Mock R2 bucket (injected via TEST_ENV.EVIDENCE_BUCKET) ────────────────
// headByKey: mutable — test set per-case. deletedKeys: audit trail.
const headByKey: Record<string, { size: number } | null> = {}
const deletedKeys: string[] = []

const mockR2Bucket = {
  async head(key: string) {
    return key in headByKey ? headByKey[key] : null
  },
  async delete(key: string) {
    deletedKeys.push(key)
  },
  // R2Bucket stub — routes hanya pakai head + delete
  put: async () => { throw new Error('not used') },
  get: async () => null,
  list: async () => ({ objects: [], truncated: false, cursor: undefined, delimitedPrefixes: [] }),
  createMultipartUpload: async () => { throw new Error('not used') },
  resumeMultipartUpload: () => { throw new Error('not used') },
}

const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: TEST_JWT_SECRET,
  EVIDENCE_BUCKET: mockR2Bucket as unknown as R2Bucket,
  // Dummy R2 creds — aws4fetch signing works locally (HMAC, no network).
  // Resulting URLs tidak valid ke R2 nyata; test hanya cek response shape.
  R2_ACCOUNT_ID: 'test-account-id',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
}

// ── Fixtures IDs ──────────────────────────────────────────────────────────

const COMPANY_ID = '9c000000-0000-4000-8000-000000000001'
const OTHER_COMPANY_ID = '9c000000-0000-4000-8000-000000000002'
const BRAND_ID = '9c000000-0000-4000-8000-000000000003'
const OTHER_BRAND_ID = '9c000000-0000-4000-8000-000000000004'
const OUTLET_A_ID = '9c000000-0000-4000-8000-000000000005'
const OUTLET_OOS_ID = '9c000000-0000-4000-8000-000000000006'
const OTHER_OUTLET_ID = '9c000000-0000-4000-8000-000000000007'

const UPLOADER_USER_ID = '9c000000-0000-4000-8000-000000000010'
const READER_USER_ID = '9c000000-0000-4000-8000-000000000011'
const OTHER_COMPANY_USER_ID = '9c000000-0000-4000-8000-000000000012'

const UPLOADER_ROLE_ID = '9c100000-0000-4000-8000-000000000001'
const READER_ROLE_ID = '9c100000-0000-4000-8000-000000000002'
const OTHER_COMPANY_UPLOADER_ROLE_ID = '9c100000-0000-4000-8000-000000000003'

const REPORT_DRAFT_ID = '9c200000-0000-4000-8000-000000000001'
const REPORT_VALIDATED_ID = '9c200000-0000-4000-8000-000000000002'
const REPORT_OOS_ID = '9c200000-0000-4000-8000-000000000003'

// ── DB + helpers ──────────────────────────────────────────────────────────

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema })

const permissionCodes = ['evidence.upload', 'evidence.read']
const permissionIds = new Map<string, string>()

let uploaderToken = ''
let readerToken = ''
let otherCompanyToken = ''

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

async function tokenFor(userId: string) {
  return signAccessToken(
    { sub: userId, company_id: COMPANY_ID, roles: [], scopes: [], first_login_required: false },
    TEST_JWT_SECRET,
  )
}

async function tokenForOtherCompany() {
  return signAccessToken(
    { sub: OTHER_COMPANY_USER_ID, company_id: OTHER_COMPANY_ID, roles: [], scopes: [], first_login_required: false },
    TEST_JWT_SECRET,
  )
}

async function cleanupFixtures() {
  await sql`DELETE FROM evidence WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM daily_reports WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM user_roles WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM role_permissions WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM roles WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM users WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM outlets WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM brands WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM companies WHERE id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

async function seedFixtures() {
  // permission catalog
  await db
    .insert(permissions)
    .values(
      permissionCodes.map((code) => {
        const [module, action] = code.split('.')
        return { code, module: module!, action: action!, description: `EVD routes test ${code}` }
      }),
    )
    .onConflictDoNothing()

  // fetch the permission IDs we just inserted
  for (const code of permissionCodes) {
    const row = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.code, code))
      .limit(1)
      .then((r) => r[0])
    if (row) permissionIds.set(code, row.id)
  }

  await db.insert(companies).values([
    { id: COMPANY_ID, companyCode: 'EVD-R', companyName: 'Evidence Routes', status: 'active' },
    { id: OTHER_COMPANY_ID, companyCode: 'EVD-R-OTH', companyName: 'Evidence Routes Other', status: 'active' },
  ])
  await db.insert(brands).values([
    { id: BRAND_ID, companyId: COMPANY_ID, brandCode: 'EVD-RB', brandName: 'Brand', status: 'active' },
    { id: OTHER_BRAND_ID, companyId: OTHER_COMPANY_ID, brandCode: 'EVD-RB-O', brandName: 'Other Brand', status: 'active' },
  ])
  await db.insert(outlets).values([
    { id: OUTLET_A_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'EVD-A', outletName: 'Outlet A', status: 'active' },
    { id: OUTLET_OOS_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'EVD-OOS', outletName: 'OOS Outlet', status: 'active' },
    { id: OTHER_OUTLET_ID, companyId: OTHER_COMPANY_ID, brandId: OTHER_BRAND_ID, outletCode: 'EVD-OTH', outletName: 'Other Outlet', status: 'active' },
  ])
  await db.insert(users).values([
    { id: UPLOADER_USER_ID, companyId: COMPANY_ID, email: 'evd-r-up@egg.test', fullName: 'Uploader', status: 'active', firstLoginRequired: false },
    { id: READER_USER_ID, companyId: COMPANY_ID, email: 'evd-r-read@egg.test', fullName: 'Reader', status: 'active', firstLoginRequired: false },
    { id: OTHER_COMPANY_USER_ID, companyId: OTHER_COMPANY_ID, email: 'evd-r-other@egg.test', fullName: 'Other', status: 'active', firstLoginRequired: false },
  ])
  await db.insert(roles).values([
    { id: UPLOADER_ROLE_ID, companyId: COMPANY_ID, code: 'EVD_R_UP', name: 'EVD Uploader', defaultScopeType: 'outlet', isSystem: false },
    { id: READER_ROLE_ID, companyId: COMPANY_ID, code: 'EVD_R_RD', name: 'EVD Reader', defaultScopeType: 'outlet', isSystem: false },
    // Other-company uploader — untuk cross-company scope test. Punya evidence.upload di company-nya sendiri,
    // tapi saat akses report company lain → resolveRecord tidak temukan record → 404 ERR_OUT_OF_SCOPE.
    { id: OTHER_COMPANY_UPLOADER_ROLE_ID, companyId: OTHER_COMPANY_ID, code: 'EVD_R_OTH_UP', name: 'EVD Other Uploader', defaultScopeType: 'outlet', isSystem: false },
  ])
  await db.insert(rolePermissions).values([
    { roleId: UPLOADER_ROLE_ID, permissionId: permissionIds.get('evidence.upload')!, companyId: COMPANY_ID },
    { roleId: UPLOADER_ROLE_ID, permissionId: permissionIds.get('evidence.read')!, companyId: COMPANY_ID },
    { roleId: READER_ROLE_ID, permissionId: permissionIds.get('evidence.read')!, companyId: COMPANY_ID },
    { roleId: OTHER_COMPANY_UPLOADER_ROLE_ID, permissionId: permissionIds.get('evidence.upload')!, companyId: OTHER_COMPANY_ID },
  ])
  // UPLOADER scoped to OUTLET_A only (OUTLET_OOS = out-of-scope)
  await db.insert(userRoles).values([
    { userId: UPLOADER_USER_ID, roleId: UPLOADER_ROLE_ID, companyId: COMPANY_ID, scopeType: 'outlet', scopeId: OUTLET_A_ID, grantedBy: UPLOADER_USER_ID },
    { userId: READER_USER_ID, roleId: READER_ROLE_ID, companyId: COMPANY_ID, scopeType: 'outlet', scopeId: OUTLET_A_ID, grantedBy: UPLOADER_USER_ID },
    { userId: OTHER_COMPANY_USER_ID, roleId: OTHER_COMPANY_UPLOADER_ROLE_ID, companyId: OTHER_COMPANY_ID, scopeType: 'outlet', scopeId: OTHER_OUTLET_ID, grantedBy: OTHER_COMPANY_USER_ID },
  ])
}

async function resetState() {
  await sql`DELETE FROM evidence WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM daily_reports WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await db.insert(dailyReports).values([
    {
      id: REPORT_DRAFT_ID,
      companyId: COMPANY_ID, outletId: OUTLET_A_ID,
      reportType: 'opening', reportDate: '2026-09-01', status: 'draft',
      createdBy: UPLOADER_USER_ID,
    },
    {
      id: REPORT_VALIDATED_ID,
      companyId: COMPANY_ID, outletId: OUTLET_A_ID,
      reportType: 'closing', reportDate: '2026-09-01', status: 'validated',
      createdBy: UPLOADER_USER_ID,
      submittedBy: UPLOADER_USER_ID, submittedAt: new Date(),
      validatedBy: READER_USER_ID, validatedAt: new Date(),
    },
    {
      id: REPORT_OOS_ID,
      companyId: COMPANY_ID, outletId: OUTLET_OOS_ID,
      reportType: 'opening', reportDate: '2026-09-02', status: 'draft',
      createdBy: UPLOADER_USER_ID,
    },
  ])
  // Reset mock bucket state
  Object.keys(headByKey).forEach((k) => delete headByKey[k])
  deletedKeys.length = 0
}

function expectSuccess(body: TestResponseBody) {
  expect(body.success).toBe(true)
  expect(body.data).toBeDefined()
}

async function requestUpload(reportId = REPORT_DRAFT_ID, token = uploaderToken) {
  return req('POST', '/api/v1/evidence/request-upload', token, {
    record_type: 'daily_report',
    record_id: reportId,
    file_name: 'foto.jpg',
    content_type: 'image/jpeg',
    file_size: 1024,
  })
}

async function evidenceDbRow(id: string) {
  return db.select().from(evidence).where(eq(evidence.id, id)).limit(1).then((r) => r[0] ?? null)
}

beforeAll(async () => {
  await cleanupFixtures()
  await seedFixtures()
  uploaderToken = await tokenFor(UPLOADER_USER_ID)
  readerToken = await tokenFor(READER_USER_ID)
  otherCompanyToken = await tokenForOtherCompany()
})

beforeEach(async () => {
  await resetState()
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('EVIDENCE routes', () => {
  // ── 1. POST /request-upload valid ────────────────────────────────────────
  it('POST /request-upload valid → 201, upload_url + expires_in=600 + evidence pending', async () => {
    const { status, body } = await requestUpload()

    expect(status).toBe(201)
    expectSuccess(body)
    const data = body.data as {
      evidence: { status: string; uploaded_by: string; storage_key: string }
      upload_url: string
      expires_in: number
    }
    expect(data.evidence.status).toBe('pending')
    expect(data.evidence.uploaded_by).toBe(UPLOADER_USER_ID)
    expect(data.upload_url).toBeTruthy()
    expect(data.expires_in).toBe(EVIDENCE_UPLOAD_EXPIRES_IN)
    // Key format: {company}/{outlet}/{record_type}/{record_id}/{uuid}.jpg
    expect(data.evidence.storage_key).toMatch(
      new RegExp(`^${COMPANY_ID}/${OUTLET_A_ID}/daily_report/${REPORT_DRAFT_ID}/[\\w-]+\\.jpg$`),
    )
  })

  // ── 2. POST /request-upload invalid content_type → 422 ──────────────────
  it('POST /request-upload content_type invalid → 422 ERR_VALIDATION', async () => {
    const { status, body } = await req('POST', '/api/v1/evidence/request-upload', uploaderToken, {
      record_type: 'daily_report',
      record_id: REPORT_DRAFT_ID,
      file_name: 'x.gif',
      content_type: 'image/gif',
      file_size: 100,
    })
    expect(status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_VALIDATION')
  })

  // ── 3. POST /request-upload file_size >10MB → 422 ───────────────────────
  it('POST /request-upload file_size >10MB → 422 ERR_VALIDATION', async () => {
    const { status, body } = await req('POST', '/api/v1/evidence/request-upload', uploaderToken, {
      record_type: 'daily_report',
      record_id: REPORT_DRAFT_ID,
      file_name: 'big.jpg',
      content_type: 'image/jpeg',
      file_size: EVIDENCE_MAX_SIZE + 1,
    })
    expect(status).toBe(422)
    expect(body.error.code).toBe('ERR_VALIDATION')
  })

  // ── 4. POST /request-upload ke report validated → 409 ───────────────────
  it('POST /request-upload ke report validated → 409 ERR_CONFLICT (immutable)', async () => {
    const { status, body } = await requestUpload(REPORT_VALIDATED_ID)
    expect(status).toBe(409)
    expect(body.error.code).toBe('ERR_CONFLICT')
  })

  // ── 5. POST /:id/confirm (HEAD → {size}) → 200 confirmed ─────────────────
  it('POST /:id/confirm setelah HEAD → {size} → 200, status confirmed', async () => {
    const { body: reqBody } = await requestUpload()
    const evidenceData = (reqBody.data as { evidence: { id: string; storage_key: string } }).evidence
    // Inject file ke mock bucket
    headByKey[evidenceData.storage_key] = { size: 5432 }

    const { status, body } = await req('POST', `/api/v1/evidence/${evidenceData.id}/confirm`, uploaderToken)
    expect(status).toBe(200)
    expectSuccess(body)
    const updated = (body.data as { evidence: { status: string; file_size: number; confirmed_at: string | null } }).evidence
    expect(updated.status).toBe('confirmed')
    expect(updated.file_size).toBe(5432)
    expect(updated.confirmed_at).not.toBeNull()
  })

  // ── 6. POST /:id/confirm (HEAD → null) → 422 ERR_UPLOAD_NOT_FOUND ───────
  it('POST /:id/confirm (HEAD → null, file tidak ada) → 422 ERR_UPLOAD_NOT_FOUND', async () => {
    const { body: reqBody } = await requestUpload()
    const id = (reqBody.data as { evidence: { id: string } }).evidence.id
    // headByKey tidak di-set → head() returns null

    const { status, body } = await req('POST', `/api/v1/evidence/${id}/confirm`, uploaderToken)
    expect(status).toBe(422)
    expect(body.error.code).toBe('ERR_UPLOAD_NOT_FOUND')

    // Status tetap pending (retry-able)
    const row = await evidenceDbRow(id)
    expect(row?.status).toBe('pending')
  })

  // ── 7. GET /evidence — list per record, deleted excluded ─────────────────
  it('GET /evidence?record_type=daily_report&record_id= → list confirmed, deleted excluded', async () => {
    // Upload 2, confirm r2, delete r1
    const { body: r1Body } = await requestUpload()
    const r1 = (r1Body.data as { evidence: { id: string; storage_key: string } }).evidence
    const { body: r2Body } = await requestUpload()
    const r2 = (r2Body.data as { evidence: { id: string; storage_key: string } }).evidence

    // Confirm r2
    headByKey[r2.storage_key] = { size: 1024 }
    await req('POST', `/api/v1/evidence/${r2.id}/confirm`, uploaderToken)

    // Delete r1 (soft-delete via route)
    headByKey[r1.storage_key] = null // ensure not confirmed
    await req('DELETE', `/api/v1/evidence/${r1.id}`, uploaderToken)

    const { status, body } = await req(
      'GET',
      `/api/v1/evidence?record_type=daily_report&record_id=${REPORT_DRAFT_ID}`,
      readerToken,
    )
    expect(status).toBe(200)
    expectSuccess(body)
    const list = body.data as Array<{ id: string; status: string }>
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(r2.id)
    expect(list[0].status).toBe('confirmed')
  })

  // ── 8. GET /:id/view-url (confirmed) → 200; (pending) → 409 ─────────────
  it('GET /:id/view-url (confirmed) → 200 view_url + expires_in=300', async () => {
    const { body: reqBody } = await requestUpload()
    const ev = (reqBody.data as { evidence: { id: string; storage_key: string } }).evidence
    headByKey[ev.storage_key] = { size: 1024 }
    await req('POST', `/api/v1/evidence/${ev.id}/confirm`, uploaderToken)

    const { status, body } = await req('GET', `/api/v1/evidence/${ev.id}/view-url`, readerToken)
    expect(status).toBe(200)
    expectSuccess(body)
    const data = body.data as { view_url: string; expires_in: number }
    expect(data.view_url).toBeTruthy()
    expect(data.expires_in).toBe(EVIDENCE_VIEW_EXPIRES_IN)
  })

  it('GET /:id/view-url (pending) → 409 ERR_CONFLICT', async () => {
    const { body: reqBody } = await requestUpload()
    const id = (reqBody.data as { evidence: { id: string } }).evidence.id

    const { status, body } = await req('GET', `/api/v1/evidence/${id}/view-url`, readerToken)
    expect(status).toBe(409)
    expect(body.error.code).toBe('ERR_CONFLICT')
  })

  // ── 9. DELETE /:id ────────────────────────────────────────────────────────
  it('DELETE /:id (report draft) → 200, evidence soft-deleted', async () => {
    const { body: reqBody } = await requestUpload()
    const ev = (reqBody.data as { evidence: { id: string; storage_key: string } }).evidence

    const { status, body } = await req('DELETE', `/api/v1/evidence/${ev.id}`, uploaderToken)
    expect(status).toBe(200)
    expectSuccess(body)
    expect((body.data as { success: boolean }).success).toBe(true)

    const row = await evidenceDbRow(ev.id)
    expect(row?.deletedAt).not.toBeNull()
    expect(deletedKeys).toContain(ev.storage_key)
  })

  it('DELETE /:id (report validated) → 409 ERR_CONFLICT (immutable)', async () => {
    // Create evidence on REPORT_DRAFT_ID, then flip report to validated
    const { body: reqBody } = await requestUpload()
    const id = (reqBody.data as { evidence: { id: string } }).evidence.id
    await sql`UPDATE daily_reports SET status='validated', validated_by=${READER_USER_ID}, validated_at=now() WHERE id=${REPORT_DRAFT_ID}`

    const { status, body } = await req('DELETE', `/api/v1/evidence/${id}`, uploaderToken)
    expect(status).toBe(409)
    expect(body.error.code).toBe('ERR_CONFLICT')
  })

  // ── 10. PERMISSION ────────────────────────────────────────────────────────
  it('PERMISSION — tanpa evidence.upload → POST/DELETE 403', async () => {
    const uploadRes = await req('POST', '/api/v1/evidence/request-upload', readerToken, {
      record_type: 'daily_report', record_id: REPORT_DRAFT_ID,
      file_name: 'x.jpg', content_type: 'image/jpeg', file_size: 100,
    })
    expect(uploadRes.status).toBe(403)
    expect(uploadRes.body.error.code).toBe('ERR_FORBIDDEN')

    const fakeId = '9c999999-0000-4000-8000-000000000001'
    const delRes = await req('DELETE', `/api/v1/evidence/${fakeId}`, readerToken)
    expect(delRes.status).toBe(403)
    expect(delRes.body.error.code).toBe('ERR_FORBIDDEN')
  })

  it('PERMISSION — tanpa token → 401 ERR_UNAUTHENTICATED', async () => {
    const { status, body } = await req('GET', '/api/v1/evidence?record_type=daily_report&record_id=' + REPORT_DRAFT_ID)
    expect(status).toBe(401)
    expect(body.error.code).toBe('ERR_UNAUTHENTICATED')
  })

  // ── 11. SCOPE ─────────────────────────────────────────────────────────────
  it('SCOPE — request-upload ke report outlet luar scope → 404 ERR_OUT_OF_SCOPE', async () => {
    const { status, body } = await requestUpload(REPORT_OOS_ID)
    expect(status).toBe(404)
    expect(body.error.code).toBe('ERR_OUT_OF_SCOPE')
  })

  it('SCOPE — cross-company request-upload → 404 ERR_OUT_OF_SCOPE', async () => {
    // otherCompanyToken uses OTHER_COMPANY_ID — REPORT_DRAFT_ID belongs to COMPANY_ID
    const { status, body } = await req('POST', '/api/v1/evidence/request-upload', otherCompanyToken, {
      record_type: 'daily_report', record_id: REPORT_DRAFT_ID,
      file_name: 'x.jpg', content_type: 'image/jpeg', file_size: 100,
    })
    expect(status).toBe(404)
    expect(body.error.code).toBe('ERR_OUT_OF_SCOPE')
  })

  // ── 12. ROUTING — /request-upload non ke-shadow /:id ─────────────────────
  it('ROUTING — POST /request-upload tidak ke-shadow /:id (201, bukan 422 UUID parse)', async () => {
    // Kalau /request-upload ke-shadow jadi /:id, Zod uuid parse "request-upload" → 422.
    // Bukti routing order benar: response 201 (created) atau minimal bukan 422 uuid error.
    const { status } = await requestUpload()
    expect(status).toBe(201) // benar-benar sampai handler /request-upload
  })

  // ── TENANT — company_id di body diabaikan ─────────────────────────────────
  it('TENANT — company_id/uploaded_by di body diabaikan, diambil dari ctx', async () => {
    const { status, body } = await req('POST', '/api/v1/evidence/request-upload', uploaderToken, {
      company_id: OTHER_COMPANY_ID,     // harus DIABAIKAN
      uploaded_by: OTHER_COMPANY_USER_ID, // harus DIABAIKAN
      record_type: 'daily_report',
      record_id: REPORT_DRAFT_ID,
      file_name: 'foto.jpg',
      content_type: 'image/jpeg',
      file_size: 1024,
    })
    expect(status).toBe(201)
    const ev = (body.data as { evidence: { company_id: string; uploaded_by: string } }).evidence
    expect(ev.company_id).toBe(COMPANY_ID)
    expect(ev.uploaded_by).toBe(UPLOADER_USER_ID)
  })
})

