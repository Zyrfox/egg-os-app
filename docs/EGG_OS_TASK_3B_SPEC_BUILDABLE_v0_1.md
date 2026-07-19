# EGG OS — Sprint 3B: TASK DELEGATION — Buildable Spec v0.1

Status: LOCKED (7 keputusan Owner default, 2026-07-17)
Konteks: mengisi gap PRD — §7.9.2 menyebut "Today task" di SPV dashboard tanpa spec flow delegasi.
Prasyarat terpenuhi: lib/scope (4A), evidence polymorphic (3A-E), audit in-transaction (4B), API_CONVENTIONS.

---

## 1. Scope MVP (keputusan Owner terkunci)

| # | Keputusan | Isi |
|---|---|---|
| 1 | Model | Ad-hoc only. Kolom `template_id` nullable disiapkan; recurring engine = UTANG. |
| 2 | Assignee | Tunggal per task. Multi-assignee = UTANG on-demand. |
| 3 | Status flow | `open → in_progress → done → verified`; `done → rejected → (revisi oleh assignee) → in_progress/done`. `in_progress` boleh di-skip (open → done legal). |
| 4 | Approval | TIDAK ada lapisan manager approval. SPV verify = final. |
| 5 | Evidence | Reuse modul evidence, `record_type='task'`. |
| 6 | Due/overdue | `due_at` timestamptz nullable (input tanggal WIB + jam opsional). Overdue = DERIVED saat query, bukan status tersimpan. |
| 7 | Scope & audit | Assign dalam outlet-scope assigner (lib/scope). Semua mutasi lahir dengan audit wiring in-transaction. |

**Keputusan tambahan (final, per veto Owner 2026-07-17):**
- **Self-assignment DILARANG total**: `assigner_user_id == assignee_user_id` ditolak saat create → 422 ERR_VALIDATION. SPV tidak bisa assign diri sendiri; task untuk SPV di-assign oleh Manager (dengan bukti/evidence bila perlu). SoD utuh dua garis: pembuat ≠ pengeksekusi, pengeksekusi ≠ verifier — tanpa pengecualian.
- **Status `cancelled`**: assigner (atau pemegang task.create dalam scope) boleh cancel task `open`/`in_progress` — kebutuhan operasional nyata (salah assign). `cancelled` terminal.
- **Edit terbatas**: PATCH title/description/due_at hanya saat status `open`, hanya oleh assigner. Setelah `in_progress` task immutable kecuali via transisi status.

---

## 2. Schema — `tasks` (tabel baru, migration LOKAL ONLY)

```
tasks
  id                uuid pk default gen_random_uuid()
  company_id        uuid NOT NULL  → companies.id
  outlet_id         uuid NOT NULL  → outlets.id
  template_id       uuid NULL      (plain uuid, TANPA FK — tabel target belum ada; recurring utang)
  title             text NOT NULL  (1..200 char, Zod)
  description       text NULL
  assigner_user_id  uuid NOT NULL  → users.id
  assignee_user_id  uuid NOT NULL  → users.id
  status            text NOT NULL default 'open'
                    CHECK IN ('open','in_progress','done','rejected','verified','cancelled')
  due_at            timestamptz NULL
  done_at           timestamptz NULL
  verified_at       timestamptz NULL
  verified_by       uuid NULL → users.id
  reject_reason     text NULL
  created_at        timestamptz NOT NULL default now()
  updated_at        timestamptz NOT NULL default now()

INDEX (company_id, outlet_id, status)
INDEX (assignee_user_id, status)
INDEX (due_at) WHERE due_at IS NOT NULL
```

Catatan FK: BERBEDA dari audit_logs (NO-FK, keputusan 4B). Tasks = tabel operasional, bukan ledger; FK ke users dipertahankan untuk integritas referensial. Test fixtures WAJIB seed users nyata (bukan ID fiktif) — konsekuensi sadar.

Tanpa `deleted_at` — task tidak pernah dihapus; `cancelled` adalah bentuk penutupan. Riwayat = audit trail.

---

## 3. Transisi status + SoD

```
open        → in_progress   assignee                    (task.update_own)
open        → done          assignee                    (skip in_progress legal)
in_progress → done          assignee
done        → verified      pemegang task.verify, scope mencakup outlet task,
                            DAN actor ≠ assignee (SoD) → pelanggaran: 403 ERR_SELF_APPROVAL
done        → rejected      syarat sama dengan verify; reject_reason WAJIB (422 jika kosong)
rejected    → in_progress   assignee (revisi)
rejected    → done          assignee (revisi langsung selesai)
open        → cancelled     assigner (atau task.create dalam scope)
in_progress → cancelled     assigner (atau task.create dalam scope)
```

- **Self-assignment dilarang**: dicegah di create (422 ERR_VALIDATION); service layer tetap defense-in-depth — jika data lama/anomali membuat assigner == assignee, /verify tetap 403 ERR_SELF_APPROVAL (SoD tidak pernah bypass).
- `verified` dan `cancelled` = TERMINAL. Transisi apapun dari keduanya → 409 ERR_CONFLICT.
- Transisi ilegal lain (mis. open → verified oleh siapapun) → 409 ERR_CONFLICT.
- Semua timestamp status diisi server-side; client tidak mengirim timestamp status.

---

## 4. Permissions (seed — verifikasi dengan query, bukan klaim)

```
task.create      buat + assign + cancel + edit-saat-open   → SPV, MANAGER, ERP_OWNER, SUPER_ADMIN
task.update_own  transisi oleh assignee atas task miliknya → semua role operasional (termasuk STAFF/crew)
task.verify      verify/reject                             → SPV, MANAGER, ERP_OWNER, SUPER_ADMIN
task.read        list/detail dalam scope                   → semua role operasional + AUDITOR
```

Mapping nama role mengikuti seed RBAC existing — Codex WAJIB membuktikan hasil seed dengan query count per role (learning: seed math diverifikasi, bukan diklaim). `task.update_own` hanya berlaku jika actor == assignee_user_id; bukan pengganti scope check.

---

## 5. Endpoints (prefix `/tasks`, mount `/api/v1/tasks` konsisten index.ts)

| Method | Path | Permission | Catatan |
|---|---|---|---|
| POST | /tasks | task.create | title, assignee_user_id, outlet_id, description?, due_at? (tanggal WIB + jam opsional → konversi konsisten pola audit L4). Assignee harus visible dalam scope assigner DAN outlet task dalam scope → jika tidak: 404 ERR_OUT_OF_SCOPE (konsisten katalog error §7) |
| GET | /tasks | task.read | filter: assignee_user_id?, status?, outlet_id?, due_from?/due_to? (WIB), overdue? (bool, derived: due_at < now AND status NOT IN (done,verified,cancelled)); paginated page/page_size max 100; ORDER due_at ASC NULLS LAST, lalu created_at DESC |
| GET | /tasks/:id | task.read | detail + evidence terlampir (record_type='task') |
| PATCH | /tasks/:id | task.create (assigner) | hanya status open; title/description/due_at |
| POST | /tasks/:id/start | task.update_own | open → in_progress |
| POST | /tasks/:id/done | task.update_own | → done |
| POST | /tasks/:id/verify | task.verify | SoD enforced |
| POST | /tasks/:id/reject | task.verify | body: reason (wajib) |
| POST | /tasks/:id/cancel | task.create | open/in_progress only |

Tenant: company dari auth context. Scope baca: task visible jika outlet_id dalam scope actor ATAU actor == assignee (assignee selalu bisa lihat task miliknya).

---

## 6. Audit wiring (WAJIB, in-transaction, pola 4B)

| Aksi | action string |
|---|---|
| create | task.create |
| start | task.start |
| done | task.done |
| verify | task.verify |
| reject | task.reject (meta.reason) |
| cancel | task.cancel |
| edit saat open | task.update (meta.changed_fields) |

Meta standar: task_id, outlet_id, assignee_user_id; TANPA field sensitif. Tepat 1 baris per aksi.

---

## 7. Acceptance

```
B1  create+assign dalam scope → 201; assignee di luar scope assigner → 404 ERR_OUT_OF_SCOPE;
    outlet di luar scope → 404 ERR_OUT_OF_SCOPE
B2  SoD: assignee memanggil /verify atas task sendiri → 403 ERR_SELF_APPROVAL, status tetap done
B3  create dengan assignee_user_id == assigner → 422 ERR_VALIDATION (self-assignment dilarang);
    defense-in-depth: /verify oleh assignee → 403 walau data anomali
B4  transisi ilegal (open→verified; aksi atas verified/cancelled) → 409 ERR_CONFLICT
B5  reject tanpa reason → 422; rejected → revisi oleh assignee → done → verify jalan penuh
B6  overdue derived benar termasuk boundary hari WIB (pola T1–T4 audit L4:
    due 23:59:59 WIB vs 00:00:00 WIB hari berikutnya) dan overdue=false untuk done/verified/cancelled
B7  permission matrix: tanpa Bearer 401; STAFF /verify 403; STAFF create 403;
    AUDITOR read 200 tapi mutasi 403
B8  evidence: attach record_type='task' → muncul di GET /tasks/:id; task verified → evidence immutable
    (konsisten perilaku evidence pada report validated)
B9  audit: tepat 1 baris per aksi ter-wire, sample per transisi; SEMUA test existing (331) TETAP HIJAU
B10 PATCH pada status selain open → 409; PATCH oleh non-assigner → 403
```

---

## 8. Pecahan sprint

```
T1: migration tasks (LOKAL ONLY — JANGAN Neon) + schema Drizzle + permissions seed
    + service core (create, transisi, SoD, self-assign exception, cancel, edit)
    + audit wiring service-level + unit tests (B1-B5, B9-B10 service-level,
    sample B3/B4). STOP audit.
T2: routes + Zod + list/filter/overdue (B6) + evidence linking (B8)
    + permission matrix HTTP (B7) + test HTTP lengkap → 3B TUTUP. STOP audit.
```

Test files baru klaim prefix UUID `d1*` (T1) dan `d2*` (T2 bila file terpisah) — daftarkan di registry spec 4B §9 dalam commit yang sama.

---

## 9. Utang tercatat 3B

- Recurring engine (Cron Trigger Workers) + tabel task_templates → saat kebutuhan piket melebihi checklist 3A.
- Manager approval layer → saat ada kelas task yang membutuhkannya (caller kedua).
- Multi-assignee → on-demand.
- Notifikasi (assignment/overdue) → butuh infra push, defer.
- KPI/widget "Today task" dashboard SPV (§7.9.2) → micro-pass post-3B, konsumsi GET /tasks.
- Cross-outlet assignment eksplisit → non-goal MVP.
