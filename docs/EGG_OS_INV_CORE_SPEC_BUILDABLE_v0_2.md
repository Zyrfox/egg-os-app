# EGG OS — INV-CORE Module Spec (Buildable) v0.2

**Type:** Buildable Module Spec (modul bisnis pertama — ledger keuangan/stok)
**Project:** EGG OS · **Owner:** Ilham Juniansyah S (ERP Owner)
**Stack:** Cloudflare Workers + Hono + TypeScript + Zod + Drizzle ORM + PostgreSQL (Hyperdrive)
**Depends on:** Global Contract (§9 tenant, §11 locked) + AUTH (`ctx`) + RBAC (`requirePermission`) + CORE (outlets/brands/departments) + USERS. **BACA semua.**
**Goal:** Fondasi stok EGG OS: item master, satuan + konversi, 4 gerakan stok dasar (in/out/opname/waste), dan **ledger append-only** sebagai sumber kebenaran saldo per outlet. INV-FLOW (transfer antar-outlet + BOM/resep) dibangun DI ATAS modul ini nanti. Lewati gate (≤3 koreksi).

---

## 0. Scope

**MASUK (INV-CORE):**
- Item master (SKU EGG OS sendiri) + kategori.
- Satuan (unit) + konversi multi-unit (mis. karton↔pcs).
- 4 gerakan stok: `stock_in`, `stock_out`, `opname` (penyesuaian fisik), `waste` (buang/rusak).
- Ledger movement **append-only** + saldo stok per (item, outlet).
- Baca tabel Pawoon (`pawoon_*`) **READ-ONLY** untuk referensi (mis. cocokkan item).

**DI LUAR SCOPE (INV-FLOW, spec terpisah — JANGAN bangun sekarang):**
- Transfer antar-outlet (2-sided + approval + in-transit).
- BOM/resep (auto-deduct bahan saat penjualan).
- Auto-sync 2 arah ke Pawoon (INV-CORE hanya BACA Pawoon, tidak menulis).
- Purchase order / supplier / harga beli (modul PROCUREMENT nanti).

---

## 1. Prinsip Ledger (baca sebelum schema — ini jantungnya)

**Saldo stok TIDAK disimpan sebagai angka yang di-UPDATE.** Saldo = hasil agregat dari ledger append-only (event sourcing ringan). Alasannya: stok itu data finansial — harus auditable, tiap perubahan punya jejak, tidak bisa di-overwrite diam-diam.

```
stock_movements (append-only, IMMUTABLE) → sumber kebenaran
stock_balances  (cache saldo, di-update dari movement dalam transaksi yang sama)
```
- Tiap gerakan tulis 1 baris `stock_movements` (tak pernah di-update/hapus; koreksi = movement baru).
- `stock_balances` = saldo cepat per (item, outlet), di-update **atomik** bareng insert movement (transaksi DB).
- Saldo HARUS bisa direkonstruksi dari sum(movements). Test wajib buktikan `balance == sum(movements)`.

**Satuan dasar (base unit):** semua movement disimpan dalam **base unit** item. Input boleh unit lain (karton), tapi service konversi ke base unit (pcs) sebelum simpan. Saldo selalu base unit. Ini cegah kekacauan "10 karton + 5 pcs".

---

## 2. Data Model — Drizzle schema (aktual)

```ts
// packages/db/src/schema/inventory.ts
import { pgTable, uuid, varchar, text, integer, numeric, boolean, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const scopeAudit = { // pola standar
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

// Kategori item (opsional grouping)
export const itemCategories = pgTable("item_categories", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull().references(() => /* companies.id */ sql`companies(id)` as any),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  ...scopeAudit,
}, (t) => ({
  uq: uniqueIndex("item_categories_company_code_uq").on(t.companyId, t.code).where(sql`${t.deletedAt} IS NULL`),
  companyIdx: index("item_categories_company_idx").on(t.companyId),
}));

// Item master (SKU EGG OS)
export const items = pgTable("items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),
  sku: varchar("sku", { length: 60 }).notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  categoryId: uuid("category_id"),
  baseUnitId: uuid("base_unit_id").notNull(),           // satuan dasar (pcs/gram)
  pawoonRef: varchar("pawoon_ref", { length: 120 }),    // opsional: id/sku item Pawoon utk pencocokan
  isActive: boolean("is_active").notNull().default(true),
  ...scopeAudit,
}, (t) => ({
  skuUq: uniqueIndex("items_company_sku_uq").on(t.companyId, t.sku).where(sql`${t.deletedAt} IS NULL`),
  companyIdx: index("items_company_idx").on(t.companyId),
}));

// Satuan
export const units = pgTable("units", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),
  code: varchar("code", { length: 30 }).notNull(),       // PCS, KARTON, GRAM, KG
  name: varchar("name", { length: 60 }).notNull(),
  ...scopeAudit,
}, (t) => ({
  uq: uniqueIndex("units_company_code_uq").on(t.companyId, t.code).where(sql`${t.deletedAt} IS NULL`),
}));

// Konversi unit per item: 1 fromUnit = factor × baseUnit
export const itemUnitConversions = pgTable("item_unit_conversions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),
  itemId: uuid("item_id").notNull(),
  fromUnitId: uuid("from_unit_id").notNull(),            // mis. KARTON
  factorToBase: numeric("factor_to_base", { precision: 18, scale: 6 }).notNull(), // 1 KARTON = 24 base(PCS)
  ...scopeAudit,
}, (t) => ({
  uq: uniqueIndex("item_unit_conv_uq").on(t.itemId, t.fromUnitId).where(sql`${t.deletedAt} IS NULL`),
  positiveFactor: check("item_unit_conv_factor_positive", sql`${t.factorToBase} > 0`),
}));

// LEDGER — append-only, IMMUTABLE
export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),
  itemId: uuid("item_id").notNull(),
  outletId: uuid("outlet_id").notNull(),
  movementType: varchar("movement_type", { length: 20 }).notNull(), // stock_in|stock_out|opname|waste
  // qtyBase: SELALU dalam base unit, SUDAH dikonversi. Bertanda:
  //   stock_in / opname(+) → positif; stock_out / waste / opname(-) → negatif.
  qtyBase: numeric("qty_base", { precision: 18, scale: 6 }).notNull(),
  inputQty: numeric("input_qty", { precision: 18, scale: 6 }).notNull(),  // qty asli yang diinput user
  inputUnitId: uuid("input_unit_id").notNull(),                            // unit asli input
  reason: text("reason"),
  refNo: varchar("ref_no", { length: 80 }),               // no dokumen eksternal opsional
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // NO updatedAt / deletedAt — IMMUTABLE. Koreksi = movement baru.
}, (t) => ({
  typeCheck: check("stock_movements_type_check", sql`${t.movementType} IN ('stock_in','stock_out','opname','waste')`),
  itemOutletIdx: index("stock_movements_item_outlet_idx").on(t.itemId, t.outletId),
  companyIdx: index("stock_movements_company_idx").on(t.companyId),
  createdIdx: index("stock_movements_created_idx").on(t.createdAt),
}));

// CACHE saldo per (item, outlet) — di-update atomik dgn movement
export const stockBalances = pgTable("stock_balances", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),
  itemId: uuid("item_id").notNull(),
  outletId: uuid("outlet_id").notNull(),
  qtyBase: numeric("qty_base", { precision: 18, scale: 6 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("stock_balances_item_outlet_uq").on(t.itemId, t.outletId),
  outletIdx: index("stock_balances_outlet_idx").on(t.outletId),
}));
```
> **Catatan FK:** tulis FK references yang benar (companyId→companies, itemId→items, outletId→outlets, unit refs→units) — pola sama seperti RBAC schema. `numeric` dipakai untuk qty (BUKAN float) demi presisi — stok finansial tak boleh kena floating point error.

---

## 3. Pawoon read-only

- INV-CORE boleh SELECT dari tabel `pawoon_*` (mis. `pawoon_products`) untuk referensi/pencocokan item via `items.pawoon_ref`.
- **TIDAK menulis** ke tabel Pawoon. **TIDAK** ada FK ke tabel Pawoon (loose coupling — Pawoon bisa berubah).
- Kalau tabel `pawoon_*` belum ada di DB pilot → endpoint pencocokan Pawoon (§5 #opsional) boleh nonaktif/stub. Flag ke owner, jangan invent struktur Pawoon.

---

## 4. Logika konversi (presisi — sumber bug klasik)

```
Input: user kirim { qty, unit_id }. 
Konversi ke base:
  - jika unit_id == item.baseUnitId → qtyBase = qty
  - else cari itemUnitConversions(item, unit_id) → qtyBase = qty × factorToBase
  - jika konversi tak ada → 422 ERR_VALIDATION "unit tidak dikonfigurasi untuk item ini"
Tanda qtyBase berdasarkan movementType:
  - stock_in → +
  - stock_out, waste → −
  - opname → SELISIH terhadap saldo saat ini (lihat §6 opname), bisa + atau −
Semua aritmetika pakai numeric/decimal, BUKAN JS float. Gunakan lib decimal atau hitung di SQL.
```

---

## 5. Endpoints — kontrak penuh

> Base `/api/v1/inventory`. authMiddleware + requirePermission PER-ROUTE. Envelope + error catalog. Zod di packages/validation. Permission code dari katalog RBAC (lihat §8 — mungkin perlu re-seed).

| # | Method | Path | Permission | Catatan |
|---|---|---|---|---|
| 1 | GET | `/items` | `inventory.read` | list item (tenant, paginated, filter kategori/aktif) |
| 2 | POST | `/items` | `inventory.item_manage` | buat item + base unit |
| 3 | GET | `/items/:id` | `inventory.read` | detail + konversi unit-nya |
| 4 | PATCH | `/items/:id` | `inventory.item_manage` | edit nama/kategori/aktif |
| 5 | POST | `/items/:id/units` | `inventory.item_manage` | tambah konversi unit (factor) |
| 6 | GET | `/units` | `inventory.read` | list satuan |
| 7 | POST | `/units` | `inventory.item_manage` | buat satuan |
| 8 | GET | `/categories` | `inventory.read` | list kategori |
| 9 | POST | `/categories` | `inventory.item_manage` | buat kategori |
| 10 | POST | `/movements/stock-in` | `inventory.stock_in` | catat masuk |
| 11 | POST | `/movements/stock-out` | `inventory.stock_out` | catat keluar (cek saldo cukup) |
| 12 | POST | `/movements/waste` | `inventory.waste` | catat buang/rusak (cek saldo cukup) |
| 13 | POST | `/movements/opname` | `inventory.opname` | input hitung fisik → sistem buat movement selisih |
| 14 | GET | `/movements` | `inventory.read` | ledger (filter item/outlet/type/tanggal, paginated) |
| 15 | GET | `/balances` | `inventory.read` | saldo per item/outlet (scope-filtered) |

### Zod inti
```ts
const MovementReq = z.object({
  item_id: z.string().uuid(),
  outlet_id: z.string().uuid(),
  qty: z.number().positive(),
  unit_id: z.string().uuid(),
  reason: z.string().max(500).optional(),
  ref_no: z.string().max(80).optional(),
}); // dipakai stock-in/out/waste

const OpnameReq = z.object({
  item_id: z.string().uuid(),
  outlet_id: z.string().uuid(),
  counted_qty: z.number().min(0),   // hasil hitung fisik
  unit_id: z.string().uuid(),
  reason: z.string().max(500).optional(),
}); // sistem hitung selisih vs saldo → movement opname

const CreateItemReq = z.object({
  sku: z.string().min(1).max(60),
  name: z.string().min(1).max(150),
  category_id: z.string().uuid().nullable().optional(),
  base_unit_id: z.string().uuid(),
  pawoon_ref: z.string().max(120).optional(),
});
```

---

## 6. Aturan tiap movement (service)

```
SEMUA movement (transaksi DB atomik): insert stock_movements + update stock_balances bersamaan.
company_id & created_by dari ctx.auth. outlet_id harus dalam scope user (RBAC §3.3 / scopeCovers).

stock_in:
  qtyBase = +convert(qty, unit). balance += qtyBase.

stock_out / waste:
  qtyBase = −convert(qty, unit).
  CEK saldo cukup: balance + qtyBase >= 0. Kalau kurang → 422 ERR_INSUFFICIENT_STOCK 
  (tambah ke error catalog Global Contract). balance += qtyBase (berkurang).

opname:
  countedBase = convert(counted_qty, unit).
  currentBase = saldo saat ini (item,outlet) (0 kalau belum ada).
  diff = countedBase − currentBase.
  movement qtyBase = diff (bisa + / −). balance = countedBase (set ke hasil hitung fisik).
  reason default "stock opname" kalau kosong.

Scope enforcement: outlet_id di luar scope user → 404 ERR_OUT_OF_SCOPE.
Item/outlet beda company → 404. Tenant filter wajib.
```

---

## 7. Acceptance Criteria (GIVEN/WHEN/THEN)

```text
ITEM / UNIT
N1 POST /items valid → 201, base_unit terset
N2 POST /items sku duplikat (company) → 409 ERR_DUPLICATE
N3 POST /items/:id/units factor<=0 → 422
N4 GET /items/:id → detail + daftar konversi unit

MOVEMENT — KONVERSI
N5 GIVEN item base=PCS, konversi 1 KARTON=24 PCS WHEN stock-in 2 KARTON THEN movement qtyBase=+48, balance=48
N6 GIVEN stock-in pakai unit yang tak dikonfigurasi THEN 422 ERR_VALIDATION
N7 GIVEN qty desimal (1.5 KG, base GRAM, 1KG=1000) THEN qtyBase=1500 (presisi, no float error)

MOVEMENT — SALDO
N8 GIVEN balance 48 WHEN stock-out 10 PCS THEN movement −10, balance=38
N9 GIVEN balance 5 WHEN stock-out 10 THEN 422 ERR_INSUFFICIENT_STOCK, balance TETAP 5, TIDAK ada movement
N10 GIVEN balance 38 WHEN waste 3 THEN movement −3 type=waste, balance=35
N11 GIVEN balance 35, opname counted=30 THEN movement type=opname qtyBase=−5, balance=30
N12 GIVEN belum ada saldo, opname counted=20 THEN movement +20, balance=20

LEDGER INTEGRITY
N13 GIVEN beberapa movement WHEN sum(qtyBase) per (item,outlet) THEN == stock_balances.qtyBase (rekonsiliasi)
N14 movement IMMUTABLE: tidak ada endpoint update/delete movement (koreksi via movement baru)

SCOPE / TENANT
N15 GIVEN user scope outlet A WHEN movement outlet B THEN 404 ERR_OUT_OF_SCOPE
N16 GIVEN item company lain WHEN akses THEN 404
N17 GIVEN GET /balances scope outlet A THEN hanya saldo outlet A (accessFilter)

ENFORCEMENT
N18 tanpa inventory.stock_in WHEN stock-in THEN 403 ERR_FORBIDDEN
N19 tanpa Bearer THEN 401
```

---

## 8. Permission catalog (cek RBAC seed — mungkin re-seed)

INV-CORE butuh permission ini di katalog RBAC (`02-rbac.ts`). Yang **sudah ada**: `inventory.read, inventory.stock_in, inventory.stock_out, inventory.opname, inventory.waste`. Yang **mungkin perlu ditambah**: `inventory.item_manage` (kelola item/unit/kategori).
> Kalau `inventory.item_manage` belum ada → tambahkan ke seed catalog + assign ke role yang relevan (MANAGER/SPV minimal bisa read; item_manage ke MANAGER/ERP_OWNER). Re-seed idempotent. JANGAN bikin code di luar pola `module.action`.

Tambahkan juga error baru ke Global Contract catalog: `ERR_INSUFFICIENT_STOCK` (422), `ERR_DUPLICATE` (409, kalau belum ada dari USERS).

---

## 9. Definition of Done — INV-CORE
```
[ ] Schema 6 tabel + FK + check + partial-unique (migrate ke Neon)
[ ] Ledger append-only: movement IMMUTABLE, balance update atomik dalam transaksi
[ ] Konversi multi-unit presisi (numeric, bukan float) — test N5/N7
[ ] Saldo cukup di-enforce (stock-out/waste) — N9
[ ] Opname = selisih, set balance ke hasil hitung — N11/N12
[ ] Rekonsiliasi balance == sum(movements) — N13
[ ] Scope/tenant: outlet di luar scope → 404; cross-company → 404 — N15/N16
[ ] requirePermission per-route; inventory.item_manage di-seed kalau perlu
[ ] ERR_INSUFFICIENT_STOCK ditambah ke catalog
[ ] SEMUA acceptance §7 (N1-N19) hijau
[ ] Tidak regresi: AUTH 27 + CORE 8 + RBAC + USERS tetap hijau
[ ] apps/web TIDAK disentuh
[ ] Lulus gate: koreksi ≤3, 0 pertanyaan arsitektural, 0 invention
```

---

## 10. Dry-run prompt (build berlangkah)
> "Implement INV-CORE sesuai `docs/EGG_OS_INV_CORE_SPEC_BUILDABLE_v0_2.md` + Global Contract + AUTH/RBAC/CORE/USERS. Berlangkah, stop-lapor: (1) re-seed RBAC kalau perlu `inventory.item_manage` + tambah ERR_INSUFFICIENT_STOCK ke catalog, STOP. (2) Schema 6 tabel §2 + migrate Neon, STOP. (3) Service: konversi unit (numeric, no float) + 4 movement dengan ledger append-only + balance atomik + cek saldo + scope, STOP. (4) 15 endpoint §5 + Zod, STOP. (5) Vitest SEMUA acceptance §7 termasuk N13 rekonsiliasi, pastikan modul lama TIDAK regresi, STOP. Patuhi CLAUDE.md. Ambigu → STOP & tanya. 0 invention. JANGAN sentuh apps/web. JANGAN commit sampai diaudit. Mulai langkah 1."

**Titik audit paling rawan (gua periksa ketat):** N9 (saldo cukup — stock-out melebihi saldo harus ditolak & TIDAK nyisain movement), N13 (rekonsiliasi balance==sum movements — bukti ledger konsisten), N7 (presisi desimal — no float error), N11 (opname selisih, bukan overwrite buta), N5 (konversi unit benar).

---

*INV-CORE selesai = fondasi stok teruji. INV-FLOW (transfer + BOM) berdiri di atas ledger ini. Modul bisnis pertama EGG OS — di sinilah "spec ketat + audit" paling penting, karena ini menyangkut angka stok riil yang dipakai keputusan bisnis.*
