# EGG OS — Audit Trail (4B) Module Spec (Buildable) v0.1

**Type:** Buildable Module Spec (Sprint 4B — Audit Trail, gate go-live)
**Project:** EGG OS · **Owner:** Ilham Juniansyah S (ERP Owner)
**Stack:** CF Workers + Hono + TS + Zod + Drizzle + PostgreSQL
**Depends on:** API_CONVENTIONS + AUTH + RBAC + semua modul existing (wiring cross-cutting). lib/scope + lib/date sudah tersedia.
**Goal:** Ledger terpusat "siapa melakukan apa kapan" untuk semua mutasi + auth events. Append-only, immutable, **in-transaction** (audit gagal = aksi bisnis rollback — no action without trace). Menyetir PRD §7.8 (mandatory) + membuka jalan 4C (EXP-003 export logging).

> Turunan PRD §7.8. Ini ledger kedua sistem: stock_movements = ledger barang, audit_logs = ledger manusia. Pola sama: append-only, NO update/delete path, immutable selamanya.

---

## 0. Scope

**MASUK (4B):**
- Tabel `audit_logs` (append-only, polymorphic tipis pola evidence).
- `lib/audit.ts` — helper `auditLog(tx, ctx, entry)` dipanggil DALAM transaksi aksi.
- Wiring ke SEMUA titik mutasi existing (auth, users, rbac, inventory, report, evidence).
- Permission `audit.read` + endpoint `GET /audit-logs` (filter + paginated).

**DI LUAR SCOPE:**
- ❌ Read/list/dashboard logging (noise — hanya mutasi + auth events).
- ❌ Export logging (EXP-003) → di-wire pas 4C (titik mutasinya belum ada).
- ❌ Audit dashboard widget → nyusul (endpoint list cukup untuk MVP; widget = tambahan kecil nanti).
- ❌ Retensi/archiving/partitioning → utang scaling, bukan sekarang.
- ❌ Alerting/anomaly detection (P1 PRD).

---

## 1. Prinsip

1. **In-transaction (KEPUTUSAN OWNER):** `auditLog` dipanggil di dalam `db.transaction` yang sama dengan aksinya. Insert audit gagal → seluruh transaksi rollback. NO ACTION WITHOUT TRACE — jaminan absolut, bukan best-effort.
2. **Append-only ledger:** tabel TANPA updated_at, TANPA deleted_at. Tidak ada fungsi update/delete untuk audit_logs di seluruh codebase. Immutable by construction.
3. **Polymorphic tipis** (pola evidence): `record_type` + `record_id` nullable (auth events tidak punya record). NO FK ke record induk.
4. **Action naming = permission naming:** format `module.action` (mis. `report.validate`, `users.create`, `auth.login_failed`). Konsisten dengan katalog permission — auditor baca satu bahasa.
5. **Meta JSONB freeform per action** — reason reject, perubahan field master-data (old/new ringkas), email percobaan login. JANGAN dump seluruh row — hanya yang bermakna audit.
6. **Behavior-preserving wiring:** menambah jejak TIDAK BOLEH mengubah perilaku bisnis. 295 test existing = jaring pengaman; test yang berubah = red flag.

---

## 2. Data Model

```ts
// packages/db/src/schema/audit.ts
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid('company_id').notNull(),            // FK companies
  actorUserId: uuid('actor_user_id'),                  // FK users, NULLABLE (login gagal user tak dikenal)
  action: varchar('action', { length: 100 }).notNull(),// 'report.validate', 'auth.login_failed', ...
  recordType: varchar('record_type', { length: 40 }),  // NULLABLE — 'daily_report'|'pending_stock_movement'|'stock_movement'|'evidence'|'user'|'role'|'item'|... 
  recordId: uuid('record_id'),                          // NULLABLE, NO FK (polymorphic)
  outletId: uuid('outlet_id'),                          // NULLABLE — scope konteks kalau ada
  meta: jsonb('meta'),                                  // freeform per action
  ip: varchar('ip', { length: 64 }),                    // NULLABLE — auth events
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyIdx: index('audit_logs_company_idx').on(t.companyId),
  actorIdx: index('audit_logs_actor_idx').on(t.actorUserId),
  actionIdx: index('audit_logs_action_idx').on(t.action),
  recordIdx: index('audit_logs_record_idx').on(t.recordType, t.recordId),
  createdIdx: index('audit_logs_created_idx').on(t.createdAt),
}));
// APPEND-ONLY: tidak ada updated_at/deleted_at. Tidak ada CHECK record_type (daftar tumbuh per modul — beda dari evidence yang gated).
// [L2 — FK, migration 0011] company_id ON DELETE CASCADE; outlet_id ON DELETE SET NULL.
// [L3 — NO-FK, migration 0012, OWNER RATIFIED] actor_user_id TANPA FK ke users.
//   Alasan: FK + in-transaction → actor row tidak ada (mis. test cleanup) = audit INSERT
//   throw FK violation → rollback SELURUH aksi bisnis (no action at all, bukan no-trace).
//   actor_user_id bersumber JWT terverifikasi — trust sudah ada di layer auth sebelumnya.
//   NO-FK = store apa adanya; SET NULL tidak cukup (actor NULL = audit buta).
// Prod tidak pernah hard-delete user (archive = soft-delete). Revisit jika UU PDP erasure diimplementasi.
```

---

## 3. lib/audit.ts

```ts
export type AuditEntry = {
  action: string                 // 'module.action'
  recordType?: string
  recordId?: string
  outletId?: string
  meta?: Record<string, unknown>
  ip?: string
  actorUserId?: string           // default dari ctx; override utk auth events pre-login
}
export async function auditLog(db: Db /* tx! */, ctx: { companyId: string; actorUserId?: string }, entry: AuditEntry): Promise<void>
// - INSERT ke audit_logs. TIDAK menelan error (throw → transaksi rollback — by design).
// - db yang di-pass = tx handle dari transaksi aksi. Aksi tanpa transaksi existing → bungkus atau insert langsung (aksi single-statement: audit insert setelahnya dalam txn baru bersama — putuskan per titik, dokumentasikan).
```

---

## 4. Titik wiring (katalog action)

**AUTH (grup 1):** `auth.login` (sukses; meta: email), `auth.login_failed` (actorUserId null kalau user tak ada; meta: email percobaan; ip), `auth.logout`, `auth.refresh` TIDAK di-log (noise), `auth.password_changed`.

> **[L2 — Dua-ledger by design]** `auth.login_failed` di `audit_logs` hanya untuk user DIKENAL (password salah, suspended, dsb — companyId tersedia). Email tak dikenal = pre-tenant: `company_id NOT NULL` membuat insert mustahil. Path tersebut tercatat di `auth_events` (companyId nullable, ledger telemetri auth). Dua ledger beda tujuan: `auth_events` = telemetri pra-tenant (brute-force detection, login attempt log); `audit_logs` = ledger bisnis tenant-scoped. Keduanya tetap dipanggil sesuai peran masing-masing.
**USERS (grup 1):** `users.create`, `users.update` (meta: field berubah old/new ringkas — JANGAN hash password), `users.suspend`, `users.archive`, `users.password_reset`.
**RBAC (grup 1):** `rbac.role_create/update/delete`, `rbac.role_permissions_set` (meta: kode permission), `rbac.user_role_assign/revoke` (meta: role + scope).
**INVENTORY (grup 2):** `inventory.stock_in/stock_out` (movement instant; meta: item, qty), `inventory.approval_submit/validate/finalize/reject`, `inventory.transfer_create/receive`, `inventory.item_create/update`, `inventory.unit_create`, `inventory.category_create`.
**REPORT (grup 2):** `report.draft_create`, `report.update` TIDAK di-log (draft edit = noise; submit yang bermakna), `report.submit/validate/reject`.
**EVIDENCE (grup 2):** `evidence.request_upload`, `evidence.confirm`, `evidence.delete`.

> Wiring HARUS di dalam transaksi aksi masing-masing. Titik yang belum bertransaksi (mis. create master-data single-insert) → bungkus jadi transaksi kecil (insert + audit). Perilaku HTTP identik.

---

## 5. Endpoint (L4)

| GET `/audit-logs` | `audit.read` | filter: actor_user_id?, action?, record_type?+record_id?, date_from?, date_to? (created_at, WIB date), outlet_id?; paginated page/page_size; ORDER created_at DESC |

Tenant: company dari ctx. `audit.read` → AUDITOR, ERP_OWNER, SUPER_ADMIN (DIREKSI tidak). Scope: audit log TIDAK difilter per-outlet-scope (auditor lihat semua dalam company — audit itu company-wide; kalau Owner mau outlet-scoped nanti, enhancement).

---

## 6. Acceptance inti

```
A1 aksi ter-wire menghasilkan TEPAT 1 baris audit dengan action/actor/record benar (sample per modul)
A2 IN-TRANSACTION: audit insert dipaksa gagal → aksi bisnis ROLLBACK — bukti no-action-without-trace. Rantai bukti: (L1) helper-throw unit test; (L3) zero-swallow grep (tidak ada try/catch di sekitar auditLog); (L3) co-rollback engine-proven via PostgreSQL BEFORE INSERT trigger scoped company b2000000-... pada createStockIn — trigger fires setelah INSERT stock_movements + upsertIncreasedBalance, exception → full txn rollback (stock_movements=0, balance unchanged, audit_logs=0).
A3 login_failed ter-log dengan actorUserId null + ip + meta.email
A4 report.update (draft edit) TIDAK menghasilkan audit (noise-gate)
A5 GET /audit-logs: filter action + date range + record jalan; paginated; DESC
A6 permission: AUDITOR 200, DIREKSI 403, tanpa Bearer 401
A7 append-only: tidak ada kode path update/delete audit_logs (grep)
A8 295 test existing TETAP HIJAU TANPA DIUBAH (wiring behavior-preserving)
A9 meta users.update TIDAK memuat password/hash
```

---

## 7. Pecahan sprint
```
L1: schema audit_logs + migration + lib/audit.ts + permission audit.read + seed count + unit test helper. STOP audit.
L2: wiring grup 1 (auth + users + rbac) + test A1-A4 utk grup ini. STOP audit.
L3: wiring grup 2 (inventory + report + evidence) + test. STOP audit.
L4: endpoint GET /audit-logs + Zod + test HTTP (A5/A6) → 4B TUTUP. STOP audit.
```

## 8. Keputusan Owner (terkunci)
1. Granularitas: mutasi + auth events; reads TIDAK. (default)
2. Schema: satu tabel polymorphic tipis, meta JSONB. (default)
3. **IN-TRANSACTION** — audit gagal = aksi rollback. (keputusan eksplisit Owner)
4. Akses: audit.read → AUDITOR/ERP_OWNER/SUPER_ADMIN; DIREKSI tidak. (default)
5. **NO-FK actor_user_id (migration 0012, OWNER RATIFIED):** actor_user_id tidak ber-FK ke users. Alasan: FK + in-transaction dapat memblokir aksi bisnis jika actor row tidak ada saat audit INSERT. Actor bersumber JWT terverifikasi — trust layer auth sudah menjamin keberadaan sesi; ledger cukup store nilai apa adanya.

## 9. Utang tercatat
- Retensi/partitioning audit_logs → scaling phase.
- Audit dashboard widget → setelah 4B (kecil).
- EXP-003 export logging → 4C.
- Outlet-scoped audit read → kalau Owner butuh nanti.
- **[L3] Test fixture isolasi cross-file:** race condition transfer.service.test↔dashboard.service.test ditemukan ketika DDL trigger A2 menggeser Vitest worker timing. Pola bahaya: dua test file berbagi UUID prefix dengan entity types berbeda (company≠brand, item≠item). Namespace final: 97*=dashboard, 98*=approval, fc*=transfer, af*/b2*=wiring. Chore: audit semua namespace sebelum L5/frontend tambah test file baru.
