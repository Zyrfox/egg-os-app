# EGG OS — Global Contract v0.2

**Document Type:** Layer 1 Foundation Contract (Spec Freeze — Global)
**Project:** EGG OS
**Owner:** Ilham Juniansyah S — ERP Owner
**Stack Baseline:** Cloudflare Workers + Hono + TypeScript + Zod + Drizzle ORM + PostgreSQL (Hyperdrive) + R2 + Queues
**Status:** Working Standard — FREEZE TARGET
**Berlaku untuk:** SEMUA modul (AUTH, RBAC, CORE, MDM, INV, ODR, APR, EVD, AUD, EXP, DSH, COR, SYS, + P1)

---

## 0. CARA AI MEMBACA DOKUMEN INI (baca dulu — precedence rule)

Untuk agent/AI yang generate kode EGG OS, urutan otoritas:

```text
1. Global Contract (dokumen INI)  ← aturan yang TIDAK BOLEH dilanggar modul manapun
2. Module Spec                     ← detail spesifik modul
3. Kalau Module Spec diam soal sesuatu → JATUH ke Global Contract, JANGAN mengarang.
4. Kalau Global Contract & Module Spec bertabrakan → Global Contract MENANG, dan flag konflik.
```

**Aturan keras buat AI:** kalau ada hal yang nggak terdefinisi di kedua dokumen → **STOP dan tanya**, jangan asumsi. 0 invention.

---

## 1. DATA STANDARD (berlaku di SETIAP tabel)

| Aturan | Standar | Wajib? |
|---|---|---|
| Primary Key | `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` | Wajib |
| Tenant Key | `company_id UUID NOT NULL` (refer companies.id) | Wajib di semua tabel operasional |
| Naming tabel | `snake_case`, plural (`stock_movements`) | Wajib |
| Naming kolom | `snake_case`. FK pakai pola `{entity}_id` | Wajib |
| Timestamps | `created_at`, `updated_at` (trigger `set_updated_at()`) | Wajib di main tables |
| Soft delete | `deleted_at TIMESTAMPTZ NULL` | Wajib di tabel operasional utama |
| Status | `status VARCHAR(30)` + CHECK constraint (lihat §6) | Wajib di record berstatus |
| Business code | `UNIQUE(company_id, {code})` — code dibuat BACKEND, bukan frontend | Wajib |
| Metadata fleksibel | `metadata JSONB DEFAULT '{}'` | Opsional |
| Audit pencipta | `created_by UUID` (refer users.id) | Wajib di record yang dibuat user |

**Aturan timestamp:** semua `TIMESTAMPTZ` (timezone-aware), simpan UTC, render ikut timezone outlet di frontend.

**Drizzle base columns (copy ke tiap tabel):**
```ts
// packages/db/src/_base.ts
import { uuid, timestamp, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const baseColumns = {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};
```

---

## 2. ERROR CATALOG

### 2.1 Konvensi kode error
Format: `ERR_{DOMAIN}_{REASON}` — UPPER_SNAKE. Setiap error punya **kode stabil** (jangan ganti string-nya, frontend bergantung ke kode ini).

### 2.2 Katalog inti (dipakai lintas modul)

| Code | HTTP | Message (default ID) | Kapan dipakai |
|---|---|---|---|
| `ERR_VALIDATION` | 422 | Input tidak valid | Zod gagal. `details` berisi field errors. |
| `ERR_UNAUTHENTICATED` | 401 | Sesi tidak valid / token kedaluwarsa | Token absen/invalid/expired |
| `ERR_FORBIDDEN` | 403 | Akses ditolak | Lolos auth tapi gagal permission |
| `ERR_OUT_OF_SCOPE` | 403 | Data di luar cakupan Anda | RBAC OK tapi outlet/brand scope tidak cocok |
| `ERR_NOT_FOUND` | 404 | Data tidak ditemukan | Record absen ATAU tersembunyi karena scope |
| `ERR_CONFLICT` | 409 | Data bentrok / duplikat | Unique constraint, idempotency clash |
| `ERR_RECORD_LOCKED` | 409 | Data final tidak bisa diubah langsung | Edit record `final`/`closed`/`locked` → arahkan ke Correction |
| `ERR_INVALID_TRANSITION` | 409 | Perubahan status tidak diizinkan | Transisi status di luar state machine (§6) |
| `ERR_RATE_LIMITED` | 429 | Terlalu banyak percobaan | Login throttle, dll |
| `ERR_INTERNAL` | 500 | Terjadi kesalahan sistem | Uncaught. JANGAN bocorkan detail internal. |

### 2.3 Katalog domain (AUTH / RBAC / INV / APR / EVD / COR)

| Code | HTTP | Kapan |
|---|---|---|
| `ERR_INVALID_CREDENTIALS` | 401 | Email/password salah |
| `ERR_USER_INACTIVE` | 403 | User status ≠ active |
| `ERR_PASSWORD_CHANGE_REQUIRED` | 403 | `first_login_required = true`, akses sebelum ganti password |
| `ERR_TOKEN_EXPIRED` | 401 | password/refresh token kedaluwarsa |
| `ERR_TOKEN_USED` | 409 | Single-use token dipakai ulang |
| `ERR_LOGIN_LOCKED` | 429 | Gagal login melebihi batas |
| `ERR_NEGATIVE_STOCK` | 422 | Stock out bikin `current_stock < 0` |
| `ERR_INSUFFICIENT_STOCK` | 422 | Stok tidak mencukupi untuk stock_out/waste |
| `ERR_STOCK_BEFORE_USE` | 422 | Pakai item yang belum di-stock-in/validasi |
| `ERR_EVIDENCE_REQUIRED` | 422 | High-risk action tanpa evidence |
| `ERR_SELF_APPROVAL` | 403 | Requester mencoba approve/review request-nya sendiri |
| `ERR_ALREADY_DECIDED` | 409 | Approval step sudah diputus |
| `ERR_CORRECTION_REQUIRED` | 409 | Coba edit final data tanpa correction flow |
| `ERR_DUPLICATE_REPORT` | 409 | Daily report duplikat (outlet+date+type+shift) |

### 2.4 Aturan keamanan error
```text
1. 404 vs 403: kalau record ADA tapi di luar scope user → balikan 404 (ERR_NOT_FOUND),
   JANGAN 403. Alasan: 403 membocorkan "record ini eksis". (kecuali audit_view role)
2. Error 500 tidak boleh mengandung stack trace / query / secret di response.
3. Setiap error 4xx/5xx yang security-relevant → tulis auth_events / audit_logs.
```

---

## 3. API ENVELOPE (format response seragam)

### 3.1 Sukses
```json
{
  "success": true,
  "data": { },
  "meta": { }
}
```
- `data`: objek tunggal ATAU array.
- `meta`: opsional. Untuk list → wajib berisi pagination (§3.3).

### 3.2 Error
```json
{
  "success": false,
  "error": {
    "code": "ERR_VALIDATION",
    "message": "Input tidak valid",
    "details": [
      { "field": "email", "issue": "format email tidak valid" }
    ]
  }
}
```
- `details` opsional, hanya untuk `ERR_VALIDATION` (dari Zod) atau error yang butuh konteks field.
- `message` aman ditampilkan ke user. JANGAN taruh detail teknis di sini.

### 3.3 Pagination (semua endpoint list)
Request query: `?page=1&limit=25&sort=created_at&order=desc&filter[...]`
Response `meta`:
```json
{ "page": 1, "limit": 25, "total": 312, "total_pages": 13 }
```
- `limit` default 25, max 100.
- Sorting & filtering whitelisted per-endpoint (jangan terima kolom sembarang → SQL injection vector).

### 3.4 Konvensi HTTP method
```text
GET    → read (tidak mengubah state)
POST   → create / action (submit, approve, validate)
PATCH  → partial update (hanya record non-final)
DELETE → soft delete (set deleted_at), bukan hard delete
```
**Catatan:** transisi status (submit/validate/approve/reject) = `POST /resource/{id}/{action}`, BUKAN PATCH status. Contoh: `POST /daily-reports/{id}/submit`.

---

## 4. AUTH & TOKEN CONTRACT

### 4.1 Token
| Token | Umur | Simpan | Catatan |
|---|---|---|---|
| Access (JWT) | 15 menit | memory/header (Authorization: Bearer) | Stateless, berisi claims §4.2 |
| Refresh | 7 hari | httpOnly cookie / secure store, **hashed di DB** | Rotatable & revocable (`refresh_tokens.revoked_at`) |
| Password/Set-link token | 24–72 jam | hashed di DB (`password_tokens`) | Single-use (`used_at`), tipe: set_password / reset_password / temporary_password |

### 4.2 JWT Access claims (WAJIB konsisten — modul RBAC baca ini)
```json
{
  "sub": "user_uuid",
  "company_id": "company_uuid",
  "roles": ["SPV_OUTLET"],
  "scopes": [
    { "scope_type": "outlet", "outlet_id": "uuid" }
  ],
  "first_login_required": false,
  "iat": 0, "exp": 0
}
```
**Aturan:** claims `roles` & `scopes` adalah HINT untuk UX cepat. **Backend TETAP query ulang permission dari DB tiap request** (jangan percaya JWT buta untuk authorization keputusan kritis — token bisa basi).

### 4.3 Aturan login (assertion testable)
```text
GIVEN email tidak terdaftar         WHEN login THEN 401 ERR_INVALID_CREDENTIALS
GIVEN password salah                WHEN login THEN 401 ERR_INVALID_CREDENTIALS  (pesan sama, anti user-enumeration)
GIVEN user.status != active         WHEN login THEN 403 ERR_USER_INACTIVE
GIVEN gagal login > N kali          WHEN login THEN 429 ERR_LOGIN_LOCKED
GIVEN login sukses, first_login=true WHEN akses /app/* selain ganti-password THEN 403 ERR_PASSWORD_CHANGE_REQUIRED
GIVEN freelance.expires_at < now()  WHEN login THEN 403 ERR_USER_INACTIVE
```

---

## 5. PERMISSION MATRIX (RBAC scheme)

### 5.1 Permission code
Format: `{module}.{action}` lowercase. Contoh: `inventory.stock_in`, `reports.validate`, `approval.decide`, `audit.view`.

### 5.2 Scope type (dari DBD — dikunci)
| scope_type | Arti | Resolusi query |
|---|---|---|
| `global` | Lintas company (SaaS-level) | tanpa filter company (super admin only) |
| `company` | Seluruh data 1 company | `WHERE company_id = :ctx.company` |
| `brand` | Data 1 brand | `+ AND brand_id IN (:ctx.brands)` |
| `outlet` | Data outlet yg di-assign | `+ AND outlet_id IN (:ctx.outlets)` |
| `department` | Data department | `+ AND department_id IN (:ctx.departments)` |
| `own` | Hanya record yg dia buat | `+ AND created_by = :ctx.user` |
| `assigned` | Record yg di-assign ke dia | `+ AND assigned_to = :ctx.user` |
| `audit_view` | Read-only lintas scope utk audit | read tanpa write, audit modul only |

### 5.3 Role baseline (default scope per role — titik awal, detail per-endpoint di module spec)
| Role | Default scope | Bisa nulis? | Catatan |
|---|---|---|---|
| `SUPER_ADMIN` | global | ya | Tidak untuk kerja harian. Tiap aksi → audit `severity=critical`. |
| `ERP_OWNER` | company | ya (config/master/governance) | Tidak meng-approve transaksi operasional (hindari konflik peran) |
| `DIREKSI` | company | approve high-level only | L3–L5 approval, executive dashboard |
| `MANAGER_INVENTORY` | brand/outlet (domain INV) | ya (validasi+approve domain) | |
| `MANAGER_FINANCE` | company (domain FIN) | ya (domain) | Export finance restricted |
| `MANAGER_OPS_HR` | brand/outlet (domain OPS) | ya (domain) | |
| `MANAGER_COMMERCIAL` | company (domain COM) | ya (domain) | |
| `SPV_OUTLET` | outlet (assigned) | input + validate outlet-nya | Validation queue |
| `STAFF` | own + assigned (outlet-nya) | input only | Form mobile-first |
| `FREELANCE` | own + assigned (expiry) | input terbatas | `expires_at` wajib |
| `AUDITOR` | audit_view (company) | **read-only** | Tidak boleh edit data operasional |

### 5.4 Aturan enforcement (assertion)
```text
1. Default DENY. Akses hanya kalau permission + scope eksplisit diberikan.
2. Frontend route guard = UX saja. Backend WAJIB cek permission + scope tiap request.
3. GIVEN user akses record di luar scope-nya → 404 ERR_NOT_FOUND (lihat §2.4), bukan 403.
4. access_overrides: DENY menang atas ALLOW. Wajib ada reason + expiry.
5. AUDITOR tidak punya permission ber-action write APAPUN.
```

---

## 6. STATE MACHINE STANDARD

### 6.1 Status global (dari DBD §7 — dikunci, CHECK constraint pakai ini)
```text
draft · submitted · pending_validation · pending_approval · validated ·
approved · rejected · revision_requested · revised · final · closed · cancelled · archived
```

### 6.2 Lifecycle: Operational Record (stock movement, daily report, dll)
```text
draft ──submit──▶ submitted ──(butuh validasi)──▶ pending_validation
pending_validation ──validate──▶ validated ──finalize──▶ final
pending_validation ──reject──▶ rejected
pending_validation ──request_revision──▶ revision_requested ──revise──▶ submitted (loop)
final ──(tidak bisa edit)──▶ Correction flow (modul COR)
any ──cancel(reason)──▶ cancelled   (sebelum final)
```
**Transisi legal saja.** Di luar ini → `409 ERR_INVALID_TRANSITION`.

### 6.3 Lifecycle: Approval Request
```text
pending_approval ──approve(step)──▶ (step berikut | approved kalau step terakhir)
pending_approval ──reject(reason WAJIB)──▶ rejected
pending_approval ──request_revision──▶ revision_requested
```

### 6.4 Siapa boleh memicu (contoh — detail di module spec)
| Transisi | Pemicu (role) | Side effect WAJIB |
|---|---|---|
| submit | Staff/SPV (creator/scope) | set submitted_at, audit |
| validate | SPV/Manager (scope) | set validated_by/at, audit |
| finalize | sistem/Manager sesuai rule | lock record, update cache (mis. current_stocks), audit |
| approve | approver (BUKAN requester) | catat approval_history, audit. Cek ERR_SELF_APPROVAL |
| reject | approver | reason WAJIB, audit |

**Aturan side-effect:** `final` MENGUNCI record. Stock baru memengaruhi `current_stocks` HANYA setelah movement `validated/final` (bukan saat `draft/submitted`).

---

## 7. NAMING GLOSSARY (dikunci — AI dilarang bikin sinonim)

| Pakai INI | JANGAN |
|---|---|
| `stock_movement` | stock_move, movement, mutasi_stok |
| `current_stock` | stock_now, saldo_stok |
| `stock_opname` | opname_stock, stock_count |
| `daily_report` | report_daily, laporan_harian (di kode) |
| `approval_request` | approval, request_approval |
| `evidence_file` | attachment, file_bukti |
| `audit_log` | log, activity_log, history |
| `outlet` | store, branch, cabang (di kode) |
| `validate` (aksi SPV) | verify, check |
| `approve` (aksi approver) | confirm, accept |
| `final` (status terkunci) | done, completed, locked |

**Aturan:** sekali AI lihat dua nama untuk satu konsep, dia bikin tabel/tipe duplikat. Konsistensi naming = anti-duplikasi.

---

## 8. AUDIT RULE

### 8.1 Action yang WAJIB di-audit
```text
login_success/failed · password_set · role/access change · master data create/update ·
stock finalize · approval decide (approve/reject) · evidence upload/delete/lock ·
export (semua) · correction apply · void/refund review · report finalize ·
dashboard alert action · user activate/deactivate
```

### 8.2 Payload audit_logs (minimal)
```json
{
  "company_id": "uuid", "actor_user_id": "uuid", "actor_role_id": "uuid",
  "module": "INV", "action": "stock.finalize",
  "record_type": "stock_movement", "record_id": "uuid",
  "previous_value": { }, "new_value": { }, "changed_fields": ["status"],
  "severity": "info | warning | high | critical",
  "ip_address": "x.x.x.x", "request_id": "uuid", "created_at": "ts"
}
```

### 8.3 Aturan
```text
1. audit_logs = APPEND ONLY. Tidak ada UPDATE/DELETE.
2. severity high/critical → auto-bikin dashboard_alert.
3. previous/new_value untuk perubahan data; null untuk read/login.
4. Audit ditulis di BACKEND service, dalam transaksi yang sama dengan aksinya
   (kalau aksi commit, audit commit; kalau aksi gagal, audit batal).
```

---

## 9. TENANT ISOLATION RULE (kunci dari Sprint 1 — komitmen lu)

```text
1. SETIAP query (read & write) WAJIB filter company_id dari context (JWT/session),
   BUKAN dari input user. Input user yang bawa company_id = ditolak/diabaikan.
2. Helper wajib: withCompanyScope(query, ctx) — bungkus semua repository.
   Tidak ada query mentah ke tabel operasional tanpa helper ini.
3. Cross-company akses HANYA untuk scope_type=global (super admin), dan tiap akses → audit.
4. Seed data demo/jual ke luar (#8) WAJIB pakai company dummy, BUKAN data EGG.
5. Test wajib: user company A tidak bisa baca/tulis record company B → 404.
```

**Pola repository (contoh):**
```ts
// Semua repo lewat sini. Tidak ada pengecualian untuk tabel operasional.
function scoped(ctx: Ctx) {
  return db.select().from(table).where(eq(table.companyId, ctx.companyId));
}
```

---

## 10. DEFINITION OF DONE — Global Contract (centang sebelum FREEZE)

```text
[ ] §1  Data standard + baseColumns Drizzle final
[ ] §2  Error catalog lengkap (kode stabil, tim sepakat)
[ ] §3  API envelope + pagination + method convention final
[ ] §4  Token contract + JWT claims + login assertions final
[ ] §5  Permission code scheme + scope_type + role baseline final
[ ] §6  State machine (operational + approval) + transisi legal final
[ ] §7  Naming glossary disepakati
[ ] §8  Audit rule + payload final
[ ] §9  Tenant isolation pattern + helper disepakati
[ ] Validasi: 1 dry-run — kasih AI Global Contract + spec AUTH, lihat dia
    nanya balik 0 hal arsitektural. Kalau masih nanya → ada lubang di sini, tambal.
```

**Begitu 10 ini centang → Global Contract BEKU (tag `global-contract-frozen`). Perubahan setelahnya = change request, bukan edit liar.**

---

## 11. CONFLICT RESOLUTIONS (Locked)

Keputusan-keputusan ini menggantikan task plan atau module spec yang bertentangan.
Perubahan di seksi ini membutuhkan persetujuan tertulis eksplisit.

### 11.1 User status enum (canonical)

`invited | active | suspended | archived`

`pending` adalah **BANNED**. Dipakai di draft task plan lama; AUTH lifecycle
(`invited → set-password → active`) adalah canonical. Task plan 01b sudah dikoreksi.

### 11.2 Permission code format (canonical)

- **Role code:** `UPPERCASE_SNAKE` (contoh: `SUPER_ADMIN`, `ERP_OWNER`)
- **Permission code:** lowercase, dot-separated, **tepat 2 level**: `{module}.{action}`
  - Jika action menyebut entity, collapse dengan underscore: `core.company_read`
  - **Tidak boleh 3 level** (`CORE.company.read` → invalid)
  - Contoh valid: `auth.login`, `user.read`, `rbac.role_assign`, `core.company_read`,
    `mdm.item_read`, `inv.stock_read`, `odr.report_read`

### 11.3 scope_type enum (canonical, 8 nilai)

`global | company | brand | outlet | department | own | assigned | audit_view`

Task plan 01d tidak punya `global` dan `audit_view`. Keduanya wajib untuk
role `SUPER_ADMIN` (`global`) dan `AUDITOR` (`audit_view`).

### 11.4 SUPER_ADMIN default scope

`global` — bukan `company`. SUPER_ADMIN memiliki visibilitas lintas-company by design.
Task plan 01d seed memakai `scope=company`; sudah dikoreksi ke `scope=global`.

### 11.5 Lokasi Zod schema + type

- Zod validation schemas → `packages/validation` (sudah ada)
- Shared TypeScript types → `packages/validation` selama `packages/shared` belum dibuat
- Task plan 01b menyebut `packages/shared/schemas/user.ts`; sudah dikoreksi ke
  `packages/validation/src/user.ts`

### 11.6 Conflict precedence

```text
Global Contract > AUTH Spec > DBD > API Spec > Module Task Plan
```

Kalau task plan bertentangan dengan Global Contract → task plan yang salah.

---

*Layer 1 selesai → lanjut Layer 2: freeze AUTH ke level buildable (pakai semua kontrak di atas sebagai cetakan).*
