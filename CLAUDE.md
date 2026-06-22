# EGG OS — CLAUDE.md

Project ini adalah **EGG OS**, sistem ERP internal berbasis web.
Root repo folder: `egg-os-app/` (abaikan contoh nama `egg-os` yang muncul di docs referensi — nama folder resmi adalah `egg-os-app`).

---

## Stack

| Layer | Teknologi |
|---|---|
| Frontend | Vite + React 18 + TypeScript + TanStack Router/Query/Table/Form + shadcn/ui + Tailwind |
| Backend | Cloudflare Workers + Hono + TypeScript + Zod |
| Database | PostgreSQL 16 via Drizzle ORM + Cloudflare Hyperdrive |
| Storage | Cloudflare R2 (evidence files) |
| Queue | Cloudflare Queues (export jobs) |
| Package manager | pnpm (workspaces) |

Workspace prefix: `@egg-os/*` (contoh: `@egg-os/web`, `@egg-os/api`, `@egg-os/db`).

---

## Source of Truth

Semua keputusan teknis mengikuti urutan otoritas ini:

```
1. docs/EGG_OS_GLOBAL_CONTRACT_v0.2.md   ← aturan global, TIDAK BOLEH dilanggar
2. docs/EGG_OS_AUTH_SPEC_BUILDABLE_v0.2.md  ← spec auth & RBAC
3. docs/EGG_OS_DBD_v0.2.md               ← schema database
4. docs/EGG_OS_API_SPEC_v0.2.md          ← contract API
5. docs/openapi.yaml                      ← OpenAPI spec
```

Kalau Module Spec diam → jatuh ke Global Contract.
Kalau Global Contract & Module Spec bertabrakan → Global Contract menang, flag konflik ke user.
Kalau tidak terdefinisi di keduanya → **STOP dan tanya**, jangan asumsi. 0 invention.

---

## Aturan Kerja

- Selalu baca Global Contract sebelum generate kode schema atau API baru
- Nama tabel: `snake_case` plural. Nama kolom: `snake_case`. FK: `{entity}_id`
- Setiap tabel operasional wajib punya: `id UUID`, `company_id UUID`, `created_at`, `updated_at`, `deleted_at`
- Semua timestamp: `TIMESTAMPTZ`, simpan UTC
- Business code dibuat di BACKEND, bukan frontend
- Tidak ada implementasi yang tidak ada di spec — tanya dulu

---

## Struktur Repo (target — belum diimplementasi)

```
egg-os-app/
├── apps/
│   ├── web/          # Frontend (Vite + React)
│   └── api/          # Backend (Cloudflare Workers + Hono)
├── packages/
│   ├── db/           # Drizzle schema + migrations
│   └── shared/       # Zod schemas + types bersama
├── docs/             # Spec referensi (source of truth)
├── .github/          # CI/CD workflows
├── pnpm-workspace.yaml
├── package.json
└── CLAUDE.md         # (file ini)
```

> **Catatan:** Saat ini hanya `docs/` yang sudah ada. `apps/`, `packages/`, dll belum dibuat — tunggu Sprint 0.
