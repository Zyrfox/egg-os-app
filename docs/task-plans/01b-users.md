# Sprint 1B — USERS (CRUD + Status Enum)

> **Tujuan**: User entity siap (CRUD, status lifecycle, account type). Belum termasuk login — itu Sprint 1C.
> **Estimasi**: Minggu 2-3.
> **Dependency**: Sprint 1A selesai (butuh company/brand/outlet untuk scope).
> **Output**: User CRUD endpoint jalan. ERP Owner bisa create user manual via API.

---

## Pre-requisite

- [ ] Sprint 1A done (companies/brands/outlets/departments ter-seed)

---

## Tasks

### Schema (Drizzle)

- [ ] **SP1B-001** Buat enum `user_status` (`invited`, `active`, `suspended`, `archived`) — DoD: enum ter-create di DB
- [ ] **SP1B-002** Buat enum `account_type` (`internal`, `freelance`, `system`) — DoD: enum ter-create
- [ ] **SP1B-003** Buat schema `users` (id, email unique, full_name, status, account_type, company_id FK, password_hash nullable, password_set_at nullable, must_change_password bool, last_login_at, soft_delete fields, audit fields `created_by`/`updated_by`) — DoD: schema file ada
- [ ] **SP1B-004** Index `users(email)` unique partial (where deleted_at IS NULL) — DoD: tidak bisa create dua user email sama (kecuali yang sudah soft-deleted)
- [ ] **SP1B-005** Generate + run migration — DoD: tabel users ada di Postgres

### Service Layer

- [ ] **SP1B-006** Service `createUser(input)` — validate email format, set status=`invited`, password_hash=null — DoD: return user object tanpa password_hash
- [ ] **SP1B-007** Service `listUsers(filter)` — filter by status/company/account_type/search, paginate — DoD: return paginated result `{ data, total, page, pageSize }`
- [ ] **SP1B-008** Service `getUserById(id)` — return user atau null — DoD: hanya non-deleted
- [ ] **SP1B-009** Service `updateUser(id, input)` — patch field allowed (full_name, status, account_type), not email/password — DoD: audit field `updated_by` ter-set
- [ ] **SP1B-010** Service `setUserStatus(id, status, reason)` — transition active↔suspended↔archived dengan rule — DoD: invalid transition throw error
- [ ] **SP1B-011** Service `softDeleteUser(id, reason)` — set `deleted_at`, status=archived — DoD: user tidak muncul di listUsers

### API Endpoints

- [ ] **SP1B-012** Endpoint `POST /api/v1/users` — create user — DoD: Zod validate, 201 dengan body
- [ ] **SP1B-013** Endpoint `GET /api/v1/users` — list with filter & pagination — DoD: return paginated
- [ ] **SP1B-014** Endpoint `GET /api/v1/users/:id` — get user — DoD: 404 jika tidak ada
- [ ] **SP1B-015** Endpoint `PATCH /api/v1/users/:id` — update user — DoD: partial update jalan
- [ ] **SP1B-016** Endpoint `PATCH /api/v1/users/:id/status` — change status with reason — DoD: invalid transition 422
- [ ] **SP1B-017** Endpoint `DELETE /api/v1/users/:id` — soft delete — DoD: subsequent GET return 404

### Zod Schemas (Shared)

- [ ] **SP1B-018** Zod schema `CreateUserInput`, `UpdateUserInput`, `UserStatusChangeInput` di `packages/validation/src/user.ts` — DoD: importable from FE & BE
- [ ] **SP1B-019** Type `User`, `UserStatus`, `AccountType` di `packages/validation/src/user.ts` — DoD: ter-export

### Tests

- [ ] **SP1B-020** Unit test: createUser dengan email duplikat → reject — DoD: test pass
- [ ] **SP1B-021** Unit test: status transition invalid (archived → active) → reject — DoD: test pass
- [ ] **SP1B-022** Integration test: `POST /users` + `GET /users` round-trip — DoD: test pass

### Audit Stub

- [ ] **SP1B-023** Tambahkan stub `auditLog(action, entity, entityId, actorId, details)` di service layer — DoD: console log dulu, real audit di Sprint 5

---

## Validasi Sprint 1B (Exit Criteria)

```bash
# Create user
curl -X POST localhost:8787/api/v1/users \
  -H "content-type: application/json" \
  -d '{ "email": "ilham@egg.id", "full_name": "Ilham", "account_type": "internal", "company_id": "<EGG_ID>" }'
# → 201, status="invited"

# List users
curl "localhost:8787/api/v1/users?status=invited&page=1&pageSize=20"
# → { data: [...], total: 1 }

# Update status
curl -X PATCH localhost:8787/api/v1/users/<id>/status \
  -d '{ "status": "active", "reason": "approved" }'
# → 200

# Soft delete
curl -X DELETE localhost:8787/api/v1/users/<id>
# → 204; GET /users/<id> → 404
```

**Sign-off**: ERP Owner (Ilham).
