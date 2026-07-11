import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, isNull } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  brands,
  companies,
  dailyReports,
  evidence,
  outlets,
  users,
} from '@egg-os/db'
import type { Db } from '../../lib/db'
import type { AccessFilter } from '../rbac/middleware'
import {
  confirmUpload,
  deleteEvidence,
  EVIDENCE_MAX_SIZE,
  EVIDENCE_UPLOAD_EXPIRES_IN,
  EVIDENCE_VIEW_EXPIRES_IN,
  getViewUrl,
  listEvidence,
  requestUpload,
  type EvidenceDeps,
  type EvidencePresigner,
  type EvidenceServiceContext,
  type EvidenceStorage,
} from './service'

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema }) as unknown as Db

const COMPANY_ID = '9b000000-0000-4000-8000-000000000001'
const OTHER_COMPANY_ID = '9b000000-0000-4000-8000-000000000002'
const BRAND_ID = '9b000000-0000-4000-8000-000000000003'
const OTHER_BRAND_ID = '9b000000-0000-4000-8000-000000000004'
const OUTLET_A_ID = '9b000000-0000-4000-8000-000000000005'
const OUTLET_OUT_OF_SCOPE_ID = '9b000000-0000-4000-8000-000000000006'
const OTHER_OUTLET_ID = '9b000000-0000-4000-8000-000000000007'

const UPLOADER_USER_ID = '9b000000-0000-4000-8000-000000000010'
const READER_USER_ID = '9b000000-0000-4000-8000-000000000011'
const OTHER_COMPANY_USER_ID = '9b000000-0000-4000-8000-000000000012'

const REPORT_DRAFT_A_ID = '9b200000-0000-4000-8000-000000000001'
const REPORT_VALIDATED_A_ID = '9b200000-0000-4000-8000-000000000002'
const REPORT_DRAFT_OOS_ID = '9b200000-0000-4000-8000-000000000003'
const REPORT_OTHER_COMPANY_ID = '9b200000-0000-4000-8000-000000000004'

type Permission = 'evidence.upload' | 'evidence.read'

function accessFilter(permission: Permission, outletId = OUTLET_A_ID): AccessFilter {
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
  permission: Permission,
  outletId = OUTLET_A_ID,
  companyId = COMPANY_ID,
): EvidenceServiceContext {
  return {
    companyId,
    actorUserId: userId,
    accessFilter: accessFilter(permission, outletId),
  }
}

// ── Mock deps ─────────────────────────────────────────────────────────────

type PresignPutCall = { key: string; contentType: string; expiresIn: number }
type PresignGetCall = { key: string; expiresIn: number }

function makeMockPresigner() {
  const putCalls: PresignPutCall[] = []
  const getCalls: PresignGetCall[] = []
  const presigner: EvidencePresigner = {
    async presignPut(input) {
      putCalls.push(input)
      return `https://mock/put/${encodeURIComponent(input.key)}?exp=${input.expiresIn}&ct=${encodeURIComponent(input.contentType)}`
    },
    async presignGet(input) {
      getCalls.push(input)
      return `https://mock/get/${encodeURIComponent(input.key)}?exp=${input.expiresIn}`
    },
  }
  return { presigner, putCalls, getCalls }
}

type HeadReply = { size: number } | null

function makeMockBucket(initial: { headByKey?: Record<string, HeadReply>; failDelete?: boolean } = {}) {
  const headCalls: string[] = []
  const deleteCalls: string[] = []
  const headByKey: Record<string, HeadReply> = { ...(initial.headByKey ?? {}) }
  const bucket: EvidenceStorage = {
    async head(key) {
      headCalls.push(key)
      return key in headByKey ? headByKey[key] : null
    },
    async delete(key) {
      deleteCalls.push(key)
      if (initial.failDelete) throw new Error('r2-down')
    },
  }
  return { bucket, headCalls, deleteCalls, setHead: (k: string, v: HeadReply) => { headByKey[k] = v } }
}

function makeDeps(overrides?: Partial<{ headByKey: Record<string, HeadReply>; failDelete: boolean }>): EvidenceDeps & {
  putCalls: PresignPutCall[]
  getCalls: PresignGetCall[]
  headCalls: string[]
  deleteCalls: string[]
  setHead: (k: string, v: HeadReply) => void
} {
  const p = makeMockPresigner()
  const b = makeMockBucket({ headByKey: overrides?.headByKey, failDelete: overrides?.failDelete })
  return {
    presigner: p.presigner,
    bucket: b.bucket,
    putCalls: p.putCalls,
    getCalls: p.getCalls,
    headCalls: b.headCalls,
    deleteCalls: b.deleteCalls,
    setHead: b.setHead,
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────

async function cleanupFixtures() {
  await sql`DELETE FROM evidence WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM report_checklist_answers WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM daily_reports WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM users WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM outlets WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM brands WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM companies WHERE id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

async function seedFixtures() {
  await db.insert(companies).values([
    { id: COMPANY_ID, companyCode: 'EVD', companyName: 'Evidence Test', status: 'active' },
    { id: OTHER_COMPANY_ID, companyCode: 'EVD-OTH', companyName: 'Evidence Other', status: 'active' },
  ])
  await db.insert(brands).values([
    { id: BRAND_ID, companyId: COMPANY_ID, brandCode: 'EVD-B', brandName: 'Brand', status: 'active' },
    { id: OTHER_BRAND_ID, companyId: OTHER_COMPANY_ID, brandCode: 'EVD-OB', brandName: 'Other Brand', status: 'active' },
  ])
  await db.insert(outlets).values([
    { id: OUTLET_A_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'EVD-A', outletName: 'Outlet A', status: 'active' },
    { id: OUTLET_OUT_OF_SCOPE_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'EVD-OOS', outletName: 'Outlet OOS', status: 'active' },
    { id: OTHER_OUTLET_ID, companyId: OTHER_COMPANY_ID, brandId: OTHER_BRAND_ID, outletCode: 'EVD-OTH', outletName: 'Other Outlet', status: 'active' },
  ])
  await db.insert(users).values([
    { id: UPLOADER_USER_ID, companyId: COMPANY_ID, email: 'evd-uploader@egg.test', fullName: 'Uploader', status: 'active', firstLoginRequired: false },
    { id: READER_USER_ID, companyId: COMPANY_ID, email: 'evd-reader@egg.test', fullName: 'Reader', status: 'active', firstLoginRequired: false },
    { id: OTHER_COMPANY_USER_ID, companyId: OTHER_COMPANY_ID, email: 'evd-other@egg.test', fullName: 'Other', status: 'active', firstLoginRequired: false },
  ])
}

async function resetState() {
  await sql`DELETE FROM evidence WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM daily_reports WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  // Re-seed reports fresh per test
  await db.insert(dailyReports).values([
    { id: REPORT_DRAFT_A_ID, companyId: COMPANY_ID, outletId: OUTLET_A_ID, reportType: 'opening', reportDate: '2026-08-01', status: 'draft', createdBy: UPLOADER_USER_ID },
    { id: REPORT_VALIDATED_A_ID, companyId: COMPANY_ID, outletId: OUTLET_A_ID, reportType: 'closing', reportDate: '2026-08-02', status: 'validated', createdBy: UPLOADER_USER_ID, submittedBy: UPLOADER_USER_ID, submittedAt: new Date(), validatedBy: READER_USER_ID, validatedAt: new Date() },
    { id: REPORT_DRAFT_OOS_ID, companyId: COMPANY_ID, outletId: OUTLET_OUT_OF_SCOPE_ID, reportType: 'opening', reportDate: '2026-08-03', status: 'draft', createdBy: UPLOADER_USER_ID },
    { id: REPORT_OTHER_COMPANY_ID, companyId: OTHER_COMPANY_ID, outletId: OTHER_OUTLET_ID, reportType: 'opening', reportDate: '2026-08-04', status: 'draft', createdBy: OTHER_COMPANY_USER_ID },
  ])
}

async function evidenceRow(id: string) {
  return db.select().from(evidence).where(eq(evidence.id, id)).limit(1).then((r) => r[0] ?? null)
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

describe('EVIDENCE service', () => {
  it('E1 — requestUpload valid → pending row + key format benar + signer dipanggil dgn param lock', async () => {
    const deps = makeDeps()
    const result = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report',
      recordId: REPORT_DRAFT_A_ID,
      fileName: 'foto.jpg',
      contentType: 'image/jpeg',
      fileSize: 1024,
    })

    expect(result.evidence.status).toBe('pending')
    expect(result.evidence.uploaded_by).toBe(UPLOADER_USER_ID)
    expect(result.evidence.file_size).toBe(1024)
    expect(result.expires_in).toBe(EVIDENCE_UPLOAD_EXPIRES_IN)

    // Key format: {company}/{outlet}/{recordType}/{recordId}/{uuid}.{ext}
    const expectedPrefix = `${COMPANY_ID}/${OUTLET_A_ID}/daily_report/${REPORT_DRAFT_A_ID}/`
    expect(result.evidence.storage_key.startsWith(expectedPrefix)).toBe(true)
    expect(result.evidence.storage_key.endsWith('.jpg')).toBe(true)

    // Signer dipanggil dengan param lock: key + content-type + expiry.
    expect(deps.putCalls).toHaveLength(1)
    expect(deps.putCalls[0]).toEqual({
      key: result.evidence.storage_key,
      contentType: 'image/jpeg',
      expiresIn: EVIDENCE_UPLOAD_EXPIRES_IN,
    })
    expect(result.upload_url).toContain('mock/put/')
  })

  it('ext dari content-type map (BUKAN dari file_name)', async () => {
    const deps = makeDeps()
    // Client kirim file_name .jpg tapi content-type PDF → ext harus .pdf
    const result = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report',
      recordId: REPORT_DRAFT_A_ID,
      fileName: 'menyaru.jpg',
      contentType: 'application/pdf',
      fileSize: 2048,
    })
    expect(result.evidence.storage_key.endsWith('.pdf')).toBe(true)
    expect(result.evidence.storage_key.includes('.jpg')).toBe(false)
  })

  it('E2 — content_type invalid → 422 ERR_VALIDATION', async () => {
    const deps = makeDeps()
    await expect(
      requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
        recordType: 'daily_report',
        recordId: REPORT_DRAFT_A_ID,
        fileName: 'x.gif',
        contentType: 'image/gif' as unknown as 'image/jpeg',
        fileSize: 100,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'ERR_VALIDATION' })
    // Zero side effect
    expect(deps.putCalls).toHaveLength(0)
  })

  it('E3 — file_size >10MB → 422 ERR_VALIDATION', async () => {
    const deps = makeDeps()
    await expect(
      requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
        recordType: 'daily_report',
        recordId: REPORT_DRAFT_A_ID,
        fileName: 'big.jpg',
        contentType: 'image/jpeg',
        fileSize: EVIDENCE_MAX_SIZE + 1,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'ERR_VALIDATION' })
  })

  it('E4 — requestUpload ke report validated → 409 ERR_CONFLICT (immutable)', async () => {
    const deps = makeDeps()
    await expect(
      requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
        recordType: 'daily_report',
        recordId: REPORT_VALIDATED_A_ID,
        fileName: 'foto.jpg',
        contentType: 'image/jpeg',
        fileSize: 1024,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
    expect(deps.putCalls).toHaveLength(0)
  })

  it('E5 — confirm dgn head()→{size} → confirmed + file_size aktual dari HEAD', async () => {
    const deps = makeDeps()
    const requested = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report',
      recordId: REPORT_DRAFT_A_ID,
      fileName: 'foto.jpg',
      contentType: 'image/jpeg',
      fileSize: 1000, // KLAIM client
    })

    // Mock R2 HEAD: file ada dengan ukuran BEDA dari klaim
    deps.setHead(requested.evidence.storage_key, { size: 5432 })

    const result = await confirmUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), requested.evidence.id)

    expect(result.evidence.status).toBe('confirmed')
    expect(result.evidence.confirmed_at).not.toBeNull()
    expect(result.evidence.file_size).toBe(5432) // dari HEAD, BUKAN klaim client
    expect(deps.headCalls).toContain(requested.evidence.storage_key)
  })

  it('E6 — confirm dgn head()→null → 422 ERR_UPLOAD_NOT_FOUND, status TETAP pending', async () => {
    const deps = makeDeps()
    const requested = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report',
      recordId: REPORT_DRAFT_A_ID,
      fileName: 'ghost.jpg',
      contentType: 'image/jpeg',
      fileSize: 1000,
    })
    // deps.setHead TIDAK dipanggil → head returns null (evidence hantu)

    await expect(
      confirmUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), requested.evidence.id),
    ).rejects.toMatchObject({ status: 422, code: 'ERR_UPLOAD_NOT_FOUND' })

    // Status tetap pending — retry-able
    const row = await evidenceRow(requested.evidence.id)
    expect(row?.status).toBe('pending')
    expect(row?.confirmedAt).toBeNull()
  })

  it('confirmUpload — HEAD size 0 → 422 ERR_VALIDATION (file kosong)', async () => {
    const deps = makeDeps()
    const requested = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report',
      recordId: REPORT_DRAFT_A_ID,
      fileName: 'x.jpg',
      contentType: 'image/jpeg',
      fileSize: 1000,
    })
    deps.setHead(requested.evidence.storage_key, { size: 0 })
    await expect(
      confirmUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), requested.evidence.id),
    ).rejects.toMatchObject({ status: 422, code: 'ERR_VALIDATION' })
  })

  it('confirmUpload — HEAD size >10MB → 422 ERR_VALIDATION (size lock via HEAD)', async () => {
    const deps = makeDeps()
    const requested = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report',
      recordId: REPORT_DRAFT_A_ID,
      fileName: 'x.jpg',
      contentType: 'image/jpeg',
      fileSize: 1000, // klaim kecil
    })
    // Client upload FILE 11MB → HEAD show ukuran aktual → reject
    deps.setHead(requested.evidence.storage_key, { size: EVIDENCE_MAX_SIZE + 1 })
    await expect(
      confirmUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), requested.evidence.id),
    ).rejects.toMatchObject({ status: 422, code: 'ERR_VALIDATION' })
  })

  it('E8 — request-upload ke report outlet luar scope → 404 ERR_OUT_OF_SCOPE', async () => {
    const deps = makeDeps()
    await expect(
      requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload' /* scoped to OUTLET_A */), {
        recordType: 'daily_report',
        recordId: REPORT_DRAFT_OOS_ID, // outlet_id = OOS, di luar scope uploader
        fileName: 'x.jpg',
        contentType: 'image/jpeg',
        fileSize: 100,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'ERR_OUT_OF_SCOPE' })
    expect(deps.putCalls).toHaveLength(0)
  })

  it('E9 — cross-company access ke report other-company → 404 ERR_OUT_OF_SCOPE', async () => {
    const deps = makeDeps()
    await expect(
      requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
        recordType: 'daily_report',
        recordId: REPORT_OTHER_COMPANY_ID, // company = OTHER_COMPANY_ID
        fileName: 'x.jpg',
        contentType: 'image/jpeg',
        fileSize: 100,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'ERR_OUT_OF_SCOPE' })
  })

  it('E12 — delete evidence pada report validated → 409 ERR_CONFLICT (immutable)', async () => {
    const deps = makeDeps()
    // Buat evidence di report DRAFT dulu (biar bisa dibuat), lalu ubah report ke validated.
    const requested = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report',
      recordId: REPORT_DRAFT_A_ID,
      fileName: 'x.jpg',
      contentType: 'image/jpeg',
      fileSize: 100,
    })
    // Ubah report ke validated
    await sql`UPDATE daily_reports SET status='validated', validated_by=${READER_USER_ID}, validated_at=now() WHERE id=${REPORT_DRAFT_A_ID}`

    await expect(
      deleteEvidence(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), requested.evidence.id),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })

    // Evidence TIDAK dihapus dari DB, R2 delete TIDAK dipanggil
    const row = await evidenceRow(requested.evidence.id)
    expect(row?.deletedAt).toBeNull()
    expect(deps.deleteCalls).toHaveLength(0)
  })

  it('E13 — delete evidence pada report draft → soft-delete + bucket.delete dipanggil', async () => {
    const deps = makeDeps()
    const requested = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report',
      recordId: REPORT_DRAFT_A_ID,
      fileName: 'x.jpg',
      contentType: 'image/jpeg',
      fileSize: 100,
    })

    const result = await deleteEvidence(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), requested.evidence.id)
    expect(result.success).toBe(true)

    // Soft-delete DB
    const row = await db
      .select()
      .from(evidence)
      .where(eq(evidence.id, requested.evidence.id))
      .limit(1)
      .then((r) => r[0])
    expect(row?.deletedAt).not.toBeNull()

    // R2 delete dipanggil
    expect(deps.deleteCalls).toContain(requested.evidence.storage_key)
  })

  it('deleteEvidence — R2 delete GAGAL → evidence tetap soft-deleted di DB (orphan object utang)', async () => {
    const requested = await requestUpload(db, makeDeps(), ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report',
      recordId: REPORT_DRAFT_A_ID,
      fileName: 'orphan.jpg',
      contentType: 'image/jpeg',
      fileSize: 100,
    })

    const failDeps = makeDeps({ failDelete: true })
    // R2 delete throws — service SHOULD NOT re-throw (silent swallow, DB sudah soft-deleted).
    await expect(
      deleteEvidence(db, failDeps, ctx(UPLOADER_USER_ID, 'evidence.upload'), requested.evidence.id),
    ).resolves.toEqual({ success: true })

    const row = await db
      .select()
      .from(evidence)
      .where(eq(evidence.id, requested.evidence.id))
      .limit(1)
      .then((r) => r[0])
    expect(row?.deletedAt).not.toBeNull()
    expect(failDeps.deleteCalls).toContain(requested.evidence.storage_key)
  })

  it('E15 — record_id tidak ada → 404 ERR_OUT_OF_SCOPE', async () => {
    const FAKE_ID = '9b200000-0000-4000-8000-000000000999'
    await expect(
      requestUpload(db, makeDeps(), ctx(UPLOADER_USER_ID, 'evidence.upload'), {
        recordType: 'daily_report',
        recordId: FAKE_ID,
        fileName: 'x.jpg',
        contentType: 'image/jpeg',
        fileSize: 100,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'ERR_OUT_OF_SCOPE' })
  })

  it('listEvidence — return confirmed + pending, exclude deleted', async () => {
    const deps = makeDeps()
    const r1 = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report', recordId: REPORT_DRAFT_A_ID, fileName: '1.jpg', contentType: 'image/jpeg', fileSize: 100,
    })
    const r2 = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report', recordId: REPORT_DRAFT_A_ID, fileName: '2.jpg', contentType: 'image/jpeg', fileSize: 100,
    })
    // r2 confirmed
    deps.setHead(r2.evidence.storage_key, { size: 100 })
    await confirmUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), r2.evidence.id)
    // r1 di-delete
    await deleteEvidence(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), r1.evidence.id)

    const list = await listEvidence(db, ctx(READER_USER_ID, 'evidence.read'), {
      recordType: 'daily_report',
      recordId: REPORT_DRAFT_A_ID,
    })
    // Hanya r2 (confirmed) yang muncul; r1 sudah soft-deleted
    expect(list.data).toHaveLength(1)
    expect(list.data[0].id).toBe(r2.evidence.id)
    expect(list.data[0].status).toBe('confirmed')
  })

  it('listEvidence — record luar scope → 404', async () => {
    await expect(
      listEvidence(db, ctx(READER_USER_ID, 'evidence.read'), {
        recordType: 'daily_report',
        recordId: REPORT_DRAFT_OOS_ID,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'ERR_OUT_OF_SCOPE' })
  })

  it('getViewUrl — confirmed → presigned GET url', async () => {
    const deps = makeDeps()
    const requested = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report', recordId: REPORT_DRAFT_A_ID, fileName: 'x.jpg', contentType: 'image/jpeg', fileSize: 100,
    })
    deps.setHead(requested.evidence.storage_key, { size: 100 })
    await confirmUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), requested.evidence.id)

    const result = await getViewUrl(db, deps, ctx(READER_USER_ID, 'evidence.read'), requested.evidence.id)
    expect(result.view_url).toContain('mock/get/')
    expect(result.expires_in).toBe(EVIDENCE_VIEW_EXPIRES_IN)
    expect(deps.getCalls).toHaveLength(1)
    expect(deps.getCalls[0]).toEqual({
      key: requested.evidence.storage_key,
      expiresIn: EVIDENCE_VIEW_EXPIRES_IN,
    })
  })

  it('getViewUrl — pending (belum confirmed) → 409', async () => {
    const deps = makeDeps()
    const requested = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report', recordId: REPORT_DRAFT_A_ID, fileName: 'x.jpg', contentType: 'image/jpeg', fileSize: 100,
    })
    await expect(
      getViewUrl(db, deps, ctx(READER_USER_ID, 'evidence.read'), requested.evidence.id),
    ).rejects.toMatchObject({ status: 409, code: 'ERR_CONFLICT' })
  })

  it('getViewUrl — cross-company → 404', async () => {
    const deps = makeDeps()
    const requested = await requestUpload(db, deps, ctx(UPLOADER_USER_ID, 'evidence.upload'), {
      recordType: 'daily_report', recordId: REPORT_DRAFT_A_ID, fileName: 'x.jpg', contentType: 'image/jpeg', fileSize: 100,
    })
    const otherCtx: EvidenceServiceContext = {
      companyId: OTHER_COMPANY_ID,
      actorUserId: OTHER_COMPANY_USER_ID,
      accessFilter: {
        permission: 'evidence.read',
        ownOnly: false,
        assignedOnly: false,
        rowLevelScopes: [],
        structuralScopes: [{ scopeType: 'outlet', scopeId: OTHER_OUTLET_ID }],
      },
    }
    await expect(
      getViewUrl(db, deps, otherCtx, requested.evidence.id),
    ).rejects.toMatchObject({ status: 404, code: 'ERR_OUT_OF_SCOPE' })
  })
})

// silence lints for unused where checks
void isNull
void and
