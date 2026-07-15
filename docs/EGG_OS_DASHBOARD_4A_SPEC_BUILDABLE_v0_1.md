# EGG OS — Dashboard & Approval Queue (4A) Module Spec (Buildable) v0.1

**Type:** Buildable Module Spec (Sprint 4A — Dashboard Endpoints + Approval Queue, backend-only)
**Project:** EGG OS · **Owner:** Ilham Juniansyah S (ERP Owner)
**Stack:** CF Workers + Hono + TS + Zod + Drizzle + PostgreSQL
**Depends on:** API_CONVENTIONS + AUTH + RBAC (scope) + INV-CORE + INV-APPROVAL + REPORT 3A + EVIDENCE. Read-only terhadap semuanya.
**Goal:** Endpoint agregasi JSON per role (executive/SPV/inventory/approval-queue) — "decision cockpit" data layer. Frontend React nyusul di fase frontend; 4A = backend murni.

> Turunan PRD §7.9 (Dashboard) + §7.6 APR-002/003/005 (queue dari flow existing). APR-001 (rule engine nominal L1-L5) TETAP defer — belum ada caller bernominal. Widget tanpa sumber data DI-SKIP eksplisit (jujur), bukan dibangun kosong.

---

## 0. Scope

**MASUK (4A):**
- Migration kecil: `items.min_stock numeric(18,6) NULL` (Owner: lapangan sudah punya kebiasaan batas minimum, tinggal isi data).
- 4 endpoint GET read-only: `/dashboards/executive`, `/dashboards/spv`, `/dashboards/inventory`, `/dashboards/approval-queue`.
- Permission `dashboard.executive|spv|inventory|approval_queue` + assignment (Manager = executive+inventory+approval_queue, TANPA endpoint manager terpisah — keputusan 2a).
- Compliance bulan-berjalan pakai **elapsed-days** di dashboard layer (lihat §3).

**DI LUAR SCOPE:**
- ❌ Widget tanpa data: void/refund (Pawoon), complaint (modul belum ada), audit exception (4B), today_task (3B), stock_critical hanya jalan utk item yang min_stock-nya diisi.
- ❌ APR-001 rule engine nominal / L1-L5 routing — defer (no caller).
- ❌ Audit trail (4B), Export (4C), frontend, notifikasi/reminder (P1 n8n).
- ❌ TIDAK mengubah service existing (complianceKpi TIDAK disentuh — dashboard punya query sendiri).

---

## 1. Prinsip

1. **Read-only murni.** Modul dashboard tidak menulis apa pun. Agregator sah membaca lintas modul (schema import langsung; service modul lain tidak dipanggil kecuali disebut).
2. **Satu endpoint per dashboard** (bukan per widget) — 1 call, payload sub-objek per widget. Widget yang di-skip TIDAK muncul di response (bukan null kosong).
3. **Scope dari RBAC seperti biasa** — semua query difilter outlet scope user (accessFilter/visibleOutletIds). Executive = semua outlet dalam scope user (Direksi biasanya company-wide, Manager sesuai scope-nya).
4. **Timezone: WIB (UTC+7) konstanta.** "Hari ini" = tanggal WIB. Semua outlet EGG di WIB. Helper `todayWIB()` → YYYY-MM-DD. Konstanta ini dicatat; kalau EGG buka outlet WITA/WIT → jadi kolom timezone per outlet (utang tercatat, bukan sekarang).
5. **Angka bulan-berjalan pakai elapsed days** (§3) — dashboard tidak boleh menampilkan angka yang menghukum hari yang belum terjadi.

---

## 2. Migration (satu-satunya perubahan schema)

```ts
// items (packages/db/src/schema/inventory.ts) — TAMBAH kolom:
minStock: numeric("min_stock", { precision: 18, scale: 6 }),  // NULLABLE — diisi bertahap oleh outlet
```
Migration 0009. TIDAK ada backfill (mulai NULL semua). Widget stock_critical hanya evaluasi item yang min_stock IS NOT NULL.
`PATCH /items/:id` (master-data existing) perlu terima min_stock opsional — perubahan Zod + service kecil di master-data, INI SATU-SATUNYA sentuhan ke modul lain, sebut eksplisit di diff.

---

## 3. Compliance bulan-berjalan — elapsed days (keputusan baru, transparan)

Konteks: `complianceKpi` (report service) = penyebut hari kalender penuh — valid untuk BULAN LENGKAP (keputusan Owner, caveat tercatat). Dashboard executive menampilkan bulan BERJALAN → angka akan rendah-palsu kalau pakai fungsi itu mentah.

**Keputusan 4A:** dashboard layer hitung sendiri `compliance_to_date`:
```
elapsed_days   = jumlah hari 1..todayWIB (inklusif) dalam bulan berjalan
compliant_days = hari yang opening+closing dua-duanya validated (definisi KETAT, sama)
compliance_to_date_pct = compliant_days / elapsed_days
```
- complianceKpi existing TIDAK diubah (tetap untuk laporan akhir bulan).
- Ini BUKAN membuka utang kalender-operasional (hari libur tetap ikut penyebut — itu tetap ke modul Komersial). Ini hanya berhenti menghitung hari yang belum terjadi.
- Response menyertakan `elapsed_days` + `calendar_days` supaya konsumen tahu basis angka.

---

## 4. Kontrak endpoint

Base `/api/v1/dashboards`. Semua GET, authMiddleware + requirePermission per route. Query param `date` opsional (YYYY-MM-DD, default todayWIB) untuk widget harian; `month` opsional (YYYY-MM, default bulan berjalan WIB) untuk widget bulanan.

### 4.1 GET /dashboards/executive — `dashboard.executive`
```jsonc
{
  "outlet_status":     [ { outlet_id, outlet_name, opening: "missing|draft|submitted|validated|rejected", closing: "..." } ],   // per outlet in scope, tanggal `date`
  "report_compliance": [ { outlet_id, compliant_days, elapsed_days, calendar_days, compliance_to_date_pct } ],                  // bulan `month`, elapsed-days §3
  "approval_pending":  [ { outlet_id, submitted_count, validated_count } ],                                                     // pending_stock_movements per outlet
  "stock_discrepancy": [ { outlet_id, item_id, item_name, total_delta, movement_count } ]                                       // opname delta bulan `month`, ORDER BY abs(total_delta) DESC LIMIT 10
}
```

### 4.2 GET /dashboards/spv — `dashboard.spv`
```jsonc
{
  "report_today":       [ { outlet_id, report_type, status, submitted_by_name|null, checked_count, total_count } ],  // opening+closing tanggal `date`, checklist progress
  "pending_validation": { "reports_submitted": count+list ringkas, "movements_submitted": count, "movements_validated": count },
  "opname_today":       [ { id, outlet_id, status, item_count } ],           // pending_stock_movements type opname tanggal `date` (semua status hidup)
  "issue_log":          [ { id, outlet_id, report_date, status, notes } ],   // daily_reports type=issue, terbaru dulu, LIMIT 10
  "evidence_missing":   [ { report_id, outlet_id, report_type, status } ]    // report submitted|validated tanggal `date` TANPA evidence confirmed (record_type='daily_report')
}
```

### 4.3 GET /dashboards/inventory — `dashboard.inventory`
```jsonc
{
  "stock_critical":    [ { outlet_id, item_id, item_name, balance, min_stock } ],  // balance < min_stock, HANYA item min_stock NOT NULL, ORDER BY (balance/min_stock) ASC LIMIT 20
  "movement_today":    [ { movement_type, count, total_qty } ],                     // stock_movements tanggal `date`, group by type
  "waste_summary":     [ { item_id, item_name, total_qty, movement_count } ],       // waste bulan `month`, top 10
  "pending_validation":{ submitted_count, validated_count },                        // pending_stock_movements
  "top_discrepancy":   [ { item_id, item_name, total_abs_delta } ]                  // opname bulan `month`, top 10
}
```

### 4.4 GET /dashboards/approval-queue — `dashboard.approval_queue`
```jsonc
{
  "stock_movements": {
    "to_validate": [ { id, outlet_id, movement_type, submitted_by, submitted_at, actionable } ],  // status=submitted; actionable=false kalau submitted_by == me (SoD)
    "to_finalize": [ { id, outlet_id, movement_type, validated_by, validated_at, actionable } ]   // status=validated; actionable=false kalau submitted_by == me
  },
  "reports_to_validate": [ { id, outlet_id, report_type, report_date, submitted_by, submitted_at } ]          // daily_reports submitted (report TIDAK ada SoD — semua actionable)
}
```
- Queue = read-only list; aksi tetap via endpoint modul masing-masing (approval/report). Flag `actionable` = hint SoD, murah dan jujur; enforcement tetap di service existing.
- Queue per-item mengikuti struktur flat pending_stock_movements; grouping = urusan presentasi frontend. (Keputusan Owner Q1=B: hapus item_count — setiap entry = 1 movement row, id langsung actionable.)

---

## 5. Permission & assignment (keputusan 2a)

Baru: `dashboard.executive`, `dashboard.spv`, `dashboard.inventory`, `dashboard.approval_queue`.
```
DIREKSI      → executive
MANAGER      → executive + inventory + approval_queue      (2a: tanpa endpoint manager terpisah)
SPV_OUTLET   → spv + approval_queue
SUPER_ADMIN  → semua (auto)
AUDITOR      → TIDAK dapat dashboard 4A (audit dashboard = 4B)
STAFF/FREELANCE/ERP_OWNER → tidak dapat (ERP Owner pakai SUPER_ADMIN-style akses kalau perlu — ikut pola existing seed; kalau catalog existing kasih ERP_OWNER semua non-finansial, ikuti pola)
```
Catatan seed: ikuti pola auto-assign existing; JANGAN ngarang role baru. Update seed.test count (44 → 48, role_perm sesuai).

---

## 6. Acceptance (inti)

```text
D1 executive: outlet tanpa report hari ini → opening/closing "missing"
D2 executive: compliance_to_date pakai elapsed_days (bukan calendar penuh) — hari belum terjadi TIDAK menghukum; response bawa elapsed+calendar
D3 executive: scope — Manager scope outlet A tidak melihat outlet B
D4 spv: evidence_missing HANYA report submitted|validated tanpa evidence confirmed; report dengan evidence confirmed hilang dari list
D5 inventory: stock_critical hanya item min_stock NOT NULL dan balance < min_stock
D6 inventory: min_stock bisa di-PATCH via master-data items (Zod + service diperluas)
D7 queue: movement submitted oleh GUA → muncul dengan actionable=false (SoD hint); punya orang lain → true
D8 queue: report submitted semua actionable (no SoD by design)
D9 semua endpoint: permission tepat (SPV tanpa dashboard.executive → 403), tanpa Bearer → 401
D10 date/month param opsional valid; default todayWIB / bulan berjalan WIB
D11 read-only: TIDAK ada write — seluruh modul dashboard tanpa INSERT/UPDATE/DELETE
D12 tidak regresi: 256 existing hijau
```

---

## 7. Pecahan sprint
```
Langkah 1: migration 0009 (items.min_stock) + PATCH items terima min_stock + permission dashboard.* seed + count. STOP audit.
Langkah 2: service dashboard (4 fungsi agregasi + todayWIB helper + elapsed-days) + test. STOP audit.
Langkah 3: endpoint (4 route GET) + Zod query + test HTTP. STOP audit.
```

## 8. Keputusan Owner (terkunci)
1. min_stock: TAMBAH kolom (1a) — lapangan sudah punya kebiasaan batas minimum.
2. Manager dashboard: TANPA endpoint terpisah (2a) — permission executive+inventory+approval_queue.
3. Compliance bulan-berjalan: elapsed-days di dashboard layer; complianceKpi tidak disentuh; kalender-operasional tetap utang Komersial.
4. Timezone: WIB konstanta (semua outlet WIB); per-outlet timezone = utang saat ekspansi zona.

## 9. Utang tercatat
- Widget skip (void/refund, complaint, audit-exception, today_task) → nyala saat modulnya lahir.
- lib/scope.ts extraction — dashboard = CALLER KE-3 assertOutletInScope/visibleOutletIds → **trigger ekstraksi kena**: lakukan di Langkah 2 SEBAGAI refactor kecil ATAU defer eksplisit (putuskan saat build, lapor).
- Timezone per outlet; kalender operasional (Komersial); APR-001 rule engine (saat procurement/keuangan).
