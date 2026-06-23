# EGG OS — RBAC Module Spec (Buildable) v0.2

**Type:** Buildable Module Spec (security-critical)
**Project:** EGG OS · **Owner:** Ilham Juniansyah S (ERP Owner)
**Stack:** Cloudflare Workers + Hono + TypeScript + Zod + Drizzle ORM + PostgreSQL (Hyperdrive)
**Depends on:** `EGG_OS_GLOBAL_CONTRACT_v0.2.md` (§5 permission scheme, §9 tenant isolation, **§11 locked rulings**) + `EGG_OS_AUTH_SPEC_BUILDABLE_v0.2.md` (menyediakan `ctx`). **BACA DUA ITU DULU.**
**Goal:** RBAC adalah modul paling sensitif — dia nentuin *siapa boleh ngapain di scope mana*. CORE yang dibangun tanpa spec bocor cross-company; RBAC TIDAK BOLEH ngalamin itu. Lewati gate (≤3 koreksi) seperti AUTH.

---

## 0. Scope

RBAC menangani: definisi role, katalog permission, penugasan role ke user pada scope tertentu, override per-user (grant/deny), resolusi permission efektif, dan penegakan izin di setiap request (middleware). RBAC juga **mengisi** `GET /auth/me/permissions` (yang di AUTH masih placeholder) dan **mengisi `roles`/`scopes` di JWT** (yang di AUTH masih `[]`).

**Di luar scope RBAC:** UI hook (`useCan`, `<Can/>`) — frontend belum ada, JANGAN dibuat, flag ke owner. Login/sesi (AUTH). CRUD user master (USERS).

---

## 1. Konsep & Aturan Kunci (baca sebelum schema)

**Locked dari Global Contract §11 — jangan diubah:**
- **Role code** = `UPPERCASE_SNAKE` (mis. `SPV_OUTLET`, `SUPER_ADMIN`).
- **Permission code** = `lowercase.dot` **2-level** = `{module}.{action}` (mis. `inventory.stock_in`). JANGAN 3-level.
- **scope_type** = 8 nilai: `global, company, brand, outlet, department, own, assigned, audit_view`.
- **SUPER_ADMIN** scope = `global`.

**Dua jenis scope (PENTING — beda cara enforce-nya):**
- **Structural scope** (`global, company, brand, outlet, department`): hierarkis, dicek di **middleware** via org-tree (brand nutup outlet & department di bawahnya).
- **Row-level scope** (`own, assigned, audit_view`): tidak hierarkis, diterapkan sebagai **filter query di service layer** (mis. `own` → `WHERE created_by = userId`).

**Precedence resolusi (deny-wins):**
```
explicit DENY override  >  explicit GRANT override  >  role-based grant
```
Deny SELALU menang. Ini wajib demi keamanan.

---

## 2. Data Model — Drizzle schema (aktual)

```ts
// packages/db/src/schema/rbac.ts
import { pgTable, uuid, varchar, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Katalog permission = vocabulary sistem (di-seed sekali, BUKAN per-company)
export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 100 }).notNull(),      // lowercase.dot 2-level: inventory.stock_in
  module: varchar("module", { length: 50 }).notNull(),   // inventory
  action: varchar("action", { length: 50 }).notNull(),   // stock_in
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  codeUq: uniqueIndex("permissions_code_uq").on(t.code),
  moduleIdx: index("permissions_module_idx").on(t.module),
}));

// Role = bundle permission, per-company
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),
  code: varchar("code", { length: 50 }).notNull(),                 // UPPERCASE_SNAKE
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  defaultScopeType: varchar("default_scope_type", { length: 20 }).notNull(), // validasi assignment
  isSystem: boolean("is_system").notNull().default(false),         // role bawaan, tak bisa edit/hapus
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  codeUq: uniqueIndex("roles_company_code_uq").on(t.companyId, t.code),
  companyIdx: index("roles_company_idx").on(t.companyId),
}));

// role ↔ permission (M:N)
export const rolePermissions = pgTable("role_permissions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  roleId: uuid("role_id").notNull(),
  permissionId: uuid("permission_id").notNull(),
  companyId: uuid("company_id").notNull(),               // denormalized utk tenant filter
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("role_permissions_uq").on(t.roleId, t.permissionId),
  roleIdx: index("role_permissions_role_idx").on(t.roleId),
}));

// Penugasan role ke user PADA SCOPE tertentu
export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  roleId: uuid("role_id").notNull(),
  companyId: uuid("company_id").notNull(),
  scopeType: varchar("scope_type", { length: 20 }).notNull(),  // global|company|brand|outlet|department|own|assigned|audit_view
  scopeId: uuid("scope_id"),                                   // brand_id/outlet_id/department_id; null utk global|company|own|assigned|audit_view
  grantedBy: uuid("granted_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),  // revoke = soft delete
}, (t) => ({
  uq: uniqueIndex("user_roles_uq").on(t.userId, t.roleId, t.scopeType, t.scopeId),
  userIdx: index("user_roles_user_idx").on(t.userId),
}));

// Override per-user: grant/deny permission spesifik, MENGALAHKAN role
export const accessOverrides = pgTable("access_overrides", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  permissionId: uuid("permission_id").notNull(),
  companyId: uuid("company_id").notNull(),
  effect: varchar("effect", { length: 10 }).notNull(),         // grant|deny
  scopeType: varchar("scope_type", { length: 20 }),            // opsional; null = berlaku company-wide
  scopeId: uuid("scope_id"),
  reason: text("reason"),
  grantedBy: uuid("granted_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),  // opsional time-bound
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  uq: uniqueIndex("access_overrides_uq").on(t.userId, t.permissionId, t.scopeType, t.scopeId),
  userIdx: index("access_overrides_user_idx").on(t.userId),
}));
```

---

## 3. Resolusi Permission (jantung modul — spesifikasi presisi)

### 3.1 `resolveUserPermissions(userId, companyId): ResolvedAccess`
```ts
type Grant = { permission: string; scopeType: ScopeType; scopeId: string | null };
type ResolvedAccess = {
  roles: string[];          // ["SPV_OUTLET"]
  grants: Grant[];          // hasil akhir setelah override diterapkan
  rawScopes: { scopeType: ScopeType; scopeId: string | null }[]; // utk JWT hint
};
```
Algoritma (urut, jangan diubah):
```
1. Ambil user_roles aktif (deletedAt null) milik userId di companyId.
2. Untuk tiap user_role: ambil permission role itu (role_permissions → permissions).
   → Hasilkan Grant { permission, scopeType=userRole.scopeType, scopeId=userRole.scopeId }.
   (Permission diwarisi pada scope tempat role di-assign.)
3. Ambil access_overrides aktif (deletedAt null, expiresAt null ATAU > now()).
   - effect=grant → TAMBAH Grant { permission, scopeType, scopeId } (scope dari override, default company kalau null).
   - effect=deny  → CATAT sebagai deny-rule.
4. Terapkan deny: buang/maskkan setiap Grant yang cocok deny-rule (match permission + scope overlap).
   DENY MENANG — walau ada grant dari role maupun override.
5. Return { roles, grants (post-deny), rawScopes }.
```
> Catatan: hasil ini boleh di-cache **per-request** (resolve sekali di awal request, simpan di `ctx`). JANGAN cache lintas-request tanpa invalidasi — perubahan role harus langsung berlaku (Global Contract §4: authz dicek dari DB).

### 3.2 `scopeCovers(grant, target, orgTree): boolean`
Untuk **structural scope**. `target` = { scopeType, scopeId } resource yang diakses.
```
global              → true (selalu, dalam company sama)
company             → true (company sama)
brand:B             → true jika target = brand B, ATAU outlet/department milik B (lewat orgTree)
outlet:O            → true jika target = outlet O, ATAU department milik O
department:D        → true jika target = department D
own | assigned      → return false di sini (BUKAN structural — ditangani di service layer, lihat §3.3)
audit_view          → true HANYA untuk action read/list dan permission yang ditandai auditable; else false
```
orgTree = relasi brand→outlet→department dari modul CORE. Resolver harus query CORE untuk cek keturunan.

### 3.3 Row-level scope (`own`, `assigned`) — DI SERVICE LAYER
Middleware **tidak bisa** memutuskan `own`/`assigned` (butuh lihat baris data). Aturan:
- Kalau grant efektif user untuk permission ini **cuma** punya scope `own` → service WAJIB tambah filter `WHERE created_by = userId`.
- Kalau cuma `assigned` → filter `WHERE id IN (resource assigned ke userId)`.
- Kalau ada structural scope yang lebih luas (mis. outlet) → pakai itu, `own`/`assigned` jadi superset-nya.
- Service menerima `accessFilter` dari `ctx` (disiapkan middleware) dan menerapkannya. JANGAN skip.

### 3.4 `hasPermission(ctx, permissionCode, target?): boolean`
```
1. grants = ctx.access.grants utk permissionCode.
2. Jika tidak ada grant sama sekali → false (→ caller balas 403 ERR_FORBIDDEN).
3. Jika ada grant tapi semua row-level (own/assigned) → return true di sini,
   filter diterapkan di service (§3.3).
4. Untuk structural: jika ADA grant yang scopeCovers(target) → true.
   Jika ADA grant permission ini TAPI tidak ada yang cover target → "out of scope"
   (→ caller balas 404 ERR_OUT_OF_SCOPE, BUKAN 403 — jangan bocorkan eksistensi resource).
```

---

## 4. Middleware — `requirePermission`

```ts
// requirePermission(code: string, targetResolver?: (c) => {scopeType, scopeId} | null)
// Hono middleware factory. Dipakai PER-ROUTE (jangan use('*') — itu pernah bikin 15 regresi AUTH).
//
//  1. Pastikan authMiddleware sudah jalan (ctx.auth ada). Else 401 ERR_UNAUTHENTICATED.
//  2. Resolve ctx.access sekali (cache di ctx) via resolveUserPermissions.
//  3. target = targetResolver?.(c) ?? null  (mis. ambil outlet_id dari params).
//  4. result = evaluate(code, target):
//       - tak punya permission sama sekali          → 403 ERR_FORBIDDEN
//       - punya permission, target tak ter-cover    → 404 ERR_OUT_OF_SCOPE
//       - punya & cover (atau row-level)            → lanjut; set ctx.accessFilter utk service
//  5. next()
```
**Beda 403 vs 404 (wajib benar):**
- `403 ERR_FORBIDDEN` = lo memang nggak punya izin ini sama sekali (STAFF coba akses admin RBAC).
- `404 ERR_OUT_OF_SCOPE` = lo punya izinnya, tapi nggak buat resource INI (SPV outlet A buka outlet B). Balas 404 biar nggak bocor bahwa outlet B ada.

---

## 5. Endpoints — kontrak penuh

> Envelope & error dari Global Contract. Semua route butuh `authMiddleware` + `requirePermission(...)`. Base `/api/v1`. Zod di `packages/validation`.

| # | Method | Path | Permission | Catatan |
|---|---|---|---|---|
| 1 | GET | `/rbac/roles` | `rbac.role_read` | list role company (tenant-filtered) |
| 2 | POST | `/rbac/roles` | `rbac.role_create` | code UPPERCASE_SNAKE, default_scope_type valid |
| 3 | GET | `/rbac/roles/:id` | `rbac.role_read` | role + permission-nya |
| 4 | PATCH | `/rbac/roles/:id` | `rbac.role_update` | TOLAK kalau is_system=true |
| 5 | DELETE | `/rbac/roles/:id` | `rbac.role_delete` | soft delete; TOLAK kalau is_system |
| 6 | PUT | `/rbac/roles/:id/permissions` | `rbac.role_update` | set permission role (array code) |
| 7 | GET | `/rbac/permissions` | `rbac.permission_read` | katalog permission |
| 8 | POST | `/rbac/users/:userId/roles` | `rbac.role_assign` | assign role pada scope |
| 9 | GET | `/rbac/users/:userId/roles` | `rbac.role_read` | assignment user |
| 10 | DELETE | `/rbac/users/:userId/roles/:assignmentId` | `rbac.role_assign` | revoke (soft delete) |
| 11 | POST | `/rbac/users/:userId/overrides` | `rbac.override_manage` | grant/deny override |
| 12 | DELETE | `/rbac/users/:userId/overrides/:id` | `rbac.override_manage` | hapus override |
| 13 | GET | `/auth/me/permissions` | (auth saja) | **UPDATE** existing — return resolved set |

### Zod inti
```ts
const ScopeType = z.enum(["global","company","brand","outlet","department","own","assigned","audit_view"]);

const CreateRoleReq = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/, "UPPERCASE_SNAKE"),
  name: z.string().min(1),
  description: z.string().optional(),
  default_scope_type: ScopeType,
});

const SetRolePermissionsReq = z.object({
  permission_codes: z.array(z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, "lowercase.dot 2-level")).min(1),
});

const AssignRoleReq = z.object({
  role_id: z.string().uuid(),
  scope_type: ScopeType,
  scope_id: z.string().uuid().nullable(),  // wajib null utk global|company|own|assigned|audit_view
}).refine(v => ["global","company","own","assigned","audit_view"].includes(v.scope_type) ? v.scope_id === null : v.scope_id !== null,
  { message: "scope_id wajib utk brand/outlet/department; harus null utk lainnya" });

const CreateOverrideReq = z.object({
  permission_code: z.string(),
  effect: z.enum(["grant","deny"]),
  scope_type: ScopeType.optional(),
  scope_id: z.string().uuid().nullable().optional(),
  reason: z.string().optional(),
  expires_at: z.string().datetime().optional(),
});

// response /auth/me/permissions
const MePermissionsRes = z.object({
  roles: z.array(z.string()),
  scopes: z.array(z.object({ scope_type: ScopeType, scope_id: z.string().uuid().nullable() })),
  permissions: z.array(z.string()),  // permission code yang efektif (post-override)
});
```

---

## 6. JWT Integration (UPDATE dari AUTH)

Saat AUTH menerbitkan access token (login/refresh), **panggil `resolveUserPermissions`** lalu isi claim:
```json
{ "sub":"...", "company_id":"...",
  "roles":["SPV_OUTLET"],
  "scopes":[{"scope_type":"outlet","scope_id":"outlet_btmk_01"}],
  "first_login_required": false, "iat":0, "exp":0 }
```
- `roles` & `scopes` = **hint UX** (frontend boleh pakai utk sembunyikan menu).
- **Permission penuh TIDAK ditaruh di JWT** (bisa banyak → token gede). Resolve server-side tiap request via `resolveUserPermissions` (cache per-request).
- Otorisasi nyata SELALU dari DB, bukan dari JWT (Global Contract §4).

---

## 7. Seed — Permission Catalog + Starter Roles

### 7.1 Permission catalog (seed `permissions`, idempotent upsert by code)
```
rbac.role_read, rbac.role_create, rbac.role_update, rbac.role_delete,
rbac.role_assign, rbac.permission_read, rbac.override_manage
core.company_read, core.brand_read, core.brand_manage,
core.outlet_read, core.outlet_manage, core.department_read, core.department_manage
users.read, users.create, users.update, users.deactivate
inventory.read, inventory.stock_in, inventory.stock_out, inventory.opname, inventory.waste
reports.read, reports.submit, reports.validate
approval.read, approval.request, approval.decide
audit.read
export.run
```

### 7.2 Starter roles (seed `roles` + `role_permissions`, per-company EGG, is_system=true)
```
SUPER_ADMIN  (global)   → SEMUA permission
ERP_OWNER    (company)  → semua KECUALI rbac.* destructive? → beri semua rbac.* + core.* + users.* + audit.read + export.run
DIREKSI      (company)  → *.read semua + approval.decide + audit.read + export.run
MANAGER      (brand)    → core.outlet_*, core.department_*, inventory.*, reports.read, reports.validate, approval.decide, approval.read
SPV_OUTLET   (outlet)   → inventory.*, reports.read, reports.validate, approval.request, approval.read, core.outlet_read
STAFF        (own)      → inventory.stock_in, inventory.stock_out, inventory.read, reports.submit, reports.read, approval.request
FREELANCE    (assigned) → reports.submit, reports.read, approval.request   (terbatas, time-bound via user.freelance_expires_at)
AUDITOR      (audit_view) → *.read semua + audit.read + export.run  (READ ONLY — tak ada action mutasi)
```
> Catatan: SUPER_ADMIN scope **global** (Global Contract §11 #4). AUDITOR scope **audit_view**, read-only.

### 7.3 Fixtures test
```
company EGG; users: super(SUPER_ADMIN/global), spvA(SPV_OUTLET/outlet=BTMK-01),
spvB(SPV_OUTLET/outlet=BTMF-01), staffA(STAFF/own@BTMK-01), auditor(AUDITOR/audit_view).
```

---

## 8. Acceptance Criteria (GIVEN/WHEN/THEN — testable)

```text
RESOLVE
R1 GIVEN user SPV_OUTLET@BTMK-01 WHEN resolve THEN grants inventory.* hanya scope outlet=BTMK-01
R2 GIVEN SUPER_ADMIN global       WHEN resolve THEN punya semua permission, cover semua resource
R3 GIVEN user tanpa role          WHEN resolve THEN grants kosong

OVERRIDE PRECEDENCE
O1 GIVEN role beri inventory.waste + override DENY inventory.waste WHEN resolve THEN inventory.waste TIDAK ada (deny menang)
O2 GIVEN user tanpa role-grant + override GRANT export.run WHEN resolve THEN export.run ADA
O3 GIVEN override GRANT dengan expires_at < now() WHEN resolve THEN override DIABAIKAN
O4 GIVEN override DENY + override GRANT permission sama WHEN resolve THEN DENY menang

SCOPE COVERAGE (structural)
S1 GIVEN grant brand=B WHEN akses outlet milik B THEN hasPermission true
S2 GIVEN grant outlet=O WHEN akses department milik O THEN true
S3 GIVEN grant outlet=A WHEN akses outlet B THEN out-of-scope → 404 ERR_OUT_OF_SCOPE
S4 GIVEN grant global WHEN akses resource apa pun (company sama) THEN true

ROW-LEVEL SCOPE
S5 GIVEN STAFF scope own WHEN list reports THEN service filter created_by = userId
S6 GIVEN AUDITOR audit_view WHEN GET (read) THEN diizinkan; WHEN POST (mutate) THEN 403 ERR_FORBIDDEN

ENFORCEMENT (middleware)
E1 GIVEN STAFF tanpa rbac.role_read WHEN GET /rbac/roles THEN 403 ERR_FORBIDDEN
E2 GIVEN tanpa Bearer WHEN akses route RBAC THEN 401 ERR_UNAUTHENTICATED
E3 GIVEN is_system role WHEN PATCH/DELETE THEN 422/403 (tolak, tak boleh diubah)

ASSIGNMENT & TENANCY
A1 GIVEN assign role brand-scope tanpa scope_id WHEN POST THEN 422 ERR_VALIDATION
A2 GIVEN assign role company A ke user company B WHEN POST THEN 404/403 (tenant isolation §9)
A3 GIVEN revoke user_role WHEN resolve berikutnya THEN permission dari role itu hilang

INTEGRATION
I1 GIVEN login setelah punya role WHEN /auth/me/permissions THEN return roles+scopes+permissions resolved (bukan [])
I2 GIVEN JWT diterbitkan WHEN decode THEN roles & scopes terisi (bukan [])
```

---

## 9. Security rules khusus RBAC
```
1. DENY-WINS mutlak. Test O1/O4 wajib hijau sebelum apa pun dianggap selesai.
2. company_id SELALU dari ctx.auth (§9). Assign/override lintas-company → tolak.
3. is_system role: imutabel (tak bisa edit/hapus/ubah permission inti). Lindungi di service.
4. Out-of-scope → 404, bukan 403 (anti-enumeration resource). Test S3.
5. Resolusi dari DB tiap request; JWT cuma hint. Jangan percaya roles di JWT utk authorize.
6. AUDITOR & audit_view = read-only. Pastikan tak ada permission mutasi bocor (test S6).
7. Self-escalation guard: user TIDAK boleh assign role/override ke dirinya sendiri kecuali punya rbac.role_assign DAN bukan menaikkan ke scope lebih tinggi dari miliknya. (Minimal: catat di audit; enforce kalau sempat.)
8. Tiap assign/revoke/override tulis audit event (Global Contract §8).
```

---

## 10. Definition of Done — RBAC (centang sebelum commit)
```
[ ] Drizzle schema 5 tabel + index + constraint (migrate ke Neon sukses)
[ ] resolveUserPermissions + scopeCovers + hasPermission sesuai §3 (deny-wins benar)
[ ] requirePermission middleware per-route (BUKAN use('*')) — §4
[ ] 13 endpoint §5, envelope + error catalog Global Contract
[ ] 403 (no perm) vs 404 (out-of-scope) dibedakan benar — §4
[ ] row-level scope (own/assigned) diterapkan di service layer — §3.3
[ ] JWT roles/scopes terisi + /auth/me/permissions resolved — §6 (tanpa regresi 25 test AUTH)
[ ] Seed permission catalog + 8 starter role — §7
[ ] SEMUA acceptance §8 jadi test & HIJAU (terutama O1/O4/S3/S6)
[ ] apps/web TIDAK disentuh (flag ke owner kalau perlu UI)
[ ] Lulus THE GATE: koreksi ≤3, 0 pertanyaan arsitektural, 0 invention
```

---

## 11. Dry-run prompt (tempel ke Claude Code, plan mode)
> "Implement modul RBAC sesuai `docs/EGG_OS_RBAC_SPEC_BUILDABLE_v0.2.md` + `docs/EGG_OS_GLOBAL_CONTRACT_v0.2.md` (§11) + AUTH spec. Kerjakan berurutan: (1) Drizzle schema 5 tabel §2 + migrate ke Neon, STOP lapor. (2) resolveUserPermissions + scopeCovers + hasPermission §3, util deny-wins. (3) requirePermission middleware per-route §4 (JANGAN use('*')). (4) 13 endpoint §5 + update JWT/me-permissions §6. (5) seed §7. (6) Vitest SEMUA acceptance §8, pastikan 25 test AUTH + 8 CORE TIDAK regresi. Patuhi CLAUDE.md. Ambigu → STOP & tanya, 0 invention. Tampilkan rencana dulu. Mulai LANGKAH 1."

**Cara ukur gate:** hitung putaran koreksi. Yang paling rawan & wajib lo pelototin: **deny-wins (O1/O4)**, **out-of-scope 404 bukan 403 (S3)**, **JWT integration tanpa meregresi AUTH (I2)**. Kalau >3 koreksi, catat di mana — biasanya scope coverage atau precedence.

---

*Selesai = RBAC lulus gate. Setelah ini fondasi keamanan EGG OS lengkap: identitas (AUTH) + struktur (CORE) + otorisasi (RBAC). Modul bisnis (INV/ODR/AUD) tinggal berdiri di atasnya.*
