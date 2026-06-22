# EGG OS — AUTH Module Spec (Buildable) v0.2

**Type:** Golden Module Spec — buildable depth
**Project:** EGG OS · **Owner:** Ilham Juniansyah S (ERP Owner)
**Stack:** Cloudflare Workers + Hono + TypeScript + Zod + Drizzle ORM + PostgreSQL (Hyperdrive)
**Depends on:** `EGG_OS_GLOBAL_CONTRACT_v0.2.md` (READ FIRST — error catalog, API envelope, token contract, tenant isolation all live there)
**Goal:** Cetakan pertama. Kalau modul ini lulus THE GATE (koreksi AI ≤ 3 putaran), pola spec terbukti dan 12 modul sisanya tinggal niru.

---

## 0. Scope

AUTH menangani: login, logout, refresh token, sesi, siklus password (set pertama / reset / ganti), data user saat ini + permission-nya, penegakan status akun, dan alur first-login.

**Di luar scope AUTH** (modul lain): pembuatan/penugasan role & permission (RBAC), CRUD user master oleh admin (SYS/RBAC). AUTH **menyediakan** `ctx` (identitas + claims) yang dipakai middleware RBAC.

---

## 1. Data Model — Drizzle schema (aktual, bukan deskripsi)

```ts
// packages/db/src/schema/auth.ts
import { pgTable, uuid, varchar, boolean, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  fullName: varchar("full_name", { length: 150 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  passwordHash: varchar("password_hash", { length: 255 }),         // null sampai password di-set
  status: varchar("status", { length: 20 }).notNull().default("invited"), // invited|active|suspended|archived
  firstLoginRequired: boolean("first_login_required").notNull().default(true),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  isFreelance: boolean("is_freelance").notNull().default(false),
  freelanceExpiresAt: timestamp("freelance_expires_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  emailUq: uniqueIndex("users_company_email_uq").on(t.companyId, sql`lower(${t.email})`),
  companyIdx: index("users_company_idx").on(t.companyId),
  statusIdx: index("users_status_idx").on(t.status),
}));

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  companyId: uuid("company_id").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),       // sha-256 hex of the opaque token
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  replacedBy: uuid("replaced_by"),                                  // rotation chain
  userAgent: varchar("user_agent", { length: 255 }),
  ipAddress: varchar("ip_address", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hashIdx: index("refresh_token_hash_idx").on(t.tokenHash),
  userIdx: index("refresh_token_user_idx").on(t.userId),
}));

export const passwordTokens = pgTable("password_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  companyId: uuid("company_id").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),       // sha-256 hex, single-use
  type: varchar("type", { length: 20 }).notNull(),                  // set_password|reset_password
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hashIdx: index("password_token_hash_idx").on(t.tokenHash),
  userIdx: index("password_token_user_idx").on(t.userId),
}));

export const authEvents = pgTable("auth_events", {                  // APPEND ONLY
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id"),
  userId: uuid("user_id"),                                          // null jika email tak dikenal
  eventType: varchar("event_type", { length: 40 }).notNull(),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: varchar("user_agent", { length: 255 }),
  detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("auth_event_user_idx").on(t.userId),
  createdIdx: index("auth_event_created_idx").on(t.createdAt),
}));
```

`event_type` enum: `login_success`, `login_failed`, `logout`, `token_refreshed`, `token_reuse_detected`, `password_set`, `password_reset_requested`, `password_reset`, `password_changed`, `account_locked`.

---

## 2. Constants (config — kunci, jangan diambang)

```ts
export const AUTH = {
  ACCESS_TTL_SEC: 15 * 60,            // 15 menit
  REFRESH_TTL_SEC: 7 * 24 * 3600,     // 7 hari
  SET_PASSWORD_TTL_SEC: 72 * 3600,    // 72 jam
  RESET_PASSWORD_TTL_SEC: 24 * 3600,  // 24 jam
  MAX_FAILED_LOGIN: 5,
  LOCK_DURATION_SEC: 15 * 60,         // lock 15 menit setelah 5 gagal
  PASSWORD: { minLength: 8, requireLetter: true, requireNumber: true },
} as const;
```

---

## 3. State Machine

**User status**
```text
invited ──set-password (token valid)──▶ active        (first_login_required → false)
active  ──admin suspend──▶ suspended ──admin reactivate──▶ active
(active|suspended) ──admin archive──▶ archived         (terminal; soft delete)
```
- `firstLoginRequired = true` saat: user dibuat/di-invite, atau setelah admin reset password.
- `firstLoginRequired = false` saat: set-password atau change-password sukses.
- Hanya status `active` yang boleh login. `freelance` dengan `freelanceExpiresAt < now()` diperlakukan seperti tidak aktif.

**Refresh token**
```text
issued ──dipakai di /auth/refresh──▶ rotated (revokedAt diset, replacedBy → token baru)
issued ──logout / admin──▶ revoked
issued ──lewat expiresAt──▶ expired
revoked|expired ──dipakai lagi──▶ TOLAK + tulis token_reuse_detected + revoke seluruh token user
```

**Password token**: `issued → used (usedAt diset, single-use)` atau `issued → expired`.

---

## 4. JWT & Token Contract

- **Access token = JWT (HS256)**, signed pakai `JWT_ACCESS_SECRET`, umur `ACCESS_TTL_SEC`. Claims (wajib konsisten — RBAC baca ini):
```json
{ "sub":"user_uuid", "company_id":"uuid", "roles":["SPV_OUTLET"],
  "scopes":[{"scope_type":"outlet","outlet_id":"uuid"}],
  "first_login_required": false, "iat":0, "exp":0 }
```
- **Refresh token = string opaque acak** (BUKAN JWT): 32 byte `crypto.getRandomValues` → base64url. Yang disimpan di DB cuma **sha-256 hex**-nya. Rotating: tiap refresh, token lama di-revoke, token baru diterbitkan.
- `roles`/`scopes` di JWT = hint UX. **Authorization tetap dicek ulang dari DB tiap request** (token bisa basi).

---

## 5. Endpoints — kontrak penuh

> Semua sukses pakai envelope `{ success:true, data, meta? }`; semua error pakai `{ success:false, error:{code,message,details?} }` (lihat Global Contract §3). Prefix base: `/api/v1`.

### 5.1 `POST /auth/login` — public
```ts
// request
const LoginReq = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
// success 200 → data
{ access_token: string, refresh_token: string, token_type: "Bearer",
  expires_in: number /*sec*/, user: PublicUser /* §5.10 */ }
```
**Logika:** cari user by (companyId resolve dari email domain? → TIDAK; single-tenant per company → lihat catatan tenancy di §10) + status check + verify password + reset failedLoginCount + set lastLoginAt + terbitkan token pair.
**Errors:** `ERR_VALIDATION`(422) · `ERR_INVALID_CREDENTIALS`(401, untuk email tak ada / password salah — pesan SAMA) · `ERR_USER_INACTIVE`(403) · `ERR_LOGIN_LOCKED`(429).
**Side effects:** auth_events `login_success`/`login_failed`; jika gagal ke-5 → `account_locked` + set `lockedUntil`.

### 5.2 `POST /auth/refresh` — public (butuh refresh token)
```ts
const RefreshReq = z.object({ refresh_token: z.string().min(1) });
// success 200 → data: { access_token, refresh_token, token_type, expires_in }
```
**Logika:** hash input → cari refresh_tokens by tokenHash. Validasi: ada, belum revoked, belum expired. Rotasi: revoke lama (`replacedBy`), terbitkan baru. Jika token sudah `revoked`/`expired` tapi dipakai → **token reuse**: revoke semua token user + `token_reuse_detected`.
**Errors:** `ERR_VALIDATION`(422) · `ERR_TOKEN_EXPIRED`(401) · `ERR_UNAUTHENTICATED`(401, token tak dikenal/revoked).

### 5.3 `POST /auth/logout` — auth
```ts
const LogoutReq = z.object({ refresh_token: z.string().optional() });
// success 200 → data: { success: true }
```
Revoke refresh token yang dikirim (atau seluruh sesi user jika tak dikirim). auth_events `logout`.

### 5.4 `GET /auth/me` — auth
`success 200 → data: PublicUser`. Errors: `ERR_UNAUTHENTICATED`(401).

### 5.5 `GET /auth/me/permissions` — auth
`success 200 → data: { roles: string[], scopes: Scope[], permissions: string[] }`. Diisi oleh service RBAC; AUTH expose passthrough.

### 5.6 `POST /auth/set-password` — public (token first-time)
```ts
const SetPasswordReq = z.object({
  token: z.string().min(10),
  new_password: z.string().min(AUTH.PASSWORD.minLength)
    .regex(/[A-Za-z]/, "harus mengandung huruf").regex(/[0-9]/, "harus mengandung angka"),
});
// success 200 → data: { success: true }
```
**Logika:** hash token → cari password_tokens (type `set_password`, belum used, belum expired). Set passwordHash, status `active`, firstLoginRequired=false, tandai token used. auth_events `password_set`.
**Errors:** `ERR_VALIDATION`(422) · `ERR_TOKEN_EXPIRED`(401) · `ERR_TOKEN_USED`(409) · `ERR_UNAUTHENTICATED`(401, token tak dikenal).

### 5.7 `POST /auth/request-password-reset` — public
```ts
const ReqResetReq = z.object({ email: z.string().email() });
// success 200 → data: { success: true }   ← SELALU 200 (anti user-enumeration)
```
Jika email ada & aktif: buat password_token (`reset_password`, TTL 24h), kirim email (queue). auth_events `password_reset_requested`. **Jika email tak ada: tetap balas 200**, tanpa kirim apa pun.

### 5.8 `POST /auth/reset-password` — public (token)
```ts
const ResetReq = z.object({
  token: z.string().min(10),
  new_password: z.string().min(AUTH.PASSWORD.minLength).regex(/[A-Za-z]/).regex(/[0-9]/),
});
// success 200 → data: { success: true }
```
Sama seperti set-password tapi type `reset_password`. Set passwordHash, firstLoginRequired=false, revoke semua refresh token user (paksa login ulang). auth_events `password_reset`. Errors sama §5.6.

### 5.9 `POST /auth/change-password` — auth
```ts
const ChangeReq = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(AUTH.PASSWORD.minLength).regex(/[A-Za-z]/).regex(/[0-9]/),
});
// success 200 → data: { success: true }
```
Verify current_password. Set baru, firstLoginRequired=false, revoke refresh token lain selain sesi saat ini. auth_events `password_changed`.
**Errors:** `ERR_VALIDATION`(422) · `ERR_INVALID_CREDENTIALS`(401, current salah) · `ERR_UNAUTHENTICATED`(401).

### 5.10 Shared schema
```ts
const PublicUser = z.object({
  id: z.string().uuid(), company_id: z.string().uuid(),
  email: z.string().email(), full_name: z.string(),
  status: z.enum(["invited","active","suspended","archived"]),
  first_login_required: z.boolean(),
  is_freelance: z.boolean(), last_login_at: z.string().datetime().nullable(),
});
```

---

## 6. Middleware

```ts
// authMiddleware (Hono): wajib di semua route non-public
//  1. Ambil Authorization: Bearer <jwt>. Tak ada → 401 ERR_UNAUTHENTICATED
//  2. Verify JWT (HS256, JWT_ACCESS_SECRET). Invalid/exp → 401 ERR_UNAUTHENTICATED
//  3. Load user by sub. status != active → 401 ERR_UNAUTHENTICATED (akun dinonaktifkan saat sesi hidup)
//  4. Set ctx: { userId, companyId, roles, scopes, firstLoginRequired }
//
// firstLoginGuard: setelah authMiddleware, jika ctx.firstLoginRequired === true
//   DAN path BUKAN di allowlist [/auth/change-password, /auth/set-password, /auth/me, /auth/logout]
//   → 403 ERR_PASSWORD_CHANGE_REQUIRED
```
RBAC/scope middleware = modul terpisah; AUTH cukup sediakan `ctx`.

---

## 7. Acceptance Criteria (GIVEN/WHEN/THEN — testable)

```text
LOGIN
A1 GIVEN email tidak terdaftar          WHEN login THEN 401 ERR_INVALID_CREDENTIALS
A2 GIVEN password salah                  WHEN login THEN 401 ERR_INVALID_CREDENTIALS (pesan identik A1)
A3 GIVEN kredensial benar, status active WHEN login THEN 200 + access+refresh + user, failedLoginCount=0
A4 GIVEN status=suspended                WHEN login THEN 403 ERR_USER_INACTIVE
A5 GIVEN status=invited (belum set pw)   WHEN login THEN 401 ERR_INVALID_CREDENTIALS (passwordHash null)
A6 GIVEN gagal login 5x                  WHEN login ke-5 THEN 429 ERR_LOGIN_LOCKED + lockedUntil terisi + event account_locked
A7 GIVEN lockedUntil > now()             WHEN login (pw benar sekalipun) THEN 429 ERR_LOGIN_LOCKED
A8 GIVEN freelance & freelanceExpiresAt<now WHEN login THEN 403 ERR_USER_INACTIVE

REFRESH
B1 GIVEN refresh valid                   WHEN refresh THEN 200 + token baru + token lama revoked (rotation)
B2 GIVEN refresh expired                 WHEN refresh THEN 401 ERR_TOKEN_EXPIRED
B3 GIVEN refresh sudah revoked/dipakai   WHEN refresh THEN 401 ERR_UNAUTHENTICATED + SEMUA token user di-revoke + event token_reuse_detected
B4 GIVEN refresh tak dikenal             WHEN refresh THEN 401 ERR_UNAUTHENTICATED

PASSWORD
C1 GIVEN set_password token valid        WHEN set-password THEN 200 + status active + firstLoginRequired=false + token used
C2 GIVEN token expired                   WHEN set-password THEN 401 ERR_TOKEN_EXPIRED
C3 GIVEN token sudah used                WHEN set-password THEN 409 ERR_TOKEN_USED
C4 GIVEN new_password < 8 / tanpa angka  WHEN set/reset/change THEN 422 ERR_VALIDATION (details berisi field)
C5 GIVEN email tak terdaftar             WHEN request-password-reset THEN 200 (anti-enumeration, tanpa kirim email)
C6 GIVEN reset-password sukses           WHEN reset THEN 200 + semua refresh token user revoked
C7 GIVEN current_password salah          WHEN change-password THEN 401 ERR_INVALID_CREDENTIALS

SESSION / GUARD
D1 GIVEN tanpa Bearer                     WHEN GET /auth/me THEN 401 ERR_UNAUTHENTICATED
D2 GIVEN JWT expired                      WHEN akses route auth THEN 401 ERR_UNAUTHENTICATED
D3 GIVEN user status diubah ke suspended saat sesi hidup WHEN request berikutnya THEN 401 ERR_UNAUTHENTICATED
D4 GIVEN firstLoginRequired=true          WHEN akses /dashboard THEN 403 ERR_PASSWORD_CHANGE_REQUIRED
D5 GIVEN firstLoginRequired=true          WHEN akses /auth/change-password THEN diizinkan (allowlist)

TENANCY
E1 GIVEN user company A                   WHEN refresh token milik company B dipakai THEN 401 (tokenHash tak match scope company)
```

---

## 8. Seed & Fixtures (konkret)

```text
company:   { id: 11111111-...-A, name: "Easy Going Group" }
users:
  super:   { email: owner@egg.test,  status: active,  first_login_required: false, password: "Owner#123" }
  spv:     { email: spv.btmk@egg.test, status: active, first_login_required: false, password: "Spv#1234" }
  staff:   { email: staff.btmk@egg.test, status: invited, first_login_required: true, password_hash: null }
password_tokens:
  set1:    { user: staff, type: set_password, expires: now()+72h, used: null }  // raw token utk test C1
```

---

## 9. UI Contract (per screen)

| Screen / Route | Komponen | State | API | Catatan |
|---|---|---|---|---|
| `/login` | email, password (TextInput), submit btn, error banner | loading, error, locked | `POST /auth/login` | Sukses → simpan token; jika `first_login_required` → redirect `/set-password`; else `/dashboard`. Pesan error generic (jangan bedakan email vs password). |
| `/set-password` | new_password, confirm (TextInput), strength hint, submit | loading, token_invalid, error, success | `POST /auth/set-password` (token dari query) | Validasi confirm == new di FE; aturan password ditampilkan sebagai HelperText. Sukses → `/login`. |
| `/forgot-password` | email, submit | loading, success | `POST /auth/request-password-reset` | SELALU tampilkan "Jika email terdaftar, link reset telah dikirim." (anti-enumeration). |
| `/reset-password` | new_password, confirm, submit | loading, token_invalid, success | `POST /auth/reset-password` (token query) | Sukses → `/login`. |
| Settings → Ganti Password | current, new, confirm | loading, error, success | `POST /auth/change-password` | current salah → FieldError di field current. |

**Standar state tiap screen:** loading (disable submit + spinner), error (banner + pesan dari `error.message`), field error (FieldError dari `error.details[].field`).

---

## 10. Security rules khusus AUTH

```text
1. Password hashing: pakai scrypt via @noble/hashes/scrypt (pure-JS, jalan di Workers — bcrypt/argon2 native TIDAK jalan di Workers).
   Simpan format: scrypt$N$r$p$salt_b64$hash_b64. Verify konstan-waktu.
   (Alternatif native: PBKDF2-HMAC-SHA256 via WebCrypto, ≥100k iterasi.)
2. Token acak: crypto.getRandomValues(32 byte) → base64url. DB simpan sha-256 hex, BUKAN token mentah.
3. Anti-enumeration: /auth/login & /auth/request-password-reset balas generik.
4. Lockout: MAX_FAILED_LOGIN gagal → lock LOCK_DURATION. failedLoginCount reset saat sukses.
5. Tenancy: setiap query (users, refresh_tokens, password_tokens) WAJIB filter companyId dari context, kecuali resolusi login awal. company_id TIDAK pernah diambil dari input user.
6. JWT secret & DB URL via Wrangler secrets (lihat Deployment Runbook §9). Jangan commit.
7. Email enumeration via timing: jalankan dummy hash verify walau user tak ada (samakan waktu respons login).
```

**Catatan tenancy login:** karena pilot single-company (EGG), email unik global cukup. Kalau multi-tenant aktif (jual ke luar — #8), tambah parameter tenant (subdomain/kode company) di `/auth/login` agar email tidak bentrok antar tenant. Ini sudah diantisipasi di kolom `UNIQUE(company_id, lower(email))`.

---

## 11. Definition of Done — AUTH (centang sebelum FREEZE)

```text
[ ] Drizzle schema 4 tabel + index + constraint final (migration jalan di staging)
[ ] 9 endpoint terimplement sesuai §5, semua pakai envelope Global Contract
[ ] authMiddleware + firstLoginGuard sesuai §6
[ ] Password hashing (scrypt) + token hashing (sha-256) sesuai §10
[ ] Seluruh acceptance criteria §7 jadi test otomatis & HIJAU
[ ] Seed §8 ter-load; smoke test login happy + 1 error path
[ ] Lulus THE GATE (Spec Freeze Gate §2): AI build dgn koreksi ≤ 3, 0 pertanyaan arsitektural, 0 invention
```

---

## 12. Dry-run prompt (untuk menguji gate)

Tempel ini ke AI builder lo, lampirkan **dokumen ini + Global Contract**:

> "Bangun modul AUTH EGG OS sesuai `EGG_OS_AUTH_SPEC_BUILDABLE_v0.2.md` dan `EGG_OS_GLOBAL_CONTRACT_v0.2.md`. Stack: Cloudflare Workers + Hono + TypeScript + Zod + Drizzle ORM + PostgreSQL via Hyperdrive. Hasilkan: (1) Drizzle schema (§1), (2) Hono routes untuk 9 endpoint (§5) memakai envelope & error catalog Global Contract, (3) Zod schema request/response, (4) authMiddleware + firstLoginGuard (§6), (5) util password (scrypt @noble/hashes) & token (§10), (6) test Vitest yang mengeksekusi SEMUA acceptance criteria §7. Jangan menambah field/endpoint yang tidak ada di spec. Jika ada yang ambigu, BERHENTI dan tanya — jangan asumsi."

**Cara ukur:** hitung berapa putaran koreksi sampai output benar.
- **≤ 3 putaran, 0 pertanyaan arsitektural** → gate LULUS. Pola spec terbukti. Lanjut RBAC → INV → ODR → AUD via pipeline.
- **> 3 putaran** → catat di MANA AI bingung (biasanya: acceptance criteria kurang spesifik / error case bolong). Tambal pola itu DI SINI dulu sebelum modul berikutnya — karena lubang yang sama akan kebawa ke 12 modul lain.

---

*Selesai = AUTH lulus gate. Itu momen lo tahu pendekatan spec→build ini works — bukan setelah semua modul "terasa sempurna".*
