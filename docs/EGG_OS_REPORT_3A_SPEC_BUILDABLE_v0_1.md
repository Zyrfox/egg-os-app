# EGG OS — Daily Report (3A) Module Spec (Buildable) v0.1

**Type:** Buildable Module Spec (Sprint 3A — Operational Daily Report)
**Project:** EGG OS · **Owner:** Ilham Juniansyah S (ERP Owner)
**Stack:** Cloudflare Workers + Hono + TypeScript + Zod + Drizzle ORM + PostgreSQL (Hyperdrive)
**Depends on:** API_CONVENTIONS.md (canonical) + Global Contract + AUTH (`ctx`) + RBAC (`requirePermission`, scope) + CORE (outlets/departments) + USERS. **BACA semua.**
**Goal:** Laporan operasional harian terstruktur (opening/closing/issue) menggantikan checklist WhatsApp. Staff isi checklist + submit → SPV validate/reject → user revise. Final tidak bisa diedit. Menyetir KPI **report compliance ≥95%** (laporan keisi & ter-validasi per outlet per hari).

> **Turunan dari PRD MVP §7.5 (Operational Daily Report).** Spec ini = penajaman §7.5 jadi buildable, BUKAN penambahan scope. Status flow disederhanakan atas keputusan Owner (KPI bulanan = fokus, bukan workflow revisi berlapis).

---

## 0. Scope

**MASUK (3A):**
- 3 tipe report P0: `opening`, `closing`, `issue` (Daily Issue Report).
- Checklist terstruktur per tipe report (item dari tabel master, bisa diupdate tanpa deploy).
- Status flow: `draft → submitted → validated`, dengan `rejected → revise → submitted` lagi.
- Validasi oleh SPV outlet (scope-filtered).
- Query KPI compliance (per outlet per periode).

**DI LUAR SCOPE (jangan bangun sekarang):**
- **Evidence upload / Cloudflare R2** → sub-pass terpisah (3A-Evidence). Report jalan dulu tanpa lampiran.
- **Task delegation / assignment ke orang/tim** (nama tertera) → modul 3B (Task), terpisah.
- **Manager approval per report** → 3B.
- **Cleaning checklist, shift handover, complaint note** → P1 PRD, tunda.
- **Template checklist configurable lewat UI per outlet** (template-builder) → tidak sekarang. Item master cukup di-seed + update data.
- **Correction request workflow** untuk report final → modul COR (correction) terpisah; di 3A, final = immutable (tolak edit), correction request belum di-wire.

---

## 1. Prinsip (baca sebelum schema)

1. **Report = header + jawaban checklist.** Header (`daily_reports`) menyimpan status, outlet, tanggal, tipe. Jawaban (`report_checklist_answers`) menyimpan centang/nilai per item checklist.
2. **Checklist item = master, bukan bagian report.** Item didefinisikan sekali di `report_checklist_items` (di-seed, bisa diupdate). Report mengacu ke item via FK. Mengubah item = update data, BUKAN deploy. Ini BUKAN template-builder (tidak ada CRUD template per outlet lewat UI di MVP) — hanya master item global/per-outlet.
3. **Final (validated) = immutable.** Report `validated` tidak bisa diedit langsung (PRD OPS-008, prinsip "no final data without correction"). Koreksi lewat modul COR nanti — di 3A cukup TOLAK edit pada status validated.
4. **Satu report per (outlet, tipe, tanggal).** Tidak boleh ada 2 opening report untuk outlet+tanggal sama (cegah duplikat laporan). Unique constraint.
5. **Tenant + scope dari auth.** `company_id` & aktor dari ctx, tidak pernah dari body. Outlet di luar scope user → 404 (anti-enumeration, konsisten API_CONVENTIONS §7).

---

## 2. Data Model — Drizzle schema

```ts
// packages/db/src/schema/report.ts
import { pgTable, uuid, varchar, text, integer, boolean, date, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const scopeAudit = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

// MASTER — item checklist per tipe report (di-seed, bisa diupdate tanpa deploy)
export const reportChecklistItems = pgTable("report_checklist_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),           // FK companies
  outletId: uuid("outlet_id"),                        // NULLABLE: null = berlaku semua outlet; isi = spesifik outlet (override)
  reportType: varchar("report_type", { length: 20 }).notNull(),  // opening|closing|issue
  label: varchar("label", { length: 200 }).notNull(),            // mis. "Kompor menyala", "Stok awal dicek"
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  ...scopeAudit,
}, (t) => ({
  typeCheck: check("report_checklist_items_type_check", sql`${t.reportType} IN ('opening','closing','issue')`),
  companyIdx: index("report_checklist_items_company_idx").on(t.companyId),
  lookupIdx: index("report_checklist_items_lookup_idx").on(t.companyId, t.reportType, t.outletId),
}));

// HEADER — report harian
export const dailyReports = pgTable("daily_reports", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),           // FK companies
  outletId: uuid("outlet_id").notNull(),             // FK outlets
  reportType: varchar("report_type", { length: 20 }).notNull(),  // opening|closing|issue
  reportDate: date("report_date").notNull(),         // tanggal operasi (bukan created_at)
  status: varchar("status", { length: 20 }).notNull().default("draft"), // draft|submitted|validated|rejected
  notes: text("notes"),                              // catatan bebas opsional (mis. ringkasan issue)
  submittedBy: uuid("submitted_by"),                 // FK users (diisi saat submit)
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  validatedBy: uuid("validated_by"),                 // FK users (SPV)
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  rejectedBy: uuid("rejected_by"),                   // FK users
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectReason: text("reject_reason"),
  createdBy: uuid("created_by").notNull(),           // FK users (pembuat draft)
  ...scopeAudit,
}, (t) => ({
  statusCheck: check("daily_reports_status_check", sql`${t.status} IN ('draft','submitted','validated','rejected')`),
  typeCheck: check("daily_reports_type_check", sql`${t.reportType} IN ('opening','closing','issue')`),
  // satu report per (outlet, tipe, tanggal) yang masih hidup
  uq: uniqueIndex("daily_reports_outlet_type_date_uq").on(t.outletId, t.reportType, t.reportDate).where(sql`${t.deletedAt} IS NULL`),
  outletIdx: index("daily_reports_outlet_idx").on(t.outletId),
  statusIdx: index("daily_reports_status_idx").on(t.status),
  dateIdx: index("daily_reports_date_idx").on(t.reportDate),
}));

// JAWABAN — centang/nilai per item checklist untuk satu report
export const reportChecklistAnswers = pgTable("report_checklist_answers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),
  reportId: uuid("report_id").notNull(),             // FK daily_reports
  checklistItemId: uuid("checklist_item_id").notNull(), // FK report_checklist_items
  isChecked: boolean("is_checked").notNull().default(false),
  value: text("value"),                              // nilai opsional (mis. "stok awal 50 pcs")
  note: text("note"),                                // catatan per item opsional
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("report_checklist_answers_uq").on(t.reportId, t.checklistItemId),
  reportIdx: index("report_checklist_answers_report_idx").on(t.reportId),
}));
```

> **Catatan FK:** tulis references yang benar (companyId→companies, outletId→outlets, item refs→report_checklist_items, report refs→daily_reports, user refs→users). Pola sama RBAC/INV schema. `report_date` pakai tipe `date` (bukan timestamp) — ini tanggal operasi, bukan waktu input.

---

## 3. Status Flow

```
draft ──submit──> submitted ──validate(SPV)──> validated  [FINAL, immutable]
  ^                    │
  │                    └──reject(SPV)──> rejected
  │                                          │
  └──────────edit + submit ulang────────────┘

- draft: report dibuat, checklist boleh diisi/diedit bebas.
- submitted: nunggu validasi SPV. Pembuat TIDAK bisa edit (kecuali ditolak).
- validated: FINAL. Tidak bisa diedit. (Koreksi via modul COR nanti.)
- rejected: SPV tolak + reject_reason. User edit → submit ulang (balik ke submitted).
```

"Revised" PRD = aksi user edit report `rejected` lalu submit ulang. BUKAN status terpisah. "Final" PRD = `validated`.

---

## 4. Endpoints — kontrak penuh

> Base `/api/v1/reports`. authMiddleware + requirePermission per-route. Envelope + error catalog. Zod di packages/validation. Verb-path per API_CONVENTIONS (state transition = verb endpoint).

| # | Method | Path | Permission | Catatan |
|---|---|---|---|---|
| 1 | GET | `/reports/checklist-items` | `report.read` | item master per tipe (buat render form). filter report_type, outlet_id |
| 2 | POST | `/reports/draft` | `report.submit` | bikin report draft (outlet, tipe, tanggal) + inisialisasi jawaban kosong dari checklist master |
| 3 | GET | `/reports` | `report.read` | list (filter outlet/type/date/status, paginated, scope-filtered) |
| 4 | GET | `/reports/:id` | `report.read` | detail header + jawaban checklist |
| 5 | PATCH | `/reports/:id` | `report.submit` | edit jawaban checklist + notes (HANYA status draft/rejected) |
| 6 | POST | `/reports/:id/submit` | `report.submit` | draft/rejected → submitted |
| 7 | POST | `/reports/:id/validate` | `report.validate` | submitted → validated (SPV) |
| 8 | POST | `/reports/:id/reject` | `report.validate` | submitted → rejected + reject_reason (SPV) |
| 9 | GET | `/reports/kpi/compliance` | `report.read` | KPI: per outlet per periode, jml validated vs hari (compliance %) |

> Checklist master CRUD (`POST/PATCH /reports/checklist-items`) → permission `report.item_manage` (ERP Owner). OPSIONAL di 3A — kalau item cukup di-seed, CRUD bisa ditunda. Putuskan saat build: minimal seed item, CRUD nyusul kalau perlu.

### Zod inti
```ts
const CreateReportReq = z.object({
  outlet_id: z.string().uuid(),
  report_type: z.enum(["opening", "closing", "issue"]),
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  notes: z.string().max(2000).optional(),
});

const UpdateReportReq = z.object({
  notes: z.string().max(2000).optional(),
  answers: z.array(z.object({
    checklist_item_id: z.string().uuid(),
    is_checked: z.boolean(),
    value: z.string().max(500).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })).optional(),
}); // min 1 field

const RejectReportReq = z.object({
  reason: z.string().min(1).max(1000),
});

const ListReportsQuery = z.object({
  outlet_id: z.string().uuid().optional(),
  report_type: z.enum(["opening", "closing", "issue"]).optional(),
  status: z.enum(["draft", "submitted", "validated", "rejected"]).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.number().int().positive().optional(),
  page_size: z.number().int().positive().max(100).optional(),
});

const ComplianceQuery = z.object({
  outlet_id: z.string().uuid().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM
});
```

---

## 5. Aturan tiap aksi (service)

```
SEMUA: company_id & aktor dari ctx.auth. outlet_id harus dalam scope user (accessFilter/scopeCovers). Di luar scope → 404 ERR_OUT_OF_SCOPE.

createDraft (POST /reports/draft):
  - cek outlet dalam scope. cek belum ada report (outlet, tipe, tanggal) yang hidup → kalau ada: 409 ERR_DUPLICATE ("report sudah ada untuk outlet/tipe/tanggal ini").
  - insert daily_reports status='draft', created_by=ctx.
  - inisialisasi report_checklist_answers: untuk SEMUA item aktif di master yang match (company, report_type, outlet_id null ATAU outlet_id = report.outlet) → insert answer kosong (is_checked=false).
    Resolusi item: item spesifik outlet (outlet_id = report.outlet) MENGGANTIKAN item global (outlet_id null) dengan label sama? → SEDERHANA di MVP: gabungkan keduanya (global + spesifik outlet). Kalau perlu de-dup, de-dup by label. Putuskan saat build, dokumentasikan.

updateReport (PATCH /reports/:id):
  - HANYA status draft atau rejected. status submitted/validated → 409 ERR_CONFLICT ("report tidak bisa diedit pada status ini").
  - update jawaban checklist (upsert per checklist_item_id) + notes. Tenant + scope checked.

submitReport (POST /reports/:id/submit):
  - guard atomik: UPDATE WHERE status IN ('draft','rejected') → 'submitted', submitted_by=ctx, submitted_at=now. 0 row → 409.
  - (opsional) validasi semua item wajib terisi? → MVP: TIDAK wajib semua tercentang (laporan bisa submit walau ada item belum oke — justru itu yang dilaporkan). Tidak ada gate kelengkapan di MVP.

validateReport (POST /reports/:id/validate):
  - cek scope outlet (report.validate). guard atomik: UPDATE WHERE status='submitted' → 'validated', validated_by=ctx, validated_at=now. 0 row → 409 ("bukan status submitted").
  - (catatan SoD: 3A TIDAK mewajibkan validator ≠ submitter — beda dari approval inventory. Report harian validasi SPV rutin; kalau Owner mau SoD, tambahkan validated_by ≠ submitted_by. DEFAULT: tanpa SoD, konfirmasi ke Owner.)

rejectReport (POST /reports/:id/reject):
  - cek scope. guard atomik: UPDATE WHERE status='submitted' → 'rejected', rejected_by=ctx, rejected_at=now, reject_reason=reason. 0 row → 409.

KPI compliance (GET /reports/kpi/compliance):
  - per outlet (dalam scope) untuk bulan tertentu: hitung jumlah report 'validated' per tipe vs jumlah hari operasi (atau jumlah report yang seharusnya).
  - MVP sederhana: compliance = (jml report validated) / (hari dalam bulan × jml tipe wajib) — atau definisi yang Owner tetapkan. Dokumentasikan formula.
  > CATATAN BATASAN: compliance MVP pakai penyebut hari kalender penuh — valid untuk laporan AKHIR BULAN.
  > Mid-bulan misleading (hari belum-terjadi ikut dihitung). Kalender-operasi + timing mid-bulan = utang, dikerjakan di modul Komersial.

immutability: report 'validated' → semua endpoint edit (PATCH, submit, reject) TOLAK (409). Hanya GET.
```

---

## 6. Acceptance Criteria (GIVEN/WHEN/THEN)

```text
CHECKLIST MASTER
R1 GET /reports/checklist-items?report_type=opening → list item aktif tipe opening (global + outlet-spesifik)
R2 item outlet-spesifik (outlet_id terisi) muncul untuk outlet itu; item global (null) muncul untuk semua outlet

DRAFT + ISI
R3 POST /reports/draft valid → 201, status draft, jawaban kosong terinisialisasi dari master
R4 POST /reports/draft duplikat (outlet+tipe+tanggal sama) → 409 ERR_DUPLICATE
R5 PATCH /reports/:id (draft) isi checklist + notes → tersimpan, answer ter-upsert
R6 PATCH /reports/:id pada status submitted → 409 (tidak bisa edit)

STATUS FLOW
R7 POST /reports/:id/submit (draft) → status submitted, submitted_by/at terisi
R8 POST /reports/:id/validate (submitted, SPV) → status validated, validated_by/at terisi
R9 POST /reports/:id/reject (submitted, SPV) + reason → status rejected, reject_reason terisi
R10 GIVEN rejected WHEN user PATCH + submit ulang → kembali submitted (revise flow)
R11 POST /reports/:id/validate pada status draft → 409 (bukan submitted)
R12 double-submit / submit pada validated → 409

IMMUTABILITY
R13 GIVEN validated WHEN PATCH/submit/reject → 409 (final immutable)

SCOPE / TENANT
R14 GIVEN user scope outlet A WHEN bikin/akses report outlet B → 404 ERR_OUT_OF_SCOPE
R15 GET /reports scope outlet A → hanya report outlet A (accessFilter)
R16 report company lain → 404

KPI
R17 GET /reports/kpi/compliance?month=YYYY-MM → angka compliance per outlet (validated vs target)

ENFORCEMENT
R18 tanpa report.submit WHEN POST /reports/draft → 403
R19 tanpa report.validate WHEN validate → 403
R20 tanpa Bearer → 401
```

---

## 7. Permission catalog (tambah ke RBAC seed `02-rbac.ts`)

Permission baru:
- `report.read` — lihat report + checklist + KPI (Staff/SPV/Manager/Direksi/Auditor)
- `report.submit` — bikin draft, isi, submit (Staff + SPV)
- `report.validate` — validate + reject (SPV + Manager)
- `report.item_manage` — kelola checklist master (ERP Owner) — opsional kalau CRUD dibangun

Auto-assign (ikut pola existing inventory permission):
- `report.read` → semua role operasional (STAFF, SPV_OUTLET, MANAGER, DIREKSI, AUDITOR read-only, SUPER_ADMIN)
- `report.submit` → STAFF, SPV_OUTLET, MANAGER
- `report.validate` → SPV_OUTLET, MANAGER
- `report.item_manage` → ERP_OWNER, SUPER_ADMIN

> Idempotent re-seed. Update `seed.test.ts` count (38 → 41/42 tergantung item_manage dibangun). Pola `module.action`.

---

## 8. Definition of Done — 3A
```
[ ] Schema 3 tabel + FK + check + unique (outlet+tipe+tanggal) + migrate ke LOKAL (bukan Neon)
[ ] Checklist master: item global (outlet null) + override per outlet — resolusi terdokumentasi
[ ] Status flow draft→submitted→validated + rejected→revise→submitted, guard atomik (UPDATE WHERE status=X)
[ ] Immutability: validated tidak bisa diedit (PATCH/submit/reject → 409) — R13
[ ] Duplikat report (outlet+tipe+tanggal) ditolak — R4
[ ] Scope/tenant: outlet di luar scope → 404; cross-company → 404 — R14/R16
[ ] SPV validate/reject; staff submit — permission per route — R18/R19
[ ] KPI compliance query — R17
[ ] Permission report.* di-seed + auto-assign + seed.test count updated
[ ] SEMUA acceptance R1-R20 hijau
[ ] Tidak regresi: 183 test existing tetap hijau
[ ] Evidence/R2 TIDAK disentuh (sub-pass terpisah)
[ ] Task delegation/assignment TIDAK disentuh (3B)
[ ] apps/web TIDAK disentuh
```

---

## 9. Pecahan sprint (ritme INV-CORE — 3 langkah)
```
Langkah 1: Schema (3 tabel) + migration LOKAL + permission seed (report.*) + seed.test count. STOP audit.
Langkah 2: Service (createDraft + initialize answers, update, submit/validate/reject, KPI) + guard atomik + scope + test. STOP audit.
Langkah 3: Endpoint (9 route verb-path) + Zod + permission per route + test HTTP. STOP audit.
```
Tiap langkah diaudit sebelum lanjut (audit-gated, sama pola inventory).

---

## 10. Keputusan Owner yang masih perlu dikonfirmasi saat build
1. **SoD report?** Default 3A: TIDAK ada (validator boleh = submitter). Kalau Owner mau report tidak boleh divalidasi pembuatnya → tambah `validated_by ≠ submitted_by`. **Default: tanpa SoD** (report harian beda dari approval stok).
2. **Formula KPI compliance** — definisi pasti "compliance %" (validated / target). Owner tetapkan target: berapa report wajib per hari per outlet (opening + closing = 2? + issue kondisional?).
3. **Checklist master CRUD vs seed** — item cukup di-seed (cepat) atau perlu endpoint CRUD `report.item_manage` di 3A? Default: seed dulu, CRUD nyusul kalau perlu.
4. **Resolusi item global vs outlet-spesifik** — gabung (global + outlet) atau outlet override global? Default: gabung, de-dup by label kalau bentrok.

---

*3A Daily Report = laporan harian terstruktur, menggantikan checklist WA, menyetir KPI compliance. Evidence (R2) dan Task delegation (3B) berdiri terpisah di atas/sebelah modul ini. Fokus 3A: report jalan + status flow + validasi SPV + KPI — fondasi sebelum lampiran & task.*
