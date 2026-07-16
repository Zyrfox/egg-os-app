import { AwsClient } from 'aws4fetch'
import { and, eq, isNull } from 'drizzle-orm'
import { dailyReports, evidence } from '@egg-os/db'
import { ERR } from '../../lib/errors'
import type { Db } from '../../lib/db'
import { assertOutletInScope, type ScopeContext } from '../../lib/scope'
import { auditLog } from '../../lib/audit'

// ── Types + constants ──────────────────────────────────────────────────────

export type EvidenceServiceContext = ScopeContext
export type RecordType = 'daily_report'
export type EvidenceStatus = 'pending' | 'confirmed'
export type EvidenceContentType = 'image/jpeg' | 'image/png' | 'application/pdf'

export const EVIDENCE_MAX_SIZE = 10 * 1024 * 1024
export const EVIDENCE_UPLOAD_EXPIRES_IN = 600
export const EVIDENCE_VIEW_EXPIRES_IN = 300
export const EVIDENCE_BUCKET_NAME = 'egg-os-evidence'
export const EVIDENCE_ALLOWED_CONTENT_TYPES: readonly EvidenceContentType[] = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const

const CONTENT_TYPE_EXT: Record<EvidenceContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

// ── Injectable deps (biar test bisa mock signer + bucket) ─────────────────

export interface EvidencePresigner {
  presignPut(input: { key: string; contentType: string; expiresIn: number }): Promise<string>
  presignGet(input: { key: string; expiresIn: number }): Promise<string>
}

export interface EvidenceStorage {
  head(key: string): Promise<{ size: number } | null>
  delete(key: string): Promise<unknown>
}

export type EvidenceDeps = {
  bucket: EvidenceStorage
  presigner: EvidencePresigner
}

export type EvidenceR2Env = {
  R2_ACCOUNT_ID: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
}

// Default presigner — aws4fetch AwsClient. Lock content-type via signed header,
// expiry via X-Amz-Expires. Size TIDAK ke-lock di signature (PUT presigned tidak support
// content-length-range; kalau Content-Length di-sign eksak, fragile terhadap client tweaking).
// Size di-enforce via HEAD verify saat confirmUpload (R2 = source of truth).
export function createR2Presigner(env: EvidenceR2Env, bucketName = EVIDENCE_BUCKET_NAME): EvidencePresigner {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  })
  const base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucketName}`

  return {
    async presignPut({ key, contentType, expiresIn }) {
      const url = new URL(`${base}/${key}`)
      url.searchParams.set('X-Amz-Expires', String(expiresIn))
      const signed = await client.sign(url.toString(), {
        method: 'PUT',
        headers: { 'content-type': contentType },
        aws: { signQuery: true },
      })
      return signed.url.toString()
    },
    async presignGet({ key, expiresIn }) {
      const url = new URL(`${base}/${key}`)
      url.searchParams.set('X-Amz-Expires', String(expiresIn))
      const signed = await client.sign(url.toString(), {
        method: 'GET',
        aws: { signQuery: true },
      })
      return signed.url.toString()
    },
  }
}

// ── Errors ─────────────────────────────────────────────────────────────────

export type ErrorDetail = { field: string; issue: string }

export class EvidenceServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message)
  }
}

function outOfScope() {
  return new EvidenceServiceError(ERR.OUT_OF_SCOPE.http, ERR.OUT_OF_SCOPE.code, ERR.OUT_OF_SCOPE.message)
}
function conflict(message: string) {
  return new EvidenceServiceError(ERR.CONFLICT.http, ERR.CONFLICT.code, message)
}
function validation(details: ErrorDetail[]) {
  return new EvidenceServiceError(ERR.VALIDATION.http, ERR.VALIDATION.code, ERR.VALIDATION.message, details)
}
function uploadNotFound() {
  return new EvidenceServiceError(ERR.UPLOAD_NOT_FOUND.http, ERR.UPLOAD_NOT_FOUND.code, ERR.UPLOAD_NOT_FOUND.message)
}

// ── DTO ───────────────────────────────────────────────────────────────────

type EvidenceRow = typeof evidence.$inferSelect

function iso(v: Date | null) {
  return v?.toISOString() ?? null
}

function evidenceDto(row: EvidenceRow) {
  return {
    id: row.id,
    company_id: row.companyId,
    outlet_id: row.outletId,
    record_type: row.recordType,
    record_id: row.recordId,
    storage_key: row.storageKey,
    file_name: row.fileName,
    content_type: row.contentType,
    file_size: row.fileSize,
    status: row.status,
    uploaded_by: row.uploadedBy,
    uploaded_at: row.uploadedAt.toISOString(),
    confirmed_at: iso(row.confirmedAt),
    created_at: row.createdAt.toISOString(),
  }
}

// ── Record resolution (polymorphic — app-level, no FK ke record induk) ────

type ResolvedRecord = {
  recordType: RecordType
  recordId: string
  companyId: string
  outletId: string
  isImmutable: boolean
}

async function resolveRecord(
  db: Db,
  ctx: EvidenceServiceContext,
  recordType: RecordType,
  recordId: string,
): Promise<ResolvedRecord> {
  // MVP: hanya daily_report. Modul lain (waste/opname/complaint) TAMBAH branch di sini + CHECK schema.
  if (recordType !== 'daily_report') {
    throw validation([{ field: 'record_type', issue: 'record_type belum di-wire' }])
  }
  const row = await db
    .select({
      id: dailyReports.id,
      companyId: dailyReports.companyId,
      outletId: dailyReports.outletId,
      status: dailyReports.status,
    })
    .from(dailyReports)
    .where(
      and(
        eq(dailyReports.id, recordId),
        eq(dailyReports.companyId, ctx.companyId),
        isNull(dailyReports.deletedAt),
      ),
    )
    .limit(1)
    .then((rs) => rs[0] ?? null)
  if (!row) throw outOfScope()
  return {
    recordType: 'daily_report',
    recordId: row.id,
    companyId: row.companyId,
    outletId: row.outletId,
    isImmutable: row.status === 'validated',
  }
}

async function lockEvidence(db: Db, ctx: EvidenceServiceContext, id: string) {
  const row = await db
    .select()
    .from(evidence)
    .where(
      and(
        eq(evidence.id, id),
        eq(evidence.companyId, ctx.companyId),
        isNull(evidence.deletedAt),
      ),
    )
    .for('update')
    .limit(1)
    .then((rs) => rs[0] ?? null)
  if (!row) throw outOfScope()
  return row
}

// ── requestUpload ──────────────────────────────────────────────────────────

export type RequestUploadInput = {
  recordType: RecordType
  recordId: string
  fileName: string
  contentType: EvidenceContentType
  fileSize: number
}

export async function requestUpload(
  db: Db,
  deps: EvidenceDeps,
  ctx: EvidenceServiceContext,
  input: RequestUploadInput,
) {
  // Defense-in-depth (Zod juga cek di endpoint layer).
  if (!EVIDENCE_ALLOWED_CONTENT_TYPES.includes(input.contentType)) {
    throw validation([{ field: 'content_type', issue: 'content_type tidak didukung' }])
  }
  if (!Number.isInteger(input.fileSize) || input.fileSize <= 0 || input.fileSize > EVIDENCE_MAX_SIZE) {
    throw validation([{ field: 'file_size', issue: `file_size harus 1..${EVIDENCE_MAX_SIZE} bytes` }])
  }
  if (!input.fileName || input.fileName.length === 0 || input.fileName.length > 255) {
    throw validation([{ field: 'file_name', issue: 'file_name wajib 1..255 char' }])
  }

  const record = await resolveRecord(db, ctx, input.recordType, input.recordId)
  await assertOutletInScope(db, ctx, record.outletId, 'evidence.upload')
  if (record.isImmutable) {
    throw conflict('Record sudah final, tidak bisa tambah evidence')
  }

  // Key ditentukan Worker (cegah path traversal + overwrite). Ext dari content-type map,
  // BUKAN dari file_name client (biar client tidak bisa upload PDF disamarin ext .jpg).
  const ext = CONTENT_TYPE_EXT[input.contentType]
  const objectId = crypto.randomUUID()
  const key = `${ctx.companyId}/${record.outletId}/${input.recordType}/${input.recordId}/${objectId}.${ext}`

  const uploadUrl = await deps.presigner.presignPut({
    key,
    contentType: input.contentType,
    expiresIn: EVIDENCE_UPLOAD_EXPIRES_IN,
  })

  const row = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const [r] = await txDb
      .insert(evidence)
      .values({
        companyId: ctx.companyId,
        outletId: record.outletId,
        recordType: input.recordType,
        recordId: input.recordId,
        storageKey: key,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSize: input.fileSize, // KLAIM client; source of truth di-set saat confirmUpload dari HEAD
        status: 'pending',
        uploadedBy: ctx.actorUserId,
      })
      .returning()
    await auditLog(txDb, ctx, {
      action: 'evidence.request_upload',
      recordType: 'evidence',
      recordId: r.id,
      outletId: record.outletId,
      meta: { record_type: input.recordType, record_id: input.recordId, file_name: input.fileName },
    })
    return r
  })

  return {
    evidence: evidenceDto(row),
    upload_url: uploadUrl,
    expires_in: EVIDENCE_UPLOAD_EXPIRES_IN,
  }
}

// ── confirmUpload ──────────────────────────────────────────────────────────

export async function confirmUpload(
  db: Db,
  deps: EvidenceDeps,
  ctx: EvidenceServiceContext,
  id: string,
) {
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const row = await lockEvidence(txDb, ctx, id)
    const record = await resolveRecord(txDb, ctx, row.recordType as RecordType, row.recordId)
    await assertOutletInScope(txDb, ctx, record.outletId, 'evidence.upload')

    // HEAD ke R2 — source of truth: file ada + size aktual.
    // File TIDAK ADA → 422 UPLOAD_NOT_FOUND, status TETAP pending (client boleh retry).
    const head = await deps.bucket.head(row.storageKey)
    if (!head) throw uploadNotFound()

    if (head.size <= 0 || head.size > EVIDENCE_MAX_SIZE) {
      throw validation([
        { field: 'file_size', issue: `ukuran file di storage (${head.size} bytes) di luar batas ${EVIDENCE_MAX_SIZE}` },
      ])
    }

    // Idempoten: sudah confirmed → return apa adanya.
    if (row.status === 'confirmed') {
      return { evidence: evidenceDto(row) }
    }

    const [updated] = await txDb
      .update(evidence)
      .set({
        status: 'confirmed',
        confirmedAt: new Date(),
        fileSize: head.size,
      })
      .where(
        and(
          eq(evidence.id, id),
          eq(evidence.companyId, ctx.companyId),
          eq(evidence.status, 'pending'),
        ),
      )
      .returning()
    if (!updated) throw conflict('Status bukan pending')
    await auditLog(txDb, ctx, {
      action: 'evidence.confirm',
      recordType: 'evidence',
      recordId: id,
      outletId: record.outletId,
      meta: { record_type: row.recordType, record_id: row.recordId, file_size: head.size },
    })
    return { evidence: evidenceDto(updated) }
  })
}

// ── deleteEvidence ────────────────────────────────────────────────────────

export async function deleteEvidence(
  db: Db,
  deps: EvidenceDeps,
  ctx: EvidenceServiceContext,
  id: string,
) {
  // Soft-delete DB dulu (dalam txn). R2 delete = best-effort setelah commit karena R2
  // TIDAK transactional. Kalau R2 delete gagal → object orphan di R2 (utang tercatat),
  // evidence sudah tidak visible via list/GET. Konsisten dari sisi user.
  const storageKey = await db.transaction(async (tx) => {
    const txDb = tx as unknown as Db
    const row = await lockEvidence(txDb, ctx, id)
    const record = await resolveRecord(txDb, ctx, row.recordType as RecordType, row.recordId)
    await assertOutletInScope(txDb, ctx, record.outletId, 'evidence.upload')
    if (record.isImmutable) {
      throw conflict('Record sudah final, evidence tidak bisa dihapus')
    }

    await txDb
      .update(evidence)
      .set({ deletedAt: new Date() })
      .where(eq(evidence.id, id))
    await auditLog(txDb, ctx, {
      action: 'evidence.delete',
      recordType: 'evidence',
      recordId: id,
      outletId: record.outletId,
      meta: { record_type: row.recordType, record_id: row.recordId, storage_key: row.storageKey },
    })
    return row.storageKey
  })

  try {
    await deps.bucket.delete(storageKey)
  } catch {
    // Silent — evidence sudah soft-deleted di DB. Orphan object R2 = utang.
  }
  return { success: true }
}

// ── listEvidence ──────────────────────────────────────────────────────────

export type ListEvidenceQuery = {
  recordType: RecordType
  recordId: string
}

export async function listEvidence(
  db: Db,
  ctx: EvidenceServiceContext,
  query: ListEvidenceQuery,
) {
  const record = await resolveRecord(db, ctx, query.recordType, query.recordId)
  await assertOutletInScope(db, ctx, record.outletId, 'evidence.read')

  const rows = await db
    .select()
    .from(evidence)
    .where(
      and(
        eq(evidence.companyId, ctx.companyId),
        eq(evidence.recordType, query.recordType),
        eq(evidence.recordId, query.recordId),
        isNull(evidence.deletedAt),
      ),
    )
    .orderBy(evidence.createdAt)

  return { data: rows.map(evidenceDto) }
}

// ── getViewUrl ────────────────────────────────────────────────────────────

export async function getViewUrl(
  db: Db,
  deps: EvidenceDeps,
  ctx: EvidenceServiceContext,
  id: string,
) {
  const row = await db
    .select()
    .from(evidence)
    .where(
      and(
        eq(evidence.id, id),
        eq(evidence.companyId, ctx.companyId),
        isNull(evidence.deletedAt),
      ),
    )
    .limit(1)
    .then((rs) => rs[0] ?? null)
  if (!row) throw outOfScope()

  const record = await resolveRecord(db, ctx, row.recordType as RecordType, row.recordId)
  await assertOutletInScope(db, ctx, record.outletId, 'evidence.read')

  if (row.status !== 'confirmed') {
    throw conflict('Evidence belum confirmed, view URL belum tersedia')
  }

  const viewUrl = await deps.presigner.presignGet({
    key: row.storageKey,
    expiresIn: EVIDENCE_VIEW_EXPIRES_IN,
  })
  return { view_url: viewUrl, expires_in: EVIDENCE_VIEW_EXPIRES_IN }
}
