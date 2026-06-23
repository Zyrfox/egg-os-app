# Sprint 1D — RBAC (Roles, Permissions, Scope Guard) → **Gate Day 30**

> **Tujuan**: 12 starter role + permission catalog + scope-aware guard (company/brand/outlet/department/own/assigned). Default deny.
> **Estimasi**: Minggu 4.
> **Dependency**: Sprint 1C selesai (auth jalan, user object di context).
> **Output**: Backend permission guard enforce semua endpoint. Tidak ada bypass.
> **Gate**: Setelah ini selesai → **Day 30 Foundation Ready** check.

---

## Pre-requisite

- [ ] Sprint 1C done (`/auth/me` return user, middleware attach user ke context)

---

## Tasks

### Schema

- [ ] **SP1D-001** Buat schema `roles` (id, code unique, name, description, is_system bool, created_at) — DoD: schema ada
- [ ] **SP1D-002** Buat schema `permissions` (id, code unique [mis: `INV.stock_in`, `APR.approve`], module enum, action, description) — DoD: schema ada
- [ ] **SP1D-003** Buat schema `role_permissions` (role_id FK, permission_id FK, PK composite) — DoD: schema ada
- [ ] **SP1D-004** Buat enum `scope_type` (`global`, `company`, `brand`, `outlet`, `department`, `own`, `assigned`, `audit_view`) — DoD: enum ter-create
- [ ] **SP1D-005** Buat schema `user_roles` (id, user_id FK, role_id FK, scope_type, scope_id nullable [FK polymorphic], starts_at, ends_at nullable, granted_by FK users, created_at) — DoD: schema ada
- [ ] **SP1D-006** Buat schema `access_overrides` (id, user_id FK, permission_code, allow bool, reason, expires_at, created_by FK, created_at) — DoD: schema ada (temporary allow/deny)
- [ ] **SP1D-007** Generate + run migration — DoD: 5 tabel ada

### Permission Catalog (Seed)

- [ ] **SP1D-008** Buat file `packages/db/seeds/02-permissions.ts` dengan permission list — DoD: catalog file ada
- [ ] **SP1D-009** Seed AUTH permissions: `auth.login`, `auth.logout`, `auth.password_change` — DoD: 3 row
- [ ] **SP1D-010** Seed USER permissions: `user.read`, `user.create`, `user.update`, `user.suspend`, `user.archive` — DoD: 5 row
- [ ] **SP1D-011** Seed RBAC permissions: `rbac.role_assign`, `rbac.role_revoke`, `rbac.override_grant` — DoD: 3 row
- [ ] **SP1D-012** Seed CORE permissions: `core.company_read`, `core.brand_read`, `core.outlet_read`, `core.department_read`, `core.company_manage`, `core.brand_manage`, `core.outlet_manage`, `core.department_manage` — DoD: 8 row
- [ ] **SP1D-013** Seed MDM permissions: `mdm.item_read`, `mdm.item_create`, `mdm.item_update`, `mdm.alias_create`, `mdm.request_submit`, `mdm.request_approve` — DoD: 6 row
- [ ] **SP1D-014** Seed INV permissions: `inv.stock_read`, `inv.movement_create`, `inv.movement_validate`, `inv.opname_create`, `inv.opname_finalize`, `inv.waste_create`, `inv.emergency_create`, `inv.emergency_approve` — DoD: 8 row
- [ ] **SP1D-015** Seed ODR permissions: `odr.report_read`, `odr.report_create`, `odr.report_submit`, `odr.report_validate`, `odr.report_finalize`, `odr.template_manage`, `odr.issue_create`, `odr.issue_resolve` — DoD: 8 row
- [ ] **SP1D-016** Seed APR permissions: `apr.request_create`, `apr.request_read`, `apr.decide`, `apr.rule_manage` — DoD: 4 row
- [ ] **SP1D-017** Seed EVD permissions: `evd.upload`, `evd.download`, `evd.delete`, `evd.access_log_read` — DoD: 4 row
- [ ] **SP1D-018** Seed AUD permissions: `aud.log_read`, `aud.flag_review`, `aud.export` — DoD: 3 row
- [ ] **SP1D-019** Seed EXP permissions: `exp.create`, `exp.read_sensitive`, `exp.archive_manage` — DoD: 3 row
- [ ] **SP1D-020** Seed DSH permissions: `dsh.read_executive`, `dsh.read_operational`, `dsh.read_audit` — DoD: 3 row
- [ ] **SP1D-021** Seed COR permissions: `cor.request_create`, `cor.request_approve`, `cor.apply` — DoD: 3 row

### Role Catalog (Seed)

- [ ] **SP1D-022** Seed role `SUPER_ADMIN` — semua permission, scope=global — DoD: row ada di roles + role_permissions
- [ ] **SP1D-023** Seed role `ERP_OWNER` — semua kecuali super-only, scope=company — DoD: role + mapping
- [ ] **SP1D-024** Seed role `DIREKSI` — read all + approve high-risk + audit access, scope=company — DoD: role + mapping
- [ ] **SP1D-025** Seed role `AUDITOR` — AUD.*, read INV/ODR/APR, no mutation, scope=audit_view — DoD: role + mapping
- [ ] **SP1D-026** Seed role `MANAGER_INVENTORY` — INV.*, MDM.read, APR.decide (medium), scope=brand — DoD: role + mapping
- [ ] **SP1D-027** Seed role `MANAGER_FNB` — ODR.*, INV.read, APR.decide (medium), scope=brand — DoD: role + mapping
- [ ] **SP1D-028** Seed role `MANAGER_OPS` — ODR.*, APR.decide, dashboard ops, scope=brand — DoD: role + mapping
- [ ] **SP1D-029** Seed role `SPV_OUTLET` — INV.movement.validate, ODR.report.validate, scope=outlet — DoD: role + mapping
- [ ] **SP1D-030** Seed role `STAFF` — ODR.report.create/submit, INV.movement.create, EVD.upload, MDM.request.submit, scope=outlet — DoD: role + mapping
- [ ] **SP1D-031** Seed role `FREELANCE` — limited STAFF subset, scope=assigned — DoD: role + mapping
- [ ] **SP1D-032** Seed role `SYSTEM` — internal jobs (export, scheduler), scope=company, no UI access — DoD: role + mapping

### Permission Resolver

- [ ] **SP1D-033** Service `resolveUserPermissions(userId)` — gabungkan permissions dari semua user_roles (active, not expired) + apply access_overrides — DoD: return `Permission[]` dengan scope info
- [ ] **SP1D-034** Service `hasPermission(user, permissionCode, scopeContext)` — cek user punya permission + scope match — DoD: unit test dengan berbagai scope
- [ ] **SP1D-035** Cache permission resolution per request (Hono context) — DoD: tidak query DB berkali-kali per request
- [ ] **SP1D-036** Implement scope match logic:
  - `company` match jika user scope=company
  - `brand` match jika user scope=brand AND brand_id sama, ATAU scope=company
  - `outlet` match jika scope=outlet AND outlet_id sama, ATAU scope=brand AND brand match, ATAU company
  - `department` match similar cascade
  - `own` match jika resource.owner_id == user.id
  - `assigned` match jika user in resource.assignees
  — DoD: unit test cover all combinations

### Guard Middleware

- [ ] **SP1D-037** Middleware factory `requirePermission(code)` — pakai di route — DoD: 403 jika tidak punya
- [ ] **SP1D-038** Middleware factory `requirePermissionWithScope(code, scopeExtractor)` — extract scope dari request (mis: outlet_id dari path param) lalu check — DoD: 403 jika scope mismatch
- [ ] **SP1D-039** Default 403 response dengan code `forbidden` (jangan leak permission code) — DoD: response konsisten
- [ ] **SP1D-040** Apply guard ke semua endpoint USERS/CORE existing (Sprint 1A/1B) — DoD: tanpa token/permission → 401/403

### Role Assignment Endpoints

- [ ] **SP1D-041** Endpoint `POST /api/v1/users/:id/roles` — assign role dengan scope — DoD: `requirePermission('rbac.role_assign')`, validate scope_id exists
- [ ] **SP1D-042** Endpoint `DELETE /api/v1/users/:id/roles/:roleId` — revoke (set `ends_at=now`) — DoD: protected
- [ ] **SP1D-043** Endpoint `GET /api/v1/users/:id/roles` — list user's roles + scopes — DoD: protected
- [ ] **SP1D-044** Endpoint `GET /api/v1/roles` — list roles catalog — DoD: protected, read-only
- [ ] **SP1D-045** Endpoint `GET /api/v1/permissions` — list permission catalog — DoD: protected
- [ ] **SP1D-046** Endpoint `GET /api/v1/auth/me/permissions` — return current user's resolved permissions — DoD: FE bisa pakai untuk menu guard

### Access Override

- [ ] **SP1D-047** Endpoint `POST /api/v1/users/:id/access-overrides` — temp allow/deny — DoD: butuh `RBAC.override_grant`, expires_at mandatory
- [ ] **SP1D-048** Endpoint `GET /api/v1/users/:id/access-overrides` — list active — DoD: filter expired

### JWT Update

- [ ] **SP1D-049** Update `signAccessToken` — include `roles` (code array) dan `scope` summary di JWT claim — DoD: token decode shows roles
- [ ] **SP1D-050** Update `authMiddleware` — attach resolved permissions ke context — DoD: downstream middleware/handler bisa pakai

### Audit

- [ ] **SP1D-051** Audit log untuk role assign/revoke/override (action codes: `RBAC.role_granted`, `RBAC.role_revoked`, `RBAC.override_created`) — DoD: event ter-log (via stub Sprint 1B-023, real di Sprint 5)

### FE Permission Hook

- [ ] **SP1D-052** Hook `useCan(permissionCode, scopeContext?)` di `apps/web` — fetch `/auth/me/permissions`, return boolean — DoD: menu sidebar conditional render
- [ ] **SP1D-053** Wrapper component `<Can permission="..." scope={...}>` — DoD: render children conditionally

### Tests

- [ ] **SP1D-054** Unit test: scope match cascade (outlet user akses outlet sendiri OK, outlet lain 403) — DoD: pass
- [ ] **SP1D-055** Integration test: STAFF tidak bisa POST `/users` (403) — DoD: pass
- [ ] **SP1D-056** Integration test: ERP_OWNER bisa assign role — DoD: pass
- [ ] **SP1D-057** Integration test: expired access_override tidak dipakai — DoD: pass

---

## Validasi Sprint 1D (Exit Criteria)

```bash
# Seed permissions & roles
pnpm db:seed:permissions
pnpm db:seed:roles

# Assign ERP_OWNER ke Ilham
curl -X POST localhost:8787/api/v1/users/<ILHAM_ID>/roles \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>" \
  -d '{ "role_code": "ERP_OWNER", "scope_type": "company", "scope_id": "<EGG_ID>" }'

# Ilham login → cek permissions
curl localhost:8787/api/v1/auth/me/permissions -H "Authorization: Bearer <ILHAM_TOKEN>"
# → array of permissions

# Ilham coba akses USER endpoint (should work)
curl localhost:8787/api/v1/users -H "Authorization: Bearer <ILHAM_TOKEN>"
# → 200

# STAFF coba akses (should 403)
curl localhost:8787/api/v1/users -H "Authorization: Bearer <STAFF_TOKEN>"
# → 403
```

---

## 🚦 Gate Day 30 — Foundation Ready Checklist

Sebelum lanjut Sprint 2, pastikan SEMUA pass:

- [ ] Login works (Sprint 1C)
- [ ] Role assignment works (Sprint 1D)
- [ ] Permission guard active backend (bukan frontend-only)
- [ ] Audit log stub jalan (real di Sprint 5)
- [ ] BTMK + BTMF seed available
- [ ] No critical auth bug (test list dari UAT Part 2 — AUTH/RBAC subset bisa pass)
- [ ] Lint + typecheck + test hijau di CI
- [ ] Staging deploy berhasil (smoke test login + role assign jalan di staging)

**Sign-off Day 30**: Technical Owner + ERP Owner + Auditor.
