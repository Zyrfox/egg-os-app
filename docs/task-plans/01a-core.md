# Sprint 1A — CORE (Org Structure)

> **Tujuan**: Entitas root organisasi siap (Company → Brand → Outlet → Department). Multi-tenant ready.
> **Estimasi**: Minggu 2.
> **Dependency**: Sprint 0 selesai.
> **Output**: 4 tabel core ter-seed (EGG, BTMK, BTMF, TSF, HCP, ENC, FRC). API list jalan.

---

## Pre-requisite

- [ ] Sprint 0 done (DB connection jalan, `/health` OK, Drizzle setup)

---

## Tasks

### Schema (Drizzle)

- [ ] **SP1A-001** Buat schema `companies` (id UUID, name, code, is_active, created_at, updated_at, deleted_at) — DoD: schema file ada di `packages/db/schema/companies.ts`
- [ ] **SP1A-002** Buat schema `brands` (id, company_id FK, name, code, is_active, soft_delete) — DoD: schema + FK constraint
- [ ] **SP1A-003** Buat schema `outlets` (id, brand_id FK, name, code, address, timezone, is_active, soft_delete) — DoD: schema + FK
- [ ] **SP1A-004** Buat schema `departments` (id, outlet_id FK nullable, brand_id FK nullable, name, code, type enum [KITCHEN/SERVICE/ADMIN/INVENTORY/FINANCE], soft_delete) — DoD: dept bisa scope ke outlet ATAU brand
- [ ] **SP1A-005** Generate + run migration: `pnpm db:generate && pnpm db:migrate` — DoD: 4 tabel ada di Postgres
- [ ] **SP1A-006** Buat index: `companies(code)`, `brands(company_id, code)`, `outlets(brand_id, code)` unique partial (where deleted_at IS NULL) — DoD: index ter-create

### Seed Data

- [ ] **SP1A-007** Buat seed file `packages/db/seeds/01-core.ts` — DoD: file ada, importable
- [ ] **SP1A-008** Seed Company: `EGG` (Easy Going Group) — DoD: 1 row di companies
- [ ] **SP1A-009** Seed Brands: `BTMK`, `BTMF`, `TSF`, `HCP`, `ENC`, `FRC` (semua di bawah EGG) — DoD: 6 row di brands
- [ ] **SP1A-010** Seed Outlets: 1 outlet BTMK (BTMK-01) + 1 outlet BTMF (BTMF-01) — DoD: 2 row di outlets
- [ ] **SP1A-011** Seed Departments: KITCHEN, SERVICE, INVENTORY untuk masing-masing outlet — DoD: 6 row di departments
- [ ] **SP1A-012** Tambahkan script `pnpm db:seed:core` — DoD: idempotent, bisa di-rerun tanpa duplicate

### API Endpoints (Hono)

- [ ] **SP1A-013** Buat folder `apps/api/src/modules/core/` dengan struktur `routes.ts`, `service.ts`, `dto.ts` — DoD: folder ada, route ter-mount di Hono app
- [ ] **SP1A-014** Endpoint `GET /api/v1/companies` — list active companies — DoD: return JSON array, hanya yang `deleted_at IS NULL`
- [ ] **SP1A-015** Endpoint `GET /api/v1/brands?company_id=` — list brands by company — DoD: filter jalan, return JSON array
- [ ] **SP1A-016** Endpoint `GET /api/v1/outlets?brand_id=` — list outlets by brand — DoD: filter jalan
- [ ] **SP1A-017** Endpoint `GET /api/v1/departments?outlet_id=&brand_id=` — list departments — DoD: filter dual (scope outlet atau brand)
- [ ] **SP1A-018** Zod schema validation untuk query param di semua endpoint — DoD: invalid UUID → 400

### Shared Types

- [ ] **SP1A-019** Export type `Company`, `Brand`, `Outlet`, `Department` dari `packages/shared/types/core.ts` — DoD: FE bisa import type tanpa import schema DB

### Tests

- [ ] **SP1A-020** Unit test: seed data ter-load benar (count company=1, brands=6, outlets=2) — DoD: test pass
- [ ] **SP1A-021** Integration test: `GET /companies` return EGG — DoD: test pass dengan miniflare

---

## Validasi Sprint 1A (Exit Criteria)

```bash
# Migrate + seed
pnpm db:migrate
pnpm db:seed:core

# Cek count
psql $DATABASE_URL -c "SELECT count(*) FROM companies WHERE deleted_at IS NULL;"  # → 1
psql $DATABASE_URL -c "SELECT count(*) FROM brands WHERE deleted_at IS NULL;"      # → 6
psql $DATABASE_URL -c "SELECT count(*) FROM outlets WHERE deleted_at IS NULL;"     # → 2

# Test endpoint
curl localhost:8787/api/v1/companies      # → [{ "code": "EGG", ... }]
curl "localhost:8787/api/v1/brands?company_id=<EGG_ID>"  # → 6 brands
```

**Sign-off**: ERP Owner (Ilham).
