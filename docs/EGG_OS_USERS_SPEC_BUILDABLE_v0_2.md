# EGG OS — USERS Module Spec (Buildable) v0.2

**Type:** Buildable Module Spec
**Project:** EGG OS · **Owner:** Ilham Juniansyah S (ERP Owner)
**Stack:** Cloudflare Workers + Hono + TypeScript + Zod + Drizzle ORM + PostgreSQL (Hyperdrive)
**Depends on:** `EGG_OS_GLOBAL_CONTRACT_v0.2.md` (§9 tenant isolation, §11 locked rulings) + `EGG_OS_AUTH_SPEC_BUILDABLE_v0.2.md` (tabel `users`, status machine, password-token flow) + `EGG_OS_RBAC_SPEC_BUILDABLE_v0.2.md` (`requirePermission`, assign role). **BACA KETIGA.**
**Goal:** USERS = manajemen siklus hidup akun staff oleh admin. Tabel `users` SUDAH ADA (dari AUTH). Modul ini menambah **CRUD + lifecycle + role assignment**, semua di belakang `requirePermission`. Lewati gate (≤3 koreksi) seperti AUTH/RBAC.

---

## 0. Scope

**MASUK (MVP pilot BTMK/BTMF):**
- Invite user baru (buat akun status `invited` + kirim set-password token).
- List user (tenant + scope-filtered) + detail user.
- Update data dasar user oleh admin (full_name, phone).
- Status lifecycle: activate / suspend / archive (sesuai state machine AUTH).
- Assign / revoke role ke user (memanggil RBAC) — termasuk saat invite.
- Admin-trigger reset password (bikin reset token, user yang set sendiri).

**DI LUAR SCOPE MVP (fase berikutnya — JANGAN dibangun sekarang, flag kalau diminta):**
- Self-service profile editing (user edit dirinya sendiri).
- Bulk invite (CSV / banyak sekaligus).
- Freelance auto-deactivate via `freelance_expires_at` (scheduled job).
- Avatar/foto upload.

---

## 1. Data Model

**TIDAK ADA tabel baru.** Pakai `users` dari AUTH (§1 AUTH spec). Modul ini meng-operate kolom yang sudah ada: `id, company_id, email, full_name, phone, status, first_login_required, is_freelance, freelance_expires_at, created_by, created_at, updated_at, deleted_at`.

**Catatan:** assignment role disimpan di `user_roles` (RBAC), bukan di sini. USERS memanggil service RBAC untuk assign/revoke.

Kalau Drizzle butuh, boleh tambah index pendukung (mis. `users_status_idx` sudah ada dari AUTH — jangan duplikat).

---

## 2. State Machine (re-use dari AUTH — jangan ubah)

```
invited ──set-password──▶ active
active  ──suspend──▶ suspended ──reactivate──▶ active
(active|suspended) ──archive──▶ archived   (terminal, soft delete deleted_at di-set)
```
Aturan transisi yang di-enforce di USERS service:
- `activate` hanya valid dari `suspended` (untuk dari `invited`, user harus set-password dulu — admin tidak bisa paksa aktif tanpa password).
- `suspend` hanya dari `active`.
- `archive` dari `active` atau `suspended`. Archive = set `status='archived'` + `deleted_at=now()` + revoke semua refresh token + revoke semua user_roles aktif.
- Archived TIDAK bisa di-un-archive (terminal). Kalau perlu balik, buat invite baru.

---

## 3. Permission yang dipakai (sudah ada di katalog RBAC §7.1)

```
users.read        → list + detail
users.create      → invite user
users.update      → edit data dasar + reactivate + reset-password trigger
users.suspend     → suspend user (reversible)
users.archive     → archive user (terminal: revoke token + role)
rbac.role_assign  → assign/revoke role (dari RBAC, dipakai di endpoint assign)
```
> **Permission code = PLURAL `users.*`** — konsisten dengan RBAC seed produksi (`02-rbac.ts`) yang sudah pakai `users.read/create/update`. JANGAN ubah ke singular.
> **Perubahan dari versi awal:** `users.deactivate` DIPECAH jadi `users.suspend` + `users.archive` (beda level risiko: suspend reversible, archive terminal). Update seed RBAC §7.1: ganti baris `users.deactivate` jadi DUA baris `users.suspend` + `users.archive`. Re-seed (idempotent). JANGAN bikin code di luar pola `module.action`.

---

## 4. Scope & Tenant rules

- Semua query WAJIB filter `company_id` dari `ctx.auth` (§9). TIDAK PERNAH dari input user.
- List user di-scope: admin dengan scope `outlet` cuma lihat user yang punya assignment di outlet itu (lewat `user_roles`). Admin `company`/`global` lihat semua user company.
- **Row-level via accessFilter dari `requirePermission`** (RBAC middleware §3.3): kalau admin cuma punya `users.read` scope `own`/terbatas, service terapkan filter sesuai `ctx.accessFilter`.
- Akses user lintas-company → 404 `ERR_OUT_OF_SCOPE` (anti-enumeration), bukan 403.

---

## 5. Endpoints — kontrak penuh

> Base `/api/v1/users`. Semua butuh `authMiddleware` + `requirePermission(...)` PER-ROUTE. Envelope + error catalog Global Contract. Zod di `packages/validation`.

| # | Method | Path | Permission | Catatan |
|---|---|---|---|---|
| 1 | GET | `/users` | `users.read` | list, tenant+scope-filtered, paginated |
| 2 | GET | `/users/:id` | `users.read` | detail (+ roles user-nya) |
| 3 | POST | `/users` | `users.create` | invite: buat user `invited` + set-password token + (opsional) assign role |
| 4 | PATCH | `/users/:id` | `users.update` | update full_name, phone |
| 5 | POST | `/users/:id/suspend` | `users.suspend` | active → suspended |
| 6 | POST | `/users/:id/reactivate` | `users.update` | suspended → active |
| 7 | POST | `/users/:id/archive` | `users.archive` | → archived + revoke token & roles |
| 8 | POST | `/users/:id/roles` | `rbac.role_assign` | assign role pada scope (delegasi ke RBAC) |
| 9 | DELETE | `/users/:id/roles/:assignmentId` | `rbac.role_assign` | revoke role |
| 10 | POST | `/users/:id/reset-password` | `users.update` | admin trigger: buat reset token, set first_login_required=true |

### Zod inti
```ts
const InviteUserReq = z.object({
  email: z.string().email(),
  full_name: z.string().min(1).max(150),
  phone: z.string().max(30).optional(),
  is_freelance: z.boolean().optional().default(false),
  freelance_expires_at: z.string().datetime().optional(),
  // opsional assign role langsung saat invite:
  role: z.object({
    role_id: z.string().uuid(),
    scope_type: z.enum(["global","company","brand","outlet","department","own","assigned","audit_view"]),
    scope_id: z.string().uuid().nullable(),
  }).optional(),
});

const UpdateUserReq = z.object({
  full_name: z.string().min(1).max(150).optional(),
  phone: z.string().max(30).nullable().optional(),
}).refine(v => v.full_name !== undefined || v.phone !== undefined, { message: "minimal satu field" });

const AssignUserRoleReq = z.object({
  role_id: z.string().uuid(),
  scope_type: z.enum(["global","company","brand","outlet","department","own","assigned","audit_view"]),
  scope_id: z.string().uuid().nullable(),
}); // refine scope_id sama seperti RBAC §5

const ListUsersQuery = z.object({
  status: z.enum(["invited","active","suspended","archived"]).optional(),
  search: z.string().max(100).optional(),  // match email/full_name
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
}); // CATATAN: TIDAK ada company_id di query — itu dari ctx.auth.

const PublicUserDetail = z.object({
  id: z.string().uuid(), company_id: z.string().uuid(),
  email: z.string().email(), full_name: z.string(), phone: z.string().nullable(),
  status: z.enum(["invited","active","suspended","archived"]),
  first_login_required: z.boolean(), is_freelance: z.boolean(),
  freelance_expires_at: z.string().datetime().nullable(),
  last_login_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  roles: z.array(z.object({
    assignment_id: z.string().uuid(), role_code: z.string(),
    scope_type: z.string(), scope_id: z.string().uuid().nullable(),
  })),
});
```

### Invite flow (endpoint #3) — langkah service
```
1. Validasi email belum dipakai di company (UNIQUE(company_id, lower(email))). Dobel → 409 ERR_DUPLICATE.
2. Insert user: status='invited', first_login_required=true, password_hash=null, created_by=ctx.userId.
3. Buat password_token (type=set_password, TTL 72h) — pakai util AUTH §10.
4. (Opsional) kalau body.role ada → panggil RBAC assignRole(user.id, role) dalam transaksi yang sama.
5. Kirim email invite (queue) berisi link set-password. (MVP: boleh stub queue + log; flag kalau email belum siap.)
6. Audit event: user_invited.
Response 201 → PublicUserDetail.
```

---

## 6. Security rules khusus USERS

```
1. company_id SELALU dari ctx.auth. Email uniqueness dicek dalam company (§9).
2. Self-modification guard: admin TIDAK bisa archive/suspend dirinya sendiri 
   (cegah lock-out). Cek ctx.userId !== target.id untuk suspend/archive. 
   → 422 ERR_VALIDATION "tidak bisa menonaktifkan akun sendiri".
3. Privilege guard: assign role hanya boleh untuk role yang scope-nya TIDAK lebih tinggi 
   dari admin yang meng-assign (mis. SPV outlet tak bisa assign SUPER_ADMIN). 
   Minimal: tolak assign role dengan default_scope_type lebih luas dari scope admin. 
   Kalau kompleks → minimal audit + flag, tapi JANGAN biarkan SPV bikin SUPER_ADMIN.
4. Archive = irreversible. Revoke semua refresh token + user_roles aktif user itu.
5. Reset-password trigger: admin TIDAK menerima/melihat password. Hanya buat token; 
   user set sendiri (sama seperti AUTH reset flow).
6. Tiap invite/suspend/reactivate/archive/role-assign/reset tulis audit event (§8 Global Contract).
7. Out-of-scope (user company lain / di luar scope admin) → 404 ERR_OUT_OF_SCOPE.
```

---

## 7. Acceptance Criteria (GIVEN/WHEN/THEN)

```text
INVITE
U1 GIVEN email baru valid          WHEN POST /users THEN 201, user status=invited, first_login_required=true, set-password token dibuat
U2 GIVEN email sudah ada di company WHEN POST /users THEN 409 ERR_DUPLICATE
U3 GIVEN body.role disertakan       WHEN POST /users THEN user dibuat + role ter-assign (cek user_roles)
U4 GIVEN admin scope outlet bukan punya rbac.role_assign untuk SUPER_ADMIN WHEN invite+assign SUPER_ADMIN THEN ditolak (privilege guard)

LIST / DETAIL
U5 GIVEN admin company-scope        WHEN GET /users THEN lihat semua user company (tenant-filtered)
U6 GIVEN user company A             WHEN GET /users/:id user company B THEN 404 ERR_OUT_OF_SCOPE
U7 GIVEN query status=active        WHEN GET /users THEN hanya user active
U8 GIVEN GET /users/:id             THEN detail termasuk roles[] user

UPDATE
U9 GIVEN PATCH full_name            WHEN update THEN tersimpan, updated_at berubah
U10 GIVEN PATCH body kosong         WHEN update THEN 422 ERR_VALIDATION

STATUS LIFECYCLE
U11 GIVEN user active               WHEN suspend THEN status=suspended
U12 GIVEN user suspended            WHEN reactivate THEN status=active
U13 GIVEN user invited              WHEN reactivate/suspend THEN 422 (harus set-password dulu)
U14 GIVEN admin suspend dirinya sendiri WHEN suspend THEN 422 (self-guard)
U15 GIVEN user active               WHEN archive THEN status=archived, deleted_at terisi, refresh token & user_roles revoked
U16 GIVEN user archived             WHEN suspend/reactivate/archive THEN 422 (terminal)

ROLE
U17 GIVEN POST /users/:id/roles     WHEN assign THEN user_roles bertambah (delegasi RBAC)
U18 GIVEN DELETE role assignment    WHEN revoke THEN user_roles soft-deleted, permission hilang di resolve

RESET
U19 GIVEN POST /users/:id/reset-password WHEN trigger THEN reset token dibuat, first_login_required=true, admin tak lihat password

ENFORCEMENT
U20 GIVEN user tanpa users.read     WHEN GET /users THEN 403 ERR_FORBIDDEN
U21 GIVEN tanpa Bearer              WHEN akses endpoint THEN 401 ERR_UNAUTHENTICATED
```

---

## 8. Seed & Fixtures (test)
```
Pakai company EGG + user dari fixtures RBAC. Tambah:
- admin_company (ERP_OWNER, company scope) — buat test invite/list/status
- admin_outlet (SPV_OUTLET, outlet BTMK-01) — buat test scope-limit & privilege guard
- target users dengan status berbeda (invited/active/suspended) buat test lifecycle
```

---

## 9. Definition of Done — USERS
```
[ ] 10 endpoint §5, envelope + error catalog, requirePermission per-route
[ ] Invite flow: user invited + set-password token + optional role assign (transaksional)
[ ] State machine §2 di-enforce (transisi invalid → 422)
[ ] Self-guard (tak bisa nonaktifkan diri sendiri) + privilege guard (tak bisa assign role lebih tinggi)
[ ] Archive: revoke token + user_roles
[ ] Tenant isolation: lintas-company → 404; company_id selalu dari ctx
[ ] Reset-password trigger tanpa expose password
[ ] SEMUA acceptance §7 jadi test & HIJAU
[ ] Tidak regresi: AUTH existing suite (27) + CORE 8 + RBAC (resolve 14/middleware 5/routes 8/seed 5) tetap hijau
[ ] apps/web TIDAK disentuh
[ ] Lulus gate: koreksi ≤3, 0 pertanyaan arsitektural, 0 invention
```

---

## 10. Dry-run prompt (build berlangkah — Codex/Claude Code, plan mode)
> "Implement modul USERS sesuai `docs/EGG_OS_USERS_SPEC_BUILDABLE_v0_2.md` + Global Contract (§9,§11) + AUTH spec + RBAC. Tabel `users` SUDAH ADA — JANGAN bikin tabel baru. Kerjakan berlangkah, stop-lapor tiap langkah: (1) service + DTO/Zod (validasi + tenant filter + state machine + guards), STOP. (2) 10 endpoint §5 dengan requirePermission per-route + invite flow transaksional, STOP. (3) Vitest SEMUA acceptance §7, pastikan AUTH/CORE/RBAC TIDAK regresi, STOP. Patuhi CLAUDE.md. Ambigu → STOP & tanya, 0 invention. JANGAN sentuh apps/web. JANGAN commit sampai diaudit. Mulai langkah 1."

**Titik audit paling rawan:** privilege guard (U4 — SPV tak bisa bikin SUPER_ADMIN), self-guard (U14), archive cascade (U15 — token+role revoked), tenant isolation (U6 → 404). Itu yang gua periksa ketat.

---

*USERS selesai = lapisan manajemen akun lengkap. Setelah ini modul bisnis (INV/ODR/AUD) — semua berdiri di atas AUTH+CORE+RBAC+USERS yang sudah teruji.*
