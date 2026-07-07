# EGG OS — Evidence (3A-Evidence) Module Spec (Buildable) v0.1

**Type:** Buildable Module Spec (Sub-pass 3A — Evidence Upload via Cloudflare R2)
**Project:** EGG OS · **Owner:** Ilham Juniansyah S (ERP Owner)
**Stack:** Cloudflare Workers + Hono + TypeScript + Zod + Drizzle + PostgreSQL + **Cloudflare R2** (pertama kali di-wire)
**Depends on:** API_CONVENTIONS.md + Global Contract + AUTH + RBAC (scope) + Daily Report 3A (caller pertama) + CORE (outlets). **BACA semua.**
**Goal:** Upload bukti (foto/PDF) untuk aktivitas high-risk, tersimpan di R2, ter-link ke record (report/waste/opname/dst). Polymorphic **tipis** — satu tabel evidence dipakai banyak modul. Presigned URL (client upload langsung ke R2, hemat Worker). Menyetir KPI **evidence completion ≥90%**.

> **Turunan dari PRD §7.7 (Evidence Upload).** PRD punya 7 caller aktivitas (stock-in, waste, opname, void, complaint, emergency-use, operational issue). Spec ini bikin evidence REUSABLE untuk semua, tapi **caller pertama = Daily Report 3A** (aktivitas lain wire belakangan saat modul-nya siap). "Tipis" = polymorphic secukupnya, BUKAN framework generik.

---

## 0. Scope

**MASUK (3A-Evidence):**
- Tabel `evidence` polymorphic (record_type + record_id) — reusable semua modul.
- Cloudflare R2 wiring pertama: bucket binding, presigned URL generation, HEAD verify.
- Upload flow presigned 3-step: request URL → client upload ke R2 → confirm + verify.
- Evidence ke-link ke **daily_reports** sebagai caller pertama (record_type='daily_report').
- Access control per-type (scope evidence ngikut scope record induknya).
- Immutability: evidence pada record final → tidak bisa dihapus.

**DI LUAR SCOPE (jangan bangun sekarang):**
- **Caller selain daily_report** (waste/opname/complaint evidence) → wire saat modul relevan siap. Schema SUDAH siap nampung, tapi endpoint/validasi per-type baru daily_report.
- **Magic-bytes / virus scan** — presigned tidak bisa inspect isi file (hanya content-type header). ACCEPTABLE untuk evidence low-risk; catat utang.
- **Image processing** (resize, thumbnail, watermark) — Phase 2.
- **Video** — presigned support, tapi tidak di-optimize sekarang (foto/PDF fokus).

---

## 1. Prinsip (baca sebelum schema)

1. **Presigned URL, client upload LANGSUNG ke R2.** Worker TIDAK menerima file (hemat CPU-ms). Worker hanya: generate presigned URL (dengan lock) + catat record + verify.
2. **Polymorphic TIPIS.** Satu tabel `evidence`, kolom `record_type` (varchar) + `record_id` (uuid). TIDAK ada FK ke tabel record (polymorphic tidak bisa FK ke banyak tabel). Integritas dijaga di **service layer** (validasi record_id + record_type ada + dalam scope) sebelum insert.
3. **Key ditentukan Worker, bukan client.** Storage key = `{company}/{outlet}/{record_type}/{record_id}/{uuid}.{ext}`. Client TIDAK pilih path (cegah path traversal + overwrite).
4. **Presigned lock (4 constraint):** expiry pendek (10 menit), content-type (whitelist), content-length max (10MB), key fixed. Di-enforce R2 via signature.
5. **HEAD verify sebelum commit.** Setelah client confirm upload, Worker HEAD ke R2 mastiin file beneran ada + ukuran sesuai. Baru insert evidence record. Cegah evidence hantu (ngaku upload tapi nggak ada file).
6. **Access = scope record induk.** Evidence daily_report ke-scope via report.outlet. Siapa bisa liat report, bisa liat evidence-nya. Cross-scope → 404.
7. **Immutability EVD-004.** Evidence pada record `validated`/final → tidak bisa dihapus. Pada draft/pending → boleh hapus/ganti.

---

## 2. Data Model — Drizzle schema

```ts
// packages/db/src/schema/evidence.ts
import { pgTable, uuid, varchar, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),          // FK companies
  outletId: uuid("outlet_id"),                       // FK outlets (nullable — sebagian record mungkin company-level; report selalu ada outlet)
  recordType: varchar("record_type", { length: 40 }).notNull(),  // 'daily_report' (nanti: 'waste','opname','complaint',...)
  recordId: uuid("record_id").notNull(),             // id record induk (NO FK — polymorphic, validasi app-level)
  storageKey: varchar("storage_key", { length: 500 }).notNull(),  // key di R2 (ditentukan Worker)
  fileName: varchar("file_name", { length: 255 }).notNull(),      // nama asli (display)
  contentType: varchar("content_type", { length: 100 }).notNull(),// image/jpeg | image/png | application/pdf
  fileSize: integer("file_size").notNull(),          // bytes (dari HEAD verify)
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending|confirmed (pending = URL dikeluarkan, belum verify; confirmed = HEAD verified)
  uploadedBy: uuid("uploaded_by").notNull(),         // FK users
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),  // saat HEAD verify sukses
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),      // soft delete (evidence draft boleh dihapus)
}, (t) => ({
  typeCheck: check("evidence_record_type_check", sql`${t.recordType} IN ('daily_report')`),  // MVP: hanya daily_report. TAMBAH type saat modul lain wire.
  statusCheck: check("evidence_status_check", sql`${t.status} IN ('pending','confirmed')`),
  contentTypeCheck: check("evidence_content_type_check", sql`${t.contentType} IN ('image/jpeg','image/png','application/pdf')`),
  recordIdx: index("evidence_record_idx").on(t.recordType, t.recordId),  // query evidence per record
  companyIdx: index("evidence_company_idx").on(t.companyId),
  outletIdx: index("evidence_outlet_idx").on(t.outletId),
}));
```

> **Polymorphic tipis:** `record_type` CHECK sekarang HANYA `'daily_report'`. Saat modul lain (waste/complaint) butuh evidence, TAMBAH nilai ke CHECK + wire validasi per-type. Ini "tipis" — schema siap, tapi tidak bikin type yang belum ada caller-nya. Cegah premature.

> **NO FK ke record induk.** `record_id` polymorphic — integritas dijaga service (validasi record ada + scope). Index `(record_type, record_id)` untuk query cepat.

---

## 3. R2 Wiring (infra baru — pertama kali)

```
wrangler.toml: tambah R2 bucket binding
  [[r2_buckets]]
  binding = "EVIDENCE_BUCKET"
  bucket_name = "egg-os-evidence"   (production)
  preview_bucket_name = "egg-os-evidence-preview"  (dev)

Env: EVIDENCE_BUCKET accessible via c.env.EVIDENCE_BUCKET (R2Bucket binding).

Presigned URL: pakai R2 presigned (aws4 signature / R2 API). 
  - Generate via @aws-sdk/s3-request-presigner ATAU R2 native presign (cek dokumen Cloudflare terkini).
  - LOCK di signature: expiry 600s, ContentType (fixed), ContentLength range (max 10MB), key (fixed by Worker).

Test: R2 tidak ada di container lokal. Untuk test:
  - Mock R2Bucket binding (put/head/get) di test harness ATAU
  - Gunakan miniflare R2 simulation kalau tersedia.
  - Flag ke Owner: R2 test butuh mock/miniflare — TIDAK bisa pakai Postgres container.
  - Test fokus: logika service (key generation, validasi, scope, HEAD-verify flow) dengan R2 di-mock. Integrasi R2 nyata = manual/staging test.
```

**PENTING (flag saat build):** R2 tidak jalan di test container Postgres. Codex HARUS lapor strategi test R2 (mock binding) SEBELUM implement, dan Owner konfirmasi. Jangan asumsi.

---

## 4. Upload Flow (presigned 3-step)

```
STEP 1 — Request presigned URL (POST /evidence/request-upload)
  Client kirim: record_type, record_id, file_name, content_type, file_size (estimasi)
  Worker:
    - cek permission (evidence.upload) + resolve scope record induk (record_type='daily_report' → cek report ada + outlet dalam scope). Cross-scope → 404.
    - cek record status: kalau record sudah final/validated → 409 (tidak bisa tambah evidence ke record final). [immutability EVD-004]
    - validasi content_type (whitelist) + file_size (≤10MB) → 422 kalau invalid.
    - generate key = {company}/{outlet}/{record_type}/{record_id}/{uuid}.{ext}
    - generate presigned PUT URL (lock: expiry 600s, content-type, content-length max, key).
    - insert evidence record status='pending', storage_key, uploaded_by=ctx.
    - return { evidence_id, upload_url, expires_in, key }.

STEP 2 — Client upload LANGSUNG ke R2 (client-side, bukan Worker)
  Client PUT file ke upload_url dengan Content-Type sesuai. R2 enforce signature lock.
  (Worker TIDAK terlibat — hemat CPU.)

STEP 3 — Confirm upload (POST /evidence/:id/confirm)
  Worker:
    - lock evidence row (pending, scope-checked).
    - HEAD ke R2 (c.env.EVIDENCE_BUCKET.head(key)) → mastiin file ada + size sesuai.
      Kalau tidak ada / size mismatch → 422 ERR_UPLOAD_NOT_FOUND (evidence hantu). status tetap pending (bisa retry).
    - update status='confirmed', confirmed_at=now, file_size (aktual dari HEAD).
    - return evidence confirmed.

DELETE (DELETE /evidence/:id) — hanya kalau record induk belum final
  - lock evidence. cek record induk status: kalau validated/final → 409 (immutable EVD-004).
  - kalau boleh: soft-delete (deleted_at) + delete object di R2 (c.env.EVIDENCE_BUCKET.delete(key)).
  - audit.

GET evidence (GET /evidence?record_type=&record_id=)
  - list evidence untuk record (scope-checked). return metadata + (opsional) presigned GET URL untuk view.
GET /evidence/:id/view-url
  - generate presigned GET URL (expiry pendek) untuk lihat file. Scope-checked.
```

---

## 5. Endpoints — kontrak

> Base `/api/v1/evidence`. authMiddleware + requirePermission. Verb-path per API_CONVENTIONS.

| # | Method | Path | Permission | Catatan |
|---|---|---|---|---|
| 1 | POST | `/evidence/request-upload` | `evidence.upload` | step 1: minta presigned URL, insert pending |
| 2 | POST | `/evidence/:id/confirm` | `evidence.upload` | step 3: HEAD verify, status confirmed |
| 3 | GET | `/evidence` | `evidence.read` | list per record (record_type + record_id), scope-checked |
| 4 | GET | `/evidence/:id/view-url` | `evidence.read` | presigned GET URL (lihat file) |
| 5 | DELETE | `/evidence/:id` | `evidence.upload` | hapus (hanya kalau record induk belum final) |

### Zod inti
```ts
const RequestUploadReq = z.object({
  record_type: z.enum(["daily_report"]),   // MVP: hanya daily_report
  record_id: z.string().uuid(),
  file_name: z.string().min(1).max(255),
  content_type: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  file_size: z.number().int().positive().max(10 * 1024 * 1024), // ≤10MB
});

const ListEvidenceQuery = z.object({
  record_type: z.enum(["daily_report"]),
  record_id: z.string().uuid(),
});
```

---

## 6. Permission (tambah ke RBAC seed)

- `evidence.upload` — request URL, confirm, delete (Staff/SPV/Manager — yang bikin record bisa lampirin bukti)
- `evidence.read` — list + view-url (semua role operasional + Auditor read-only)

Auto-assign ikut pola: upload → STAFF/SPV_OUTLET/MANAGER; read → operasional + DIREKSI/AUDITOR/SUPER_ADMIN. item_manage tidak relevan.

---

## 7. Acceptance Criteria

```text
UPLOAD FLOW
E1 POST /request-upload valid → 201, presigned URL + evidence pending, key benar (company/outlet/type/id/uuid)
E2 POST /request-upload content_type non-whitelist → 422
E3 POST /request-upload file_size >10MB → 422
E4 POST /request-upload ke report yang sudah validated → 409 (immutable)
E5 POST /:id/confirm setelah file ada di R2 (mock) → 200, status confirmed, confirmed_at terisi
E6 POST /:id/confirm tapi file TIDAK ada di R2 (mock HEAD miss) → 422 ERR_UPLOAD_NOT_FOUND, status tetap pending
E7 presigned URL lock: content-type/size/key ter-set di signature (verifikasi param)

SCOPE / TENANT / ACCESS
E8 request-upload ke report outlet luar scope → 404
E9 GET /evidence record outlet luar scope → 404
E10 evidence company lain → 404
E11 GET /:id/view-url scope-checked → presigned GET, cross-scope 404

IMMUTABILITY
E12 DELETE evidence pada report validated → 409 (immutable EVD-004)
E13 DELETE evidence pada report draft → 200, soft-delete + R2 delete

POLYMORPHIC
E14 record_type non-daily_report (belum di-wire) → 422 (CHECK/Zod tolak)
E15 record_id tidak ada / bukan report valid → 404 (validasi app-level, karena no FK)

ENFORCEMENT
E16 tanpa evidence.upload → request-upload 403
E17 tanpa evidence.read → GET 403
E18 tanpa Bearer → 401
```

---

## 8. Definition of Done — 3A-Evidence
```
[ ] Schema evidence (polymorphic tipis, CHECK record_type='daily_report' only) + migrate LOKAL
[ ] R2 binding wrangler.toml + presigned URL generation (4 lock)
[ ] Upload flow 3-step: request → (client upload) → confirm + HEAD verify
[ ] HEAD verify cegah evidence hantu — E6
[ ] Presigned lock: content-type + size + key + expiry — E7
[ ] Scope = record induk (daily_report outlet) — E8/E9
[ ] Immutability: evidence pada report validated tidak bisa dihapus — E12
[ ] Polymorphic validasi app-level (record_id ada + scope, no FK) — E15
[ ] Permission evidence.upload/read + seed + count updated
[ ] R2 test strategy (mock/miniflare) — dikonfirmasi Owner, service logic tetap tertest
[ ] SEMUA acceptance E1-E18 (yang testable dengan R2 mock) hijau
[ ] Tidak regresi: 219 test existing hijau
[ ] Daily Report 3A service TIDAK diubah (evidence link satu arah — evidence tahu report, report tidak tahu evidence; ATAU report expose evidence via GET terpisah)
[ ] apps/web TIDAK disentuh
```

---

## 9. Pecahan sprint
```
Langkah 0 (PRA): Konfirmasi strategi test R2 (mock binding vs miniflare) + wrangler R2 binding. STOP, Owner konfirmasi.
Langkah 1: Schema evidence + migration LOKAL + permission seed + R2 binding wrangler. STOP audit.
Langkah 2: Service (request-upload + presigned gen + confirm + HEAD verify + delete + list + scope validasi polymorphic) + test (R2 mock). STOP audit.
Langkah 3: Endpoint (5 route verb-path) + Zod + permission + test HTTP. STOP audit.
```

---

## 10. Keputusan Owner (sudah dikonfirmasi)
1. **Upload flow: PRESIGNED URL** (bukan proxy) — hemat Worker CPU, beban ke R2. Ribet di awal (3-step) diterima.
2. **Key structure: `{company}/{outlet}/{record_type}/{record_id}/{uuid}.{ext}`** — record_type masuk key (polymorphic).
3. **Immutability: draft boleh hapus/ganti, validated immutable** (EVD-004).
4. **Polymorphic TIPIS** — 1 tabel evidence, record_type CHECK hanya 'daily_report' sekarang, tambah type saat modul lain wire. Validasi app-level (no FK).

## 11. Utang tercatat
- **Magic-bytes / content inspection** — presigned tidak bisa cek isi file (hanya content-type header, bisa dipalsu client). ACCEPTABLE untuk evidence low-risk (foto operasional, tidak di-execute). Reconsider kalau evidence dipakai konteks sensitif. → utang security.
- **R2 integration test nyata** — MVP test pakai mock. Integrasi R2 nyata = manual/staging. → utang test.
- **Caller lain (waste/opname/complaint)** — schema siap, wire saat modul relevan. → bukan utang, by-design tipis.

---

*3A-Evidence = bukti foto/PDF ter-link ke record, via R2 presigned (hemat Worker). Polymorphic tipis: satu tabel, caller pertama daily_report, siap nampung modul lain tanpa over-engineer. Nutup 3A jadi utuh — report + bukti. Menyetir KPI evidence completion ≥90%.*
