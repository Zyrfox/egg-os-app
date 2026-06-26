# EGG OS API Conventions

Status: canonical convention for new API work. When older documents
(`openapi.yaml`, `EGG_OS_API_SPEC_v0.2.md`, or buildable specs) conflict with
this file, use the implemented API convention in this file until those documents
are reconciled in a separate pass.

This document is derived from the current API code. It does not reconcile old
contracts and does not change any route.

## 1. Path Style

Action and domain-command endpoints use verb-style action paths:

- `POST /api/v1/inventory/stock-in`
- `POST /api/v1/inventory/stock-out`
- `POST /api/v1/inventory/waste`
- `POST /api/v1/inventory/opname`
- `POST /api/v1/inventory/transfers/:id/receive`

Rejected style for these commands:

- Do not collapse different stock actions into `POST /inventory/stock-movements`
  with a body `type`.
- Do not add a `/movements/*` prefix for these four existing stock commands.

Reason: each business action has its own permission, validation, service call,
and audit surface. The path should name the action directly.

Collection-style routes that already exist remain valid for resource CRUD and
list/detail surfaces:

- `GET /api/v1/users`
- `GET /api/v1/users/:id`
- `GET /api/v1/rbac/roles`
- `PATCH /api/v1/rbac/roles/:id`

## 2. State Transitions

State transitions are explicit verb endpoints, not generic status patches with a
body flag.

Examples:

- `POST /api/v1/users/:id/suspend`
- `POST /api/v1/users/:id/reactivate`
- `POST /api/v1/users/:id/archive`
- `POST /api/v1/users/:id/reset-password`
- `POST /api/v1/inventory/transfers/:id/receive`

Rejected style:

- `PATCH /users/:id` with `{ "status": "suspended" }` for lifecycle
  transitions.

Reason: each transition can carry different permissions, guards, side effects,
and audit semantics.

## 3. Base Version And Module Prefix

All application API routes live under `/api/v1`. The only public route outside
that version prefix is health:

- `GET /health`

Current mount registry:

| Router | Mount | Example |
|---|---|---|
| Core | `/api/v1` | `GET /api/v1/companies` |
| Auth | `/api/v1/auth` | `POST /api/v1/auth/login` |
| RBAC | `/api/v1/rbac` | `GET /api/v1/rbac/roles` |
| Users | `/api/v1/users` | `POST /api/v1/users/:id/suspend` |
| Inventory | `/api/v1/inventory` | `POST /api/v1/inventory/stock-in` |

Core is intentionally mounted at `/api/v1` for
`/companies`, `/brands`, `/outlets`, and `/departments`. Document this as the
current exception; do not silently move it under `/core`.

## 4. Auth And Permission Per Route

Protected routes use `authMiddleware`. Routes that need authorization use
`requirePermission(...)` per route.

Examples:

- `inventory.post('/stock-in', authMiddleware, requirePermission('inventory.stock_in'), ...)`
- `inventory.post('/transfers', authMiddleware, requirePermission('inventory.transfer_send'), ...)`
- `usersRouter.post('/:id/suspend', authMiddleware, requirePermission('users.suspend'), ...)`
- `rbac.post('/roles', authMiddleware, requirePermission('rbac.role_create', companyTarget), ...)`

Do not use a wildcard `use('*')` permission layer to hide route-level
permissions. The permission should be visible at the endpoint declaration.

Auth routes that create or refresh sessions are intentionally public:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/set-password`
- `POST /api/v1/auth/request-password-reset`
- `POST /api/v1/auth/reset-password`

## 5. Tenant And Actor Context

Tenant and actor identity come from auth context, not from request input.

Current service context pattern:

```ts
const auth = c.get('auth')
return {
  companyId: auth.companyId,
  actorUserId: auth.userId,
  access: c.get('access'),
  accessFilter: c.get('accessFilter'),
}
```

Examples:

- `POST /api/v1/inventory/stock-in` ignores client `company_id` and
  `created_by`; movement rows use the authenticated company and user.
- `POST /api/v1/inventory/transfers` ignores client `company_id` and `sent_by`.
- `POST /api/v1/inventory/transfers/:id/receive` ignores client `received_by`.

Rejected style:

- Accepting `company_id`, `created_by`, `sent_by`, or `received_by` from body or
  query as authority.

## 6. Response Envelope And Status Codes

All JSON responses use the shared envelope helpers.

Success:

```json
{
  "success": true,
  "data": {}
}
```

Success with pagination:

```json
{
  "success": true,
  "data": [],
  "meta": { "page": 1, "page_size": 50, "total": 0 }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "ERR_VALIDATION",
    "message": "Input tidak valid",
    "details": []
  }
}
```

Observed status code rules:

| Situation | Status | Example |
|---|---:|---|
| Read/list/detail success | 200 | `GET /api/v1/inventory/balances` |
| Create resource/assignment/transfer | 201 | `POST /api/v1/rbac/roles`, `POST /api/v1/inventory/transfers` |
| Action/mutation success | 200 | `POST /api/v1/users/:id/suspend`, `POST /api/v1/inventory/transfers/:id/receive` |
| Validation failure | 422 | Zod parse failure |
| Auth failure | 401 | missing/invalid/expired bearer token |
| Permission failure | 403 | missing required permission |
| Scope or tenant miss | 404 | record exists outside user scope |
| Duplicate/conflict | 409 | duplicate or used token |
| Rate limit/lockout | 429 | login lock |
| Uncaught internal error | 500 | global error handler |

## 7. Error Catalog Mapping

Use stable `ERR_*` codes from `apps/api/src/lib/errors.ts`. Do not invent
literal error strings inside routes.

Current mappings:

| Code | HTTP | Example usage |
|---|---:|---|
| `ERR_VALIDATION` | 422 | Zod request/query failure |
| `ERR_UNAUTHENTICATED` | 401 | missing/invalid bearer token |
| `ERR_FORBIDDEN` | 403 | `requirePermission` denied |
| `ERR_OUT_OF_SCOPE` | 404 | tenant/scope-hidden records in service/RBAC |
| `ERR_NOT_FOUND` | 404 | unavailable record where no scope leak applies |
| `ERR_DUPLICATE` | 409 | duplicate entity |
| `ERR_CONFLICT` | 409 | conflicting write |
| `ERR_INSUFFICIENT_STOCK` | 422 | stock-out/waste/transfer over balance |
| `ERR_ALREADY_RECEIVED` | 422 | double receive transfer |
| `ERR_INTERNAL` | 500 | uncaught infra/system error |
| `ERR_INVALID_CREDENTIALS` | 401 | login/change-password password mismatch |
| `ERR_USER_INACTIVE` | 403 | suspended/archived/freelance-expired login |
| `ERR_PASSWORD_CHANGE_REQUIRED` | 403 | first-login guard |
| `ERR_TOKEN_EXPIRED` | 401 | expired refresh/password token |
| `ERR_TOKEN_USED` | 409 | used one-time token |
| `ERR_LOGIN_LOCKED` | 429 | too many failed logins |

Security rule: out-of-scope and cross-tenant data returns 404 to avoid
enumeration. In current code this is implemented by services throwing
`ERR_OUT_OF_SCOPE` with status 404 and by RBAC scope checks returning 404.

## 8. Validation And Decimal Values

Request validation lives in `packages/validation` when schemas are shared across
modules. Some auth-only schemas are local to `apps/api/src/routes/auth.ts`.

Examples:

- Inventory uses `InventoryMovementReq`, `InventoryOpnameReq`,
  `InventoryTransferCreateReq`, `InventoryBalanceQuery`, and
  `InventoryMovementQuery`.
- Users uses `InviteUserReq`, `UpdateUserReq`, `AssignUserRoleReq`, and
  `ListUsersQuery`.
- RBAC uses `CreateRoleReq`, `UpdateRoleReq`, `SetRolePermissionsReq`,
  `AssignRoleReq`, and `CreateOverrideReq`.

Decimal quantity values are strings, not numbers:

```ts
const DecimalString = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, 'decimal string with max 6 fractional digits')
```

Examples:

- `qty: "2"` for `POST /api/v1/inventory/stock-in`
- `counted_qty: "0"` for `POST /api/v1/inventory/opname`

Rejected style:

- `qty: 2`
- `Number(qty)` or `parseFloat(qty)` in service logic

Reason: inventory quantities are stored as numeric decimal values and must avoid
floating point drift.

## 9. Pagination Pattern

Paginated routes use query params:

- `page`
- `page_size`

The response includes:

```json
{
  "meta": { "page": 1, "page_size": 50, "total": 3 }
}
```

Examples:

- `GET /api/v1/users?page=1&page_size=5`
- `GET /api/v1/inventory/balances?page=1&page_size=2`
- `GET /api/v1/inventory/movements?page=1&page_size=2`

Use `page_size` in the public API, not `pageSize`.

## 10. Permission Naming

Permission codes use lowercase two-part `module.action` format.

Examples:

- `inventory.read`
- `inventory.stock_in`
- `inventory.transfer_receive`
- `users.suspend`
- `rbac.role_assign`

RBAC validation enforces:

```ts
/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/
```

Use the plural module where the implemented module is plural, such as `users.*`.

## 11. Current Route Inventory

These are the implemented route surfaces that this convention file derives from.

Auth:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/me/permissions`
- `POST /api/v1/auth/set-password`
- `POST /api/v1/auth/request-password-reset`
- `POST /api/v1/auth/reset-password`
- `POST /api/v1/auth/change-password`

Core:

- `GET /api/v1/companies`
- `GET /api/v1/brands`
- `GET /api/v1/outlets`
- `GET /api/v1/departments`

RBAC:

- `GET /api/v1/rbac/roles`
- `POST /api/v1/rbac/roles`
- `GET /api/v1/rbac/roles/:id`
- `PATCH /api/v1/rbac/roles/:id`
- `DELETE /api/v1/rbac/roles/:id`
- `PUT /api/v1/rbac/roles/:id/permissions`
- `GET /api/v1/rbac/permissions`
- `POST /api/v1/rbac/users/:userId/roles`
- `GET /api/v1/rbac/users/:userId/roles`
- `DELETE /api/v1/rbac/users/:userId/roles/:assignmentId`
- `POST /api/v1/rbac/users/:userId/overrides`
- `DELETE /api/v1/rbac/users/:userId/overrides/:id`

Users:

- `GET /api/v1/users`
- `GET /api/v1/users/:id`
- `POST /api/v1/users`
- `PATCH /api/v1/users/:id`
- `POST /api/v1/users/:id/suspend`
- `POST /api/v1/users/:id/reactivate`
- `POST /api/v1/users/:id/archive`
- `POST /api/v1/users/:id/roles`
- `DELETE /api/v1/users/:id/roles/:assignmentId`
- `POST /api/v1/users/:id/reset-password`

Inventory:

- `GET /api/v1/inventory/balances`
- `GET /api/v1/inventory/movements`
- `POST /api/v1/inventory/stock-in`
- `POST /api/v1/inventory/stock-out`
- `POST /api/v1/inventory/waste`
- `POST /api/v1/inventory/opname`
- `POST /api/v1/inventory/transfers`
- `POST /api/v1/inventory/transfers/:id/receive`

Health:

- `GET /health`

## 12. Documentation Reconcile TODO

`openapi.yaml`, `EGG_OS_API_SPEC_v0.2.md`, and some buildable specs may still
describe older resource-style paths. Do not reconcile them in feature passes.
Run a dedicated documentation reconcile pass that updates those documents to
follow this convention and the current implementation.
