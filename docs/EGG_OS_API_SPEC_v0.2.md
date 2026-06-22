# EGG OS API SPEC v0.2

**Version:** v0.2  
**Status:** Draft for Review  
**Technical Baseline:** Cloudflare-Native TanStack Stack  
Endpoint behavior remains API-first. Runtime baseline updated to Cloudflare Workers + Hono.

> **v0.2 Stack Baseline**  
> Dokumen ini sudah diperbarui ke arah **Cloudflare-Native TanStack Stack**: React + Vite, TanStack Router, TanStack Query, TanStack Table, TanStack Form, Cloudflare Pages, Cloudflare Workers, Hono, PostgreSQL via Cloudflare Hyperdrive, Drizzle ORM, Cloudflare R2, Cloudflare Queues, dan Wrangler.  
>  
> Seluruh referensi lama ke Next.js/Vercel/Node server/VPS-first/PM2/Prisma-first diganti atau dianggap deprecated untuk baseline v0.2.

## v0.2 Technical Revision Summary

| Area | v0.1 Direction | v0.2 Direction |
|---|---|---|
| Frontend | Next.js / React optional | React + Vite |
| Frontend App Layer | Framework default routing | TanStack Router + Query + Table + Form |
| Hosting | Vercel / VPS optional | Cloudflare Pages |
| Backend Runtime | Node server / NestJS / Express optional | Cloudflare Workers |
| API Framework | Express/Fastify/Nest optional | Hono |
| Database | PostgreSQL | PostgreSQL via Cloudflare Hyperdrive |
| ORM | Prisma-first | Drizzle ORM |
| Evidence Storage | S3/Supabase optional | Cloudflare R2 |
| Background Job | Redis/BullMQ optional | Cloudflare Queues |
| Deployment | PM2/Vercel/VPS flow | Wrangler + Cloudflare Pages |
| Observability | Server logs/provider logs | Cloudflare Observability + optional Sentry |

---

EGG OS

API Specification / OpenAPI Design

v0.2

| Field | Value |
| --- | --- |
| Document Type | API Specification |
| System | EGG OS - Easy Going Group Operating System |
| Version | 0.2 |
| Prepared For | EGG / Easy Going Group |
| Primary Owner | Ilham Juniansyah - ERP Owner / System Custodian (recommended) |
| Pilot Scope | BTMK + BTMF first, TSF second, Healthopia later |
| Compiled Date | 2026-06-11 |

Confidential - Internal Planning Document

# 1. Executive Summary

Dokumen ini meng-compile API Specification EGG OS v0.2 dari seluruh part API yang sudah dirancang. Fokus utama sistem adalah menjadi operational source of truth dan control layer untuk multi-outlet EGG, khususnya pilot BTMK + BTMF.

Pawoon tetap menjadi POS; EGG OS menjadi validation, reporting, approval, audit, dan control layer.

Data final tidak boleh diedit langsung; koreksi harus melalui Correction Request.

Semua mutasi penting wajib melewati backend RBAC + scope + audit trail.

Evidence, approval, audit, export, dan dashboard dibuat sebagai module sentral yang dipakai module lain.

MVP diprioritaskan untuk mengurangi kebocoran operasional, selisih stok, human error, dan chaos manual report.

| Decision Area | Final Decision |
| --- | --- |
| API Style | REST JSON API |
| Base Prefix | /api/v1 |
| Authentication | Bearer JWT access token + refresh token |
| Authorization | RBAC + scope company/brand/outlet/department/own/assigned |
| Pagination | Cursor-based pagination |
| File Storage | Private object storage + signed URL |
| Audit | Mandatory for mutations, exports, sensitive actions |
| Pilot | BTMK + BTMF first; TSF second; Healthopia later |

# 2. Document Map

| Part | Section |
| --- | --- |
| 1 | Executive Summary |
| 2 | API Standard |
| 3 | Module Catalog |
| 4 | AUTH |
| 5 | Users & RBAC |
| 6 | CORE + MDM |
| 7 | Inventory |
| 8 | Operational Daily Report |
| 9 | Approval |
| 10 | Evidence |
| 11 | Audit |
| 12 | Export |
| 13 | Dashboard |
| 14 | Procurement |
| 15 | Complaint |
| 16 | Void/Refund Reference |
| 17 | Automation |
| 18 | Correction |
| 19 | System Admin |
| 20 | Integration |
| 21 | Appendix |

# 3. API Standard

| Standard | Value |
| --- | --- |
| Base URL - Local | http://localhost:8787/api/v1 |
| Base URL - Staging | https://staging-api.egg-os.local/api/v1 |
| Base URL - Production | https://api.egg-os.local/api/v1 |
| Request Format | JSON by default; multipart/form-data for file upload |
| Response Format | Standard success/error envelope |
| Time Zone | Asia/Jakarta |
| Date Format | ISO 8601 / RFC3339 for datetime |
| ID Format | UUID recommended |
| Naming | snake_case for JSON fields and database columns |

## 3.1 Authentication

Access token: JWT, short-lived, recommended 15-60 minutes.

Refresh token: secure token, stored hashed, revocable, recommended HTTP-only cookie.

Password setup: first login / set password link via hashed one-time token.

Backend must check active user, role, permission, and scope on every protected endpoint.

{
  "sub": "user_uuid",
  "company_id": "company_uuid",
  "email": "user@example.com",
  "full_name": "User Name",
  "role_codes": ["ERP_OWNER"],
  "scope": {"outlet_ids": ["uuid"]},
  "iat": 1780000000,
  "exp": 1780003600
}

## 3.2 Standard Response

Success:
{
  "success": true,
  "data": {},
  "meta": {"request_id": "req_123"}
}

Error:
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Data tidak valid.",
    "details": [{"field": "quantity", "message": "Quantity harus lebih dari 0."}],
    "request_id": "req_123"
  }
}

| HTTP Status | Usage |
| --- | --- |
| 200 | Success |
| 201 | Created |
| 202 | Accepted/queued |
| 204 | No content |
| 400 | Bad request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not found |
| 409 | Conflict / invalid state / business rule |
| 422 | Validation error |
| 429 | Rate limited |
| 500 | Internal error |

# 4. Module Catalog

| Code | Module | Priority | Description |
| --- | --- | --- | --- |
| AUTH | Authentication | P0 | Login, logout, token, password, first login |
| RBAC | Role & Permission | P0 | Role, permission, user access, scope |
| CORE | Core Organization | P0 | Company, brand, outlet, department |
| MDM | Master Data Management | P0 | Item, alias, unit, category, vendor |
| INV | Inventory | P0 | Stock, movement, opname, waste, transfer |
| ODR | Operational Daily Report | P0 | Opening, closing, issue report |
| APR | Approval | P0 | Approval request, decision, rule |
| EVD | Evidence | P0 | Upload file, proof, signed URL |
| AUD | Audit | P0 | Audit log, flag, review note |
| EXP | Export | P0 | XLSX/PDF export jobs |
| DSH | Dashboard | P0 | Overview, widget, alert, metric |
| COR | Correction Request | P0/P1 | Correction flow for locked/final records |
| PRC | Procurement | P1-ready | Purchase request, receipt, stock-in |
| CMP | Complaint | P1-ready | Customer complaint management |
| VDR | Void/Refund Reference | P1-ready | Pawoon void/refund control |
| AUT | Automation / n8n | P1 | Workflow, notification, queue |
| INT | Integration | P1 | Pawoon, import, sync, external systems |
| SYS | System Admin | P0/P1 | Settings, feature flags, health |

# AUTH - Authentication API

| Field | Value |
| --- | --- |
| Module Code | AUTH |
| Priority | P0 |
| Purpose | Mengelola login, logout, token refresh, current user, permission, password reset, first password setup, dan auth events. |
| Core Principle | Credential tidak boleh disimpan atau dikirim raw; password/token hanya disimpan dalam bentuk hash. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Authentication | /auth |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | /auth/login | Login email + password |
| POST | /auth/logout | Logout and revoke refresh token |
| POST | /auth/refresh | Refresh access token |
| GET | /auth/me | Get current user profile |
| GET | /auth/me/permissions | Get current user permissions |
| POST | /auth/request-password-reset | Request password reset link |
| POST | /auth/reset-password | Reset password with token |
| POST | /auth/set-password | First-time password setup |
| POST | /auth/change-password | Change own password |

## Status / Type Standards

### User Status

| Value | Meaning |
| --- | --- |
| active | Can login |
| inactive | Cannot login |
| suspended | Blocked |
| archived | Historical only |

## Core Object Standards

### Login Response

{
  "access_token": "jwt",
  "token_type": "Bearer",
  "expires_in": 3600,
  "user": {"id": "uuid", "email": "user@example.com", "full_name": "User"}
}

## Business Rules

| Rule | Requirement |
| --- | --- |
| Password hashed only | Mandatory |
| Refresh token stored hashed | Mandatory |
| Inactive/suspended user cannot login | Mandatory |
| Auth events logged | Mandatory |
| First login set-password flow | Supported |

## Permission Summary

| Permission | Description |
| --- | --- |
| AUTH.session.login | Login |
| AUTH.session.logout | Logout |
| AUTH.session.refresh | Refresh token |
| AUTH.me.read | View own profile |
| AUTH.permission.read | View own permission |
| AUTH.password.change | Change password |
| AUTH.password.reset_request | Request reset password |
| AUTH.password.reset | Reset password |
| AUTH.password.set | Set first password |

## Key Events

| Event | Trigger |
| --- | --- |
| auth.user.created | User created |
| auth.user.invited | Invitation sent |
| auth.login.success | Login success |
| auth.login.failed | Login failed |
| auth.password.changed | Password changed |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Login valid credential | Access token returned |
| Login suspended user | Rejected |
| Reset password token expired | Rejected |
| First login set password | Password created and token invalidated |

# RBAC - Users & Role-Based Access Control API

| Field | Value |
| --- | --- |
| Module Code | RBAC |
| Priority | P0 |
| Purpose | Mengelola user, role, permission, user-role assignment, scope, dan access override. |
| Core Principle | Default deny. Semua authorization wajib dicek backend, bukan hanya hide menu frontend. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Users | /users |
| Roles | /roles |
| Permissions | /permissions |
| RBAC | /rbac |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /users | List users |
| POST | /users | Create user |
| GET | /users/{id} | Get user detail |
| PATCH | /users/{id} | Update user |
| PATCH | /users/{id}/status | Update user status |
| POST | /users/{id}/send-invitation | Send invitation |
| GET | /users/{id}/roles | List user roles |
| POST | /users/{id}/roles | Assign role |
| DELETE | /users/{id}/roles/{user_role_id} | Remove user role |
| GET | /roles | List roles |
| POST | /roles | Create role |
| GET | /roles/{id}/permissions | List role permissions |
| PUT | /roles/{id}/permissions | Replace role permissions |
| GET | /permissions | List permissions |
| GET | /rbac/access-overrides | List overrides |
| POST | /rbac/access-overrides | Create override |

## Status / Type Standards

### Scope Types

| Value | Meaning |
| --- | --- |
| company | Company-wide |
| brand | Brand scope |
| outlet | Outlet scope |
| department | Department scope |
| own | Own records |
| assigned | Assigned records |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Default deny | Mandatory |
| Multiple roles per user | Supported |
| Access override has expiry | Recommended |
| System roles restricted | Mandatory |
| Permission list read-only seed | Recommended |
| No self-approval enforced by APR | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| AUTH.user.read | View users |
| AUTH.user.create | Create user |
| AUTH.user.update | Update user |
| AUTH.user.status.update | Update user status |
| RBAC.role.read | View roles |
| RBAC.role.create | Create role |
| RBAC.role.update | Update role |
| RBAC.permission.read | View permissions |
| RBAC.role_permission.update | Update role permissions |
| RBAC.user_role.assign | Assign user role |
| RBAC.user_role.remove | Remove user role |
| RBAC.access_override.create | Create override |

## Key Events

| Event | Trigger |
| --- | --- |
| rbac.role.created | Role created |
| rbac.permission.updated | Role permission updated |
| rbac.user_role.assigned | Role assigned |
| rbac.access_override.created | Override created |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Staff attempts system settings access | 403 |
| Manager views own outlet records | Allowed |
| User role assigned | Permission reflected after cache refresh |

# CORE + MDM - Core Organization & Master Data API

| Field | Value |
| --- | --- |
| Module Code | CORE + MDM |
| Priority | P0 |
| Purpose | Mengelola struktur organisasi dan master data resmi: company, brand, outlet, department, storage, category, unit, item, alias, vendor, master data request. |
| Core Principle | Transaksi tidak boleh membuat master item sembarangan. Item harus pakai standard name dan alias resmi. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Company | /companies |
| Brand | /brands |
| Outlet | /outlets |
| Department | /departments |
| Master Data | /master-data |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /companies | List companies |
| GET | /brands | List brands |
| POST | /brands | Create brand |
| GET | /outlets | List outlets |
| POST | /outlets | Create outlet |
| GET | /departments | List departments |
| GET | /master-data/storage-locations | List storage locations |
| POST | /master-data/storage-locations | Create storage |
| GET | /master-data/categories | List categories |
| GET | /master-data/units | List units |
| GET | /master-data/items | List items |
| POST | /master-data/items | Create item |
| GET | /master-data/lookup/items | Lookup item by standard/alias |
| POST | /master-data/item-aliases | Create item alias |
| GET | /master-data/vendors | List vendors |
| POST | /master-data/requests | Create master data request |
| PATCH | /master-data/requests/{id}/review | Review master request |

## Status / Type Standards

### Master Status

| Value | Meaning |
| --- | --- |
| active | Usable in new transaction |
| inactive | Not usable in new transaction |
| archived | Historical only |

### Master Request Status

| Value | Meaning |
| --- | --- |
| submitted | Waiting review |
| approved | Applied |
| rejected | Rejected |
| revision_requested | Need revision |

## Core Object Standards

### Item Lookup Response

{
  "query": "Telor Kitchen",
  "matched_by": "alias",
  "item": {"id": "uuid", "standard_name": "Telur", "unit_code": "pcs"}
}

## Business Rules

| Rule | Requirement |
| --- | --- |
| Alias unique per company | Mandatory |
| Staff cannot create item master directly | Mandatory |
| Duplicate normalized name prevented | Mandatory |
| Inactive master blocked for new transactions | Mandatory |
| Alias examples | Telor/Telur Kitchen -> Telur; Saos -> Saus; Tepunh Dkriuk -> Tepung Dkriuk |

## Permission Summary

| Permission | Description |
| --- | --- |
| CORE.company.read | View company |
| CORE.brand.read | View brand |
| CORE.outlet.read | View outlet |
| CORE.department.read | View department |
| MDM.item.read | View item |
| MDM.item.lookup | Lookup item |
| MDM.item.create | Create item |
| MDM.item.update | Update item |
| MDM.item_alias.create | Create alias |
| MDM.vendor.read | View vendor |
| MDM.vendor.create | Create vendor |
| MDM.master_request.create | Create master request |
| MDM.master_request.review | Review master request |

## Key Events

| Event | Trigger |
| --- | --- |
| mdm.item.created | Item created |
| mdm.item_alias.created | Alias created |
| mdm.master_request.created | Master request created |
| mdm.master_request.approved | Master request approved |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Search Telor | Returns Telur |
| Search Tepunh Dkriuk | Returns Tepung Dkriuk |
| Staff create item directly | 403 |
| Duplicate alias created | Rejected |

# INV - Inventory API

| Field | Value |
| --- | --- |
| Module Code | INV |
| Priority | P0 |
| Purpose | Mengelola current stock, stock movement, stock opname, waste/reject, emergency use, transfer, dan inventory reports. |
| Core Principle | Stock movement adalah source of truth. Current stock hanya cache/read model. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Current Stocks | /inventory/current-stocks |
| Stock Movements | /inventory/stock-movements |
| Stock Opnames | /inventory/stock-opnames |
| Waste Records | /inventory/waste-records |
| Emergency Use | /inventory/emergency-use |
| Transfers | /inventory/transfers |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /inventory/current-stocks | List current stock |
| GET | /inventory/stock-movements | List stock movements |
| POST | /inventory/stock-movements | Create stock movement |
| PATCH | /inventory/stock-movements/{id}/submit | Submit movement |
| PATCH | /inventory/stock-movements/{id}/validate | Validate movement |
| GET | /inventory/stock-opnames | List stock opnames |
| POST | /inventory/stock-opnames | Create stock opname |
| PATCH | /inventory/stock-opnames/{id}/submit | Submit opname |
| PATCH | /inventory/stock-opnames/{id}/validate | Validate opname |
| PATCH | /inventory/stock-opnames/{id}/finalize | Finalize opname |
| POST | /inventory/waste-records | Create waste/reject |
| POST | /inventory/emergency-use | Create emergency use |
| POST | /inventory/transfers | Create transfer |
| PATCH | /inventory/transfers/{id}/receive | Receive transfer |

## Status / Type Standards

### Movement Types

| Value | Meaning |
| --- | --- |
| stock_in | Stock masuk |
| stock_out | Stock keluar |
| adjustment_in | Adjustment masuk |
| adjustment_out | Adjustment keluar |
| waste | Waste |
| reject | Reject |
| transfer_out | Transfer keluar |
| transfer_in | Transfer masuk |
| opname_adjustment | Adjustment opname |
| purchase_receipt | Stock-in from purchase |

### Movement Status

| Value | Meaning |
| --- | --- |
| draft | Draft |
| submitted | Submitted |
| pending_validation | Waiting validation |
| validated | Validated |
| final | Final |
| rejected | Rejected |
| cancelled | Cancelled |

## Core Object Standards

### Stock Movement Example

{
  "movement_code": "MOV-20260610-0001",
  "movement_type": "stock_out",
  "item_id": "uuid",
  "quantity": 10,
  "unit_id": "uuid",
  "storage_location_id": "uuid",
  "status": "draft"
}

## Business Rules

| Rule | Requirement |
| --- | --- |
| Negative stock blocked | Mandatory |
| Stock before use enforced | Mandatory |
| Final movement locked | Mandatory |
| Opname final creates adjustment movement | Mandatory |
| Emergency use needs reason/evidence | Mandatory |
| All changes audited | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| INV.current_stock.read | View current stock |
| INV.stock_movement.create | Create movement |
| INV.stock_movement.validate | Validate movement |
| INV.stock_opname.create | Create opname |
| INV.stock_opname.finalize | Finalize opname |
| INV.waste_record.create | Create waste/reject |
| INV.emergency_use.create | Create emergency use |
| INV.transfer.receive | Receive transfer |
| INV.report.export | Export inventory report |

## Key Events

| Event | Trigger |
| --- | --- |
| inv.stock_movement.validated | Movement validated |
| inv.stock_opname.finalized | Opname finalized |
| inv.stock.critical | Stock critical |
| inv.stock.out_of_stock | Stock zero |
| inv.discrepancy.high | High discrepancy |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Create stock-out with insufficient stock | Rejected |
| Finalize opname with discrepancy | Adjustment movement created |
| Emergency use without evidence | Rejected if required |
| Current stock viewed | Read-only result |

# ODR - Operational Daily Report API

| Field | Value |
| --- | --- |
| Module Code | ODR |
| Priority | P0 |
| Purpose | Mengelola opening/closing report, checklist template, issue report, validation, late/missing report, dan compliance. |
| Core Principle | Daily report resmi hanya data yang masuk EGG OS. WA/checklist manual bukan database utama. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Templates | /daily-reports/templates |
| Reports | /daily-reports |
| Issues | /daily-issues |
| Compliance | /daily-reports/compliance |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /daily-reports/templates | List templates |
| POST | /daily-reports/templates | Create template |
| GET | /daily-reports | List reports |
| POST | /daily-reports | Create report |
| PATCH | /daily-reports/{id}/submit | Submit report |
| PATCH | /daily-reports/{id}/validate | Validate/reject/revision |
| PATCH | /daily-reports/{id}/finalize | Finalize report |
| POST | /daily-reports/{id}/issues | Create issue from report |
| GET | /daily-issues | List issues |
| PATCH | /daily-issues/{id}/assign | Assign issue |
| PATCH | /daily-issues/{id}/resolve | Resolve issue |
| GET | /daily-reports/missing | List missing reports |

## Status / Type Standards

### Report Types

| Value | Meaning |
| --- | --- |
| opening | Opening |
| closing | Closing |
| shift_report | Shift report |
| daily_summary | Daily summary |
| incident | Incident |

### Report Status

| Value | Meaning |
| --- | --- |
| draft | Draft |
| submitted | Submitted |
| pending_validation | Waiting validation |
| validated | Validated |
| rejected | Rejected |
| revision_requested | Need revision |
| final | Final |
| cancelled | Cancelled |

### Issue Status

| Value | Meaning |
| --- | --- |
| open | Open |
| assigned | Assigned |
| in_progress | In progress |
| resolved | Resolved |
| closed | Closed |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Template required | Mandatory |
| Checklist snapshot created on report | Mandatory |
| Duplicate per outlet/date/type/shift blocked | Mandatory |
| Evidence required for critical items | Mandatory |
| Final report locked | Mandatory |
| Late/compliance calculated by backend | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| ODR.template.read | View template |
| ODR.daily_report.create | Create report |
| ODR.daily_report.validate | Validate report |
| ODR.issue.create | Create issue |
| ODR.issue.resolve | Resolve issue |
| ODR.compliance.read | View compliance |
| ODR.report.export | Export ODR |

## Key Events

| Event | Trigger |
| --- | --- |
| odr.daily_report.submitted | Report submitted |
| odr.daily_report.validated | Report validated |
| odr.daily_report.missing | Expected report missing |
| odr.issue.created | Issue created |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Closing report not submitted by deadline | Missing/late alert generated |
| Report submitted without required evidence | Rejected |
| Duplicate closing report | Conflict |
| SPV validates report | Status validated |

# APR - Approval API

| Field | Value |
| --- | --- |
| Module Code | APR |
| Priority | P0 |
| Purpose | Approval workflow sentral untuk inventory, ODR, procurement, complaint, VDR, correction, evidence override, export, dan master data. |
| Core Principle | Requester tidak boleh approve request sendiri. Approval steps wajib traceable. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Approvals | /approvals |
| Tasks | /approvals/my-tasks |
| Rules | /approvals/rules |
| Comments | /approvals/{id}/comments |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /approvals | List approvals |
| POST | /approvals | Create approval request |
| GET | /approvals/{id} | Get approval detail |
| PATCH | /approvals/{id}/submit | Submit approval |
| PATCH | /approvals/{id}/decide | Approve/reject/revision/escalate |
| PATCH | /approvals/{id}/cancel | Cancel approval |
| GET | /approvals/my-tasks | My approval tasks |
| GET | /approvals/{id}/history | Approval history |
| GET | /approvals/rules | List rules |
| POST | /approvals/rules | Create rule |

## Status / Type Standards

### Approval Status

| Value | Meaning |
| --- | --- |
| draft | Draft |
| submitted | Submitted |
| pending_approval | Waiting approval |
| approved | Approved |
| rejected | Rejected |
| revision_requested | Need revision |
| escalated | Escalated |
| cancelled | Cancelled |
| closed | Closed |

### Approval Levels

| Value | Meaning |
| --- | --- |
| L1 | SPV |
| L2 | Manager |
| L3 | Finance/Direktur terkait |
| L4 | Direksi |
| L5 | Direksi + Inspektorat |

## Business Rules

| Rule | Requirement |
| --- | --- |
| No self approval | Mandatory |
| Sequential approval MVP | Yes |
| Evidence required for high/critical | Mandatory |
| Duplicate active approval for same record blocked | Mandatory |
| Reject/revision notes required | Mandatory |
| Rule changes affect new requests only | Recommended |

## Permission Summary

| Permission | Description |
| --- | --- |
| APR.approval.read | View approval |
| APR.approval.create | Create approval |
| APR.approval.submit | Submit approval |
| APR.approval.decide | Decide approval |
| APR.approval.task.read | View my tasks |
| APR.rule.update | Update approval rules |
| APR.report.export | Export approval |

## Key Events

| Event | Trigger |
| --- | --- |
| apr.approval.created | Approval created |
| apr.approval.approved | Approved |
| apr.approval.rejected | Rejected |
| apr.approval.escalated | Escalated |
| apr.approval.overdue | Overdue |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Requester tries to approve own request | Blocked |
| High discrepancy creates approval | Approval request created |
| Reject without notes | Validation error |
| Pending approval overdue | Alert/reminder generated |

# EVD - Evidence API

| Field | Value |
| --- | --- |
| Module Code | EVD |
| Priority | P0 |
| Purpose | Mengelola file bukti yang terhubung ke record bisnis: upload, metadata, replacement, archive, signed download URL, validation requirement. |
| Core Principle | Database menyimpan metadata evidence; file asli berada di private object storage. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Evidence | /evidence |
| Upload | /evidence/upload |
| Download URL | /evidence/{id}/download-url |
| Requirements | /evidence/requirements |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /evidence | List evidence |
| POST | /evidence/upload | Upload evidence |
| GET | /evidence/{id} | Detail evidence |
| GET | /evidence/{id}/download-url | Generate signed URL |
| PATCH | /evidence/{id}/replace | Replace evidence |
| PATCH | /evidence/{id}/archive | Archive evidence |
| GET | /evidence/requirements | List requirements |
| POST | /evidence/validate-required | Validate required evidence |
| GET | /evidence/linked-records/{record_type}/{record_id} | Evidence by record |

## Status / Type Standards

### Evidence Status

| Value | Meaning |
| --- | --- |
| active | Active |
| replaced | Replaced |
| archived | Archived |
| locked | Locked |
| rejected | Rejected |

### Allowed File Types

| Value | Meaning |
| --- | --- |
| jpg/jpeg/png/webp | Image, max 5 MB |
| pdf | Document, max 10 MB |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Private storage | Mandatory |
| Signed URL short lived | Mandatory |
| Related record mandatory | Mandatory |
| High-risk evidence required | Mandatory |
| Final record locks evidence | Mandatory |
| Replace does not delete old file | Mandatory |
| Sensitive fields never exposed | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| EVD.evidence.read | View evidence |
| EVD.evidence.upload | Upload evidence |
| EVD.evidence.download | Download evidence |
| EVD.evidence.replace | Replace evidence |
| EVD.evidence.archive | Archive evidence |
| EVD.evidence.override_lock | Override locked evidence |
| EVD.requirement.validate | Validate requirement |
| EVD.report.export | Export evidence |

## Key Events

| Event | Trigger |
| --- | --- |
| evd.evidence.uploaded | Evidence uploaded |
| evd.evidence.replaced | Evidence replaced |
| evd.evidence.archived | Evidence archived |
| evd.evidence.locked | Evidence locked |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Upload valid JPG | Evidence created |
| Upload unsupported ZIP | Rejected |
| Download locked evidence with permission | Signed URL returned |
| Replace locked evidence without override | Rejected |

# AUD - Audit API

| Field | Value |
| --- | --- |
| Module Code | AUD |
| Priority | P0 |
| Purpose | Mengelola audit logs, audit details, flags, review notes, sensitive activity tracking, and audit summaries. |
| Core Principle | Audit log append-only. Normal user tidak boleh edit/delete audit log. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Audit Logs | /audit/logs |
| Audit Flags | /audit/flags |
| Summary | /audit/summary |
| Exports | /audit/export-history |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /audit/logs | List audit logs |
| GET | /audit/logs/{id} | Audit log detail |
| GET | /audit/logs/{id}/details | Old/new details |
| POST | /audit/logs/{id}/review-notes | Add review note |
| GET | /audit/flags | List audit flags |
| POST | /audit/flags | Create flag |
| PATCH | /audit/flags/{id}/review | Review flag |
| PATCH | /audit/flags/{id}/resolve | Resolve flag |
| PATCH | /audit/flags/{id}/dismiss | Dismiss flag |
| GET | /audit/summary | Audit summary |
| POST | /audit/export | Export audit |

## Status / Type Standards

### Audit Severity

| Value | Meaning |
| --- | --- |
| info | Info |
| low | Low |
| medium | Medium |
| high | High |
| critical | Critical |

### Audit Status

| Value | Meaning |
| --- | --- |
| success | Success |
| failed | Failed |
| denied | Access denied |
| partial | Partial |
| pending | Pending |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Append-only | Mandatory |
| Sensitive fields masked | Mandatory |
| Critical dismiss restricted | Mandatory |
| Audit export needs reason | Mandatory |
| Access denied sensitive action logged | Recommended |
| Audit log not directly corrected | Use review note only |

## Permission Summary

| Permission | Description |
| --- | --- |
| AUD.audit_log.read | View audit logs |
| AUD.audit_log.detail.read | View audit details |
| AUD.summary.read | View summary |
| AUD.review_note.create | Create review note |
| AUD.audit_flag.create | Create flag |
| AUD.audit_flag.resolve | Resolve flag |
| AUD.audit_log.export | Export audit log |

## Key Events

| Event | Trigger |
| --- | --- |
| aud.audit_log.created | Audit log created |
| aud.audit_flag.created | Audit flag created |
| aud.audit_flag.resolved | Audit flag resolved |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Staff reads global audit | 403 |
| Permission changed | Audit log created |
| Final edit attempt | Audit flag created |
| Audit export without reason | Rejected |

# EXP - Export API

| Field | Value |
| --- | --- |
| Module Code | EXP |
| Priority | P0 |
| Purpose | Central export engine untuk semua laporan XLSX/PDF/CSV, export history, templates, signed URL, sensitive export reason, and audit. |
| Core Principle | Export adalah controlled data extraction. Semua export harus punya permission, scope, filter, reason jika sensitif, dan audit log. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Exports | /exports |
| Download URL | /exports/{id}/download-url |
| Templates | /exports/templates |
| Report Types | /exports/report-types |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /exports | List export jobs |
| POST | /exports | Request export |
| GET | /exports/{id} | Export detail |
| GET | /exports/{id}/download-url | Generate download URL |
| PATCH | /exports/{id}/cancel | Cancel export |
| DELETE | /exports/{id} | Archive export |
| GET | /exports/report-types | List report types |
| GET | /exports/templates | List templates |
| POST | /exports/templates | Create template |

## Status / Type Standards

### Export Status

| Value | Meaning |
| --- | --- |
| queued | Queued |
| processing | Processing |
| success | Success |
| failed | Failed |
| cancelled | Cancelled |
| expired | Expired |
| archived | Archived |

### Formats

| Value | Meaning |
| --- | --- |
| xlsx | P0 |
| pdf | P0 |
| csv | P1 |
| json | Internal/future |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Job-based export | Mandatory |
| Private storage | Mandatory |
| Download via signed URL | Mandatory |
| Sensitive export requires reason | Mandatory |
| Row limit enforced | Mandatory |
| Evidence URL excluded from normal export | Mandatory |
| Export log never hard deleted | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| EXP.export.read | View exports |
| EXP.export.create | Request export |
| EXP.export.download | Download export |
| EXP.export.cancel | Cancel export |
| EXP.report_type.read | View report types |
| EXP.template.create | Create template |
| INV.report.export | Export inventory |
| AUD.audit_log.export | Export audit log |

## Key Events

| Event | Trigger |
| --- | --- |
| exp.export.requested | Export requested |
| exp.export.completed | Export completed |
| exp.export.failed | Export failed |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Manager exports current stock | Export job created |
| Staff exports audit log | 403 |
| Sensitive export without reason | Rejected |
| Download before success | Invalid state |

# DSH - Dashboard API

| Field | Value |
| --- | --- |
| Module Code | DSH |
| Priority | P0 |
| Purpose | Menyediakan overview, my tasks, widgets, widget data, dashboard alerts, metrics, snapshots, and preferences. |
| Core Principle | Dashboard harus action-oriented dan mengambil data dari backend aggregation, bukan raw query frontend. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Overview | /dashboard/overview |
| My Tasks | /dashboard/my-tasks |
| Widgets | /dashboard/widgets |
| Alerts | /dashboard/alerts |
| Metrics | /dashboard/metrics |
| Snapshots | /dashboard/snapshots |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /dashboard/overview | Dashboard overview by role/scope |
| GET | /dashboard/my-tasks | My action tasks |
| GET | /dashboard/widgets | List visible widgets |
| GET | /dashboard/widgets/{widget_code}/data | Get widget data |
| GET | /dashboard/alerts | List alerts |
| PATCH | /dashboard/alerts/{id}/acknowledge | Acknowledge alert |
| PATCH | /dashboard/alerts/{id}/assign | Assign alert |
| PATCH | /dashboard/alerts/{id}/resolve | Resolve alert |
| PATCH | /dashboard/alerts/{id}/dismiss | Dismiss alert |
| GET | /dashboard/metrics | Metrics |
| GET | /dashboard/snapshots | Historical snapshots |

## Status / Type Standards

### Dashboard Types

| Value | Meaning |
| --- | --- |
| executive | Direksi |
| manager | Manager |
| spv | SPV |
| staff | Staff |
| erp_owner | ERP Owner |
| auditor | Auditor |

### Alert Status

| Value | Meaning |
| --- | --- |
| open | Open |
| acknowledged | Acknowledged |
| in_progress | In progress |
| resolved | Resolved |
| dismissed | Dismissed |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Widget visibility follows RBAC | Mandatory |
| Backend whitelists widget source | Mandatory |
| No raw SQL from frontend | Mandatory |
| Data freshness returned | Recommended |
| High/critical alerts pinned | Recommended |
| Dashboard export via EXP | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| DSH.dashboard.read | View dashboard |
| DSH.task.read | View my tasks |
| DSH.widget.read | View widgets |
| DSH.widget.data.read | View widget data |
| DSH.alert.acknowledge | Acknowledge alert |
| DSH.alert.resolve | Resolve alert |
| DSH.metric.read | View metrics |
| DSH.snapshot.read | View snapshots |

## Key Events

| Event | Trigger |
| --- | --- |
| dsh.alert.created | Alert created |
| dsh.alert.acknowledged | Alert acknowledged |
| dsh.alert.resolved | Alert resolved |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| SPV opens dashboard | Sees own outlet only |
| Widget without permission | Hidden |
| Resolve high alert without notes | Rejected |
| Manager filters outside scope | 403 or empty |

# PRC - Procurement API

| Field | Value |
| --- | --- |
| Module Code | PRC |
| Priority | P1-ready |
| Purpose | Mengelola purchase request, approval pembelian, order, receipt, invoice evidence, validation, and stock-in. |
| Core Principle | Purchase does not auto-add stock. Stock bertambah hanya setelah receipt divalidasi dan stock-in ke Inventory. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Purchase Requests | /procurement/purchase-requests |
| Receipts | /procurement/receipts |
| Vendor Reference | /master-data/vendors |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /procurement/purchase-requests | List PR |
| POST | /procurement/purchase-requests | Create PR |
| GET | /procurement/purchase-requests/{id} | PR detail |
| PATCH | /procurement/purchase-requests/{id} | Update PR |
| PATCH | /procurement/purchase-requests/{id}/submit | Submit PR |
| PATCH | /procurement/purchase-requests/{id}/order | Mark ordered |
| POST | /procurement/purchase-requests/{id}/receipts | Create receipt |
| GET | /procurement/receipts | List receipts |
| PATCH | /procurement/receipts/{id}/validate | Validate receipt |
| PATCH | /procurement/receipts/{id}/stock-in | Convert receipt to stock-in |

## Status / Type Standards

### Purchase Request Status

| Value | Meaning |
| --- | --- |
| draft | Draft |
| submitted | Submitted |
| pending_approval | Waiting approval |
| approved | Approved |
| ordered | Ordered |
| received | Received |
| stocked | Stocked |
| closed | Closed |
| cancelled | Cancelled |

### Receipt Status

| Value | Meaning |
| --- | --- |
| draft | Draft |
| submitted | Submitted |
| pending_validation | Waiting validation |
| validated | Validated |
| stocked | Stocked |
| cancelled | Cancelled |

## Business Rules

| Rule | Requirement |
| --- | --- |
| PR amount recalculated backend | Mandatory |
| Approval via APR | Mandatory for thresholds |
| Receipt before stock-in | Mandatory |
| Invoice evidence by policy | Recommended/required |
| Non-stock service items no movement | Mandatory |
| Receipt stocked cannot edit | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| PRC.purchase_request.create | Create PR |
| PRC.purchase_request.submit | Submit PR |
| PRC.purchase_request.order | Mark ordered |
| PRC.receipt.create | Create receipt |
| PRC.receipt.validate | Validate receipt |
| PRC.receipt.stock_in | Stock-in receipt |
| PRC.report.export | Export procurement |

## Key Events

| Event | Trigger |
| --- | --- |
| prc.purchase_request.created | PR created |
| prc.purchase_request.submitted | PR submitted |
| prc.purchase_request.ordered | PR ordered |
| prc.receipt.validated | Receipt validated |
| prc.receipt.stocked | Receipt stocked |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Create PR with 2 items | Draft created |
| Submit high amount PR | Approval created |
| Create receipt from ordered PR | Receipt draft |
| Stock-in same receipt twice | Rejected |

# CMP - Complaint API

| Field | Value |
| --- | --- |
| Module Code | CMP |
| Priority | P1-ready |
| Purpose | Mengelola komplain dari IG, Google Review, WhatsApp, walk-in, kasir, SPV, dan manager secara traceable. |
| Core Principle | Chat/DM boleh jadi komunikasi, tetapi status resmi, PIC, SLA, follow-up, evidence, dan closure ada di sistem. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Complaints | /complaints |
| Follow-ups | /complaints/{id}/follow-ups |
| Summary | /complaints/summary |
| SLA | /complaints/sla-overdue |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /complaints | List complaints |
| POST | /complaints | Create complaint |
| GET | /complaints/{id} | Complaint detail |
| PATCH | /complaints/{id} | Update complaint |
| PATCH | /complaints/{id}/assign | Assign PIC |
| PATCH | /complaints/{id}/follow-up | Add follow-up |
| PATCH | /complaints/{id}/resolve | Resolve complaint |
| PATCH | /complaints/{id}/close | Close complaint |
| PATCH | /complaints/{id}/reopen | Reopen complaint |
| GET | /complaints/summary | Summary |
| GET | /complaints/sla-overdue | Overdue list |

## Status / Type Standards

### Complaint Status

| Value | Meaning |
| --- | --- |
| open | Open |
| assigned | Assigned |
| in_progress | In progress |
| waiting_customer | Waiting customer |
| waiting_internal | Waiting internal |
| resolved | Resolved |
| closed | Closed |
| reopened | Reopened |
| cancelled | Cancelled |

### Severity

| Value | Meaning |
| --- | --- |
| low | Light |
| medium | Normal follow-up |
| high | Reputation/operational risk |
| critical | Viral/safety/legal/fraud risk |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Public complaint high priority | Recommended |
| High/critical requires evidence | Mandatory |
| SLA calculated by severity | Mandatory |
| Refund resolution links/creates VDR | Mandatory |
| Closed complaint locked | Mandatory |
| Reopen requires reason | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| CMP.complaint.create | Create complaint |
| CMP.complaint.assign | Assign complaint |
| CMP.complaint.follow_up | Add follow-up |
| CMP.complaint.resolve | Resolve complaint |
| CMP.complaint.close | Close complaint |
| CMP.complaint.reopen | Reopen complaint |
| CMP.sla.read | View SLA |
| CMP.report.export | Export complaint |

## Key Events

| Event | Trigger |
| --- | --- |
| cmp.complaint.created | Complaint created |
| cmp.complaint.assigned | Complaint assigned |
| cmp.complaint.follow_up_added | Follow-up added |
| cmp.complaint.resolved | Resolved |
| cmp.complaint.sla_overdue | SLA overdue |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Public Google Review complaint | Alert created |
| Resolve refund complaint without VDR | Rejected or VDR created |
| Close without notes | Rejected |
| SLA overdue | Overdue endpoint shows complaint |

# VDR - Void / Refund Reference API

| Field | Value |
| --- | --- |
| Module Code | VDR |
| Priority | P1-ready |
| Purpose | Mengelola referensi void/refund dari Pawoon/POS untuk kontrol internal, evidence, review, approval, anomaly, dan audit. |
| Core Principle | Pawoon tetap POS. EGG OS tidak mengeksekusi refund di MVP; EGG OS menjadi reference/control/audit layer. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Void/Refund | /void-refunds |
| Reviews | /void-refunds/{id}/reviews |
| Flags | /void-refunds/{id}/flags |
| Summary | /void-refunds/summary |
| Anomalies | /void-refunds/anomalies |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /void-refunds | List VDR |
| POST | /void-refunds | Create VDR |
| GET | /void-refunds/{id} | VDR detail |
| PATCH | /void-refunds/{id} | Update VDR |
| PATCH | /void-refunds/{id}/submit | Submit VDR |
| PATCH | /void-refunds/{id}/review | Review VDR |
| PATCH | /void-refunds/{id}/approve | Approve VDR |
| PATCH | /void-refunds/{id}/reject | Reject VDR |
| PATCH | /void-refunds/{id}/flag | Flag VDR |
| PATCH | /void-refunds/{id}/close | Close VDR |
| GET | /void-refunds/anomalies | List anomalies |

## Status / Type Standards

### VDR Status

| Value | Meaning |
| --- | --- |
| draft | Draft |
| submitted | Submitted |
| pending_review | Waiting review |
| reviewed | Reviewed |
| pending_approval | Waiting approval |
| approved | Approved |
| rejected | Rejected |
| flagged | Flagged |
| closed | Closed |

### Request Types

| Value | Meaning |
| --- | --- |
| void | Void |
| refund | Refund |
| partial_refund | Partial refund |
| price_correction | Price correction |
| payment_correction | Payment correction |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Refund evidence required | Mandatory |
| Duplicate POS receipt reference blocked/warned | Mandatory |
| Risk calculated backend | Mandatory |
| High/critical requires approval | Mandatory |
| Anomaly detection supported | Yes |
| Closed VDR locked | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| VDR.void_refund.create | Create VDR |
| VDR.void_refund.submit | Submit VDR |
| VDR.void_refund.review | Review VDR |
| VDR.void_refund.approve | Approve VDR |
| VDR.void_refund.flag | Flag VDR |
| VDR.summary.read | View summary |
| VDR.anomaly.read | View anomalies |
| VDR.report.export | Export VDR |

## Key Events

| Event | Trigger |
| --- | --- |
| vdr.void_refund.created | VDR created |
| vdr.void_refund.submitted | VDR submitted |
| vdr.void_refund.reviewed | Reviewed |
| vdr.void_refund.flagged | Flagged |
| vdr.void_refund.closed | Closed |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Submit refund without evidence | Rejected |
| Duplicate POS receipt | Conflict/warning |
| Same cashier repeated refund | Anomaly candidate |
| Flag high VDR | Audit flag and alert |

# AUT - Automation / n8n API

| Field | Value |
| --- | --- |
| Module Code | AUT |
| Priority | P1 |
| Purpose | Mengelola workflow automation, webhook events, notification queue, templates, logs, retry, and health monitoring. |
| Core Principle | EGG OS adalah source of truth; n8n hanya executor automation dan tidak boleh bypass business rule. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Workflows | /automation/workflows |
| Logs | /automation/logs |
| Webhook Events | /automation/webhook-events |
| Queue | /automation/queue |
| Notifications | /automation/notifications |
| Health | /automation/health |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /automation/workflows | List workflows |
| POST | /automation/workflows | Create workflow config |
| PATCH | /automation/workflows/{id}/activate | Activate workflow |
| PATCH | /automation/workflows/{id}/pause | Pause workflow |
| PATCH | /automation/workflows/{id}/test | Test workflow |
| GET | /automation/logs | List logs |
| POST | /automation/webhook-events | Receive callback |
| GET | /automation/queue | List queue |
| PATCH | /automation/queue/{id}/retry | Retry queue |
| POST | /automation/notifications/send | Queue notification |
| POST | /automation/notifications/send-test | Test notification |
| GET | /automation/health | Automation health |

## Status / Type Standards

### Workflow Status

| Value | Meaning |
| --- | --- |
| draft | Draft |
| active | Active |
| paused | Paused |
| failed | Failed |
| archived | Archived |

### Queue Status

| Value | Meaning |
| --- | --- |
| queued | Queued |
| processing | Processing |
| sent | Sent |
| failed | Failed |
| retrying | Retrying |
| cancelled | Cancelled |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Webhook signature required | Mandatory |
| Idempotency key required | Mandatory |
| Secrets not logged | Mandatory |
| Sensitive payload masked | Mandatory |
| Retry policy enforced | Mandatory |
| Critical failure visible on dashboard | Recommended |

## Permission Summary

| Permission | Description |
| --- | --- |
| AUT.workflow.read | View workflow |
| AUT.workflow.create | Create workflow |
| AUT.workflow.update | Update workflow |
| AUT.workflow.test | Test workflow |
| AUT.log.read | View logs |
| AUT.queue.retry | Retry queue |
| AUT.notification.send | Send notification |
| AUT.notification_template.update | Update template |
| AUT.health.read | View health |

## Key Events

| Event | Trigger |
| --- | --- |
| aut.notification.queued | Notification queued |
| aut.notification.sent | Notification sent |
| aut.notification.failed | Notification failed |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Create user invitation | Email queue created |
| Duplicate idempotency callback | No duplicate notification |
| Invalid webhook signature | 401 |
| Manual retry failed queue | Queue returns to queued |

# COR - Correction Request API

| Field | Value |
| --- | --- |
| Module Code | COR |
| Priority | P0/P1 |
| Purpose | Mengelola request koreksi untuk data submitted/validated/final/approved/closed/locked. |
| Core Principle | Final record tidak boleh diedit langsung. Koreksi harus lewat correction request dan source module service. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Corrections | /corrections |
| History | /corrections/{id}/history |
| Summary | /corrections/summary |
| Pending Apply | /corrections/pending-apply |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /corrections | List corrections |
| POST | /corrections | Create correction |
| GET | /corrections/{id} | Correction detail |
| PATCH | /corrections/{id} | Update correction |
| PATCH | /corrections/{id}/submit | Submit correction |
| PATCH | /corrections/{id}/review | Review correction |
| PATCH | /corrections/{id}/approve | Approve correction |
| PATCH | /corrections/{id}/reject | Reject correction |
| PATCH | /corrections/{id}/apply | Apply correction |
| PATCH | /corrections/{id}/cancel | Cancel correction |
| GET | /corrections/pending-apply | Approved but unapplied corrections |

## Status / Type Standards

### Correction Status

| Value | Meaning |
| --- | --- |
| draft | Draft |
| submitted | Submitted |
| pending_review | Waiting review |
| reviewed | Reviewed |
| pending_approval | Waiting approval |
| approved | Approved |
| rejected | Rejected |
| applied | Applied |
| apply_failed | Apply failed |
| cancelled | Cancelled |

### Correction Types

| Value | Meaning |
| --- | --- |
| wrong_quantity | Wrong quantity |
| wrong_item | Wrong item |
| wrong_amount | Wrong amount |
| invalid_evidence | Invalid evidence |
| final_record_correction | Final record correction |
| inventory_adjustment | Inventory adjustment |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Field whitelist per module | Mandatory |
| Risk calculated backend | Mandatory |
| Evidence required for high impact | Mandatory |
| Approved only can be applied | Mandatory |
| Source module service applies correction | Mandatory |
| Audit old/new value | Mandatory |
| Audit log never edited directly | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| COR.correction.create | Create correction |
| COR.correction.submit | Submit correction |
| COR.correction.review | Review correction |
| COR.correction.approve | Approve correction |
| COR.correction.apply | Apply correction |
| COR.correction.apply_queue.read | View pending apply |
| COR.report.export | Export correction |

## Key Events

| Event | Trigger |
| --- | --- |
| cor.correction.created | Correction created |
| cor.correction.approved | Correction approved |
| cor.correction.applied | Correction applied |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Correction final stock opname | Approval required |
| Submit high risk without evidence | Rejected |
| Apply before approval | Rejected |
| Inventory correction applied | Adjustment movement created |

# SYS - System Admin & Settings API

| Field | Value |
| --- | --- |
| Module Code | SYS |
| Priority | P0/P1 |
| Purpose | Mengelola settings, feature flags, module registry, status, health, version, cache, and maintenance mode. |
| Core Principle | System settings tidak boleh diubah sembarang role. Perubahan setting wajib reason dan audit. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Settings | /system/settings |
| Feature Flags | /system/feature-flags |
| Modules | /system/modules |
| Status | /system/status |
| Health | /system/health |
| Cache | /system/cache |
| Maintenance | /system/maintenance |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /system/settings | List settings |
| PATCH | /system/settings/{key} | Update setting |
| POST | /system/settings | Create setting |
| PATCH | /system/settings/{key}/reset | Reset setting |
| GET | /system/feature-flags | List feature flags |
| PATCH | /system/feature-flags/{id} | Update flag |
| GET | /system/modules | List modules |
| GET | /system/status | System status |
| GET | /system/health | Health check detail |
| GET | /system/version | App version |
| POST | /system/cache/refresh | Refresh cache |
| POST | /system/cache/clear | Clear cache |
| GET | /system/maintenance | Maintenance status |
| PATCH | /system/maintenance | Update maintenance mode |

## Status / Type Standards

### Setting Groups

| Value | Meaning |
| --- | --- |
| auth | Authentication settings |
| inventory | Inventory rules |
| evidence | Upload rules |
| export | Export limits |
| automation | Automation behavior |
| security | Security policy |

### App Status

| Value | Meaning |
| --- | --- |
| operational | Normal |
| degraded | Some issues |
| partial_outage | Partial outage |
| major_outage | Major outage |
| maintenance | Maintenance |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Sensitive settings masked | Mandatory |
| Reason for config change | Mandatory |
| Feature flag cannot bypass permissions | Mandatory |
| Public healthz minimal only | Mandatory |
| Cache clear restricted | Mandatory |
| Maintenance preserves admin access | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| SYS.setting.read | View settings |
| SYS.setting.update | Update setting |
| SYS.feature_flag.update | Update feature flag |
| SYS.module.read | View modules |
| SYS.status.read | View status |
| SYS.health.read | View health |
| SYS.cache.refresh | Refresh cache |
| SYS.maintenance.update | Update maintenance |

## Key Events

| Event | Trigger |
| --- | --- |
| sys.setting.updated | System setting updated |
| sys.feature.enabled | Feature enabled |
| sys.cache.refreshed | Cache refreshed |
| sys.maintenance.enabled | Maintenance enabled |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Staff views settings | 403 |
| Update setting without reason | Rejected |
| Sensitive setting viewed unauthorized | Masked/forbidden |
| Enable maintenance mode | Non-allowed users blocked |

# INT - Integration API

| Field | Value |
| --- | --- |
| Module Code | INT |
| Priority | P1 |
| Purpose | Mengelola integration registry, credentials reference, sync jobs, logs, Pawoon import/reference, item mapping, generic import, and webhooks. |
| Core Principle | External system adalah data source; EGG OS tetap validated control layer. |

## API Prefixes

| Resource | Prefix |
| --- | --- |
| Integrations | /integrations |
| Sync Jobs | /integrations/sync-jobs |
| Logs | /integrations/logs |
| Pawoon | /integrations/pawoon |
| Imports | /integrations/imports |
| Webhooks | /integrations/webhooks |

## Endpoint Summary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /integrations | List integrations |
| POST | /integrations | Create integration |
| GET | /integrations/{id} | Integration detail |
| PATCH | /integrations/{id} | Update integration |
| PATCH | /integrations/{id}/activate | Activate integration |
| PATCH | /integrations/{id}/pause | Pause integration |
| PATCH | /integrations/{id}/test-connection | Test connection |
| POST | /integrations/{id}/sync | Start sync job |
| GET | /integrations/sync-jobs | List sync jobs |
| PATCH | /integrations/sync-jobs/{id}/retry | Retry sync |
| GET | /integrations/logs | List integration logs |
| GET | /integrations/pawoon/status | Pawoon status |
| POST | /integrations/pawoon/import | Import Pawoon export file |
| GET | /integrations/pawoon/transactions | List Pawoon refs |
| GET | /integrations/pawoon/mappings/items | List item mappings |
| POST | /integrations/pawoon/mappings/items | Create item mapping |

## Status / Type Standards

### Integration Types

| Value | Meaning |
| --- | --- |
| pos | POS/Pawoon |
| automation | n8n |
| email | SMTP/provider |
| storage | Cloudflare R2 |
| spreadsheet | Google Sheets/import |
| webhook | Webhook |

### Sync Status

| Value | Meaning |
| --- | --- |
| queued | Queued |
| processing | Processing |
| success | Success |
| partial_success | Partial success |
| failed | Failed |
| cancelled | Cancelled |

## Business Rules

| Rule | Requirement |
| --- | --- |
| Raw credentials never returned | Mandatory |
| Credential encrypted/secret manager | Mandatory |
| Import validation before apply | Mandatory |
| Duplicate detection | Mandatory |
| Pawoon remains POS source | Mandatory |
| EGG OS remains control layer | Mandatory |

## Permission Summary

| Permission | Description |
| --- | --- |
| INT.integration.read | View integration |
| INT.integration.create | Create integration |
| INT.integration.test | Test integration |
| INT.sync.create | Create sync job |
| INT.log.read | View logs |
| INT.pawoon.import | Import Pawoon |
| INT.pawoon.transaction.read | View Pawoon transactions |
| INT.pawoon.mapping.create | Create Pawoon mapping |
| INT.import.apply | Apply import |

## Key Events

| Event | Trigger |
| --- | --- |
| int.sync.started | Sync started |
| int.sync.completed | Sync completed |
| int.sync.failed | Sync failed |
| int.import.applied | Import applied |

## UAT Scenarios

| Scenario | Expected Result |
| --- | --- |
| Create Pawoon integration | Draft created |
| Import Pawoon XLSX | Import job created |
| Validate missing headers | Rejected |
| Map Telor Kitchen to Telur | Mapping created |

# Appendix A - Permission Matrix Master

| Group | Permission |
| --- | --- |
| AUTH/RBAC | AUTH.session.login |
| AUTH/RBAC | AUTH.session.logout |
| AUTH/RBAC | AUTH.me.read |
| AUTH/RBAC | AUTH.user.create |
| AUTH/RBAC | AUTH.user.update |
| AUTH/RBAC | RBAC.role.create |
| AUTH/RBAC | RBAC.role_permission.update |
| AUTH/RBAC | RBAC.user_role.assign |
| CORE/MDM | CORE.company.read |
| CORE/MDM | CORE.brand.read |
| CORE/MDM | CORE.outlet.read |
| CORE/MDM | CORE.department.read |
| CORE/MDM | MDM.item.lookup |
| CORE/MDM | MDM.item.create |
| CORE/MDM | MDM.item_alias.create |
| CORE/MDM | MDM.master_request.review |
| INV/ODR/APR | INV.current_stock.read |
| INV/ODR/APR | INV.stock_movement.create |
| INV/ODR/APR | INV.stock_opname.finalize |
| INV/ODR/APR | ODR.daily_report.create |
| INV/ODR/APR | ODR.daily_report.validate |
| INV/ODR/APR | ODR.issue.resolve |
| INV/ODR/APR | APR.approval.decide |
| INV/ODR/APR | APR.rule.update |
| Control | EVD.evidence.upload |
| Control | EVD.evidence.download |
| Control | AUD.audit_log.read |
| Control | AUD.audit_flag.resolve |
| Control | EXP.export.create |
| Control | EXP.export.download |
| Control | DSH.dashboard.read |
| Control | DSH.alert.resolve |
| P1 | PRC.receipt.stock_in |
| P1 | CMP.complaint.resolve |
| P1 | VDR.void_refund.flag |
| P1 | COR.correction.apply |
| P1 | AUT.queue.retry |
| P1 | INT.pawoon.import |
| P1 | SYS.setting.update |

# Appendix B - Error Code Catalog

| Code | HTTP | Meaning |
| --- | --- | --- |
| UNAUTHORIZED | 401 | Token missing/invalid |
| TOKEN_EXPIRED | 401 | Access token expired |
| FORBIDDEN | 403 | No permission/scope denied |
| NOT_FOUND | 404 | Data not found |
| VALIDATION_ERROR | 422 | Request validation failed |
| CONFLICT | 409 | Duplicate/conflict |
| INVALID_STATE | 409 | Status does not allow action |
| APPROVAL_REQUIRED | 409 | Needs approval |
| SELF_APPROVAL_BLOCKED | 409 | Requester cannot approve own request |
| MISSING_EVIDENCE | 409 | Required evidence missing |
| FINAL_RECORD_LOCKED | 409 | Final record cannot be edited |
| INSUFFICIENT_STOCK | 409 | Not enough stock |
| NEGATIVE_STOCK_BLOCKED | 409 | Negative stock blocked |
| EXPORT_TOO_LARGE | 409 | Export too large |
| UNSUPPORTED_CORRECTION | 409 | Correction strategy unsupported |
| VDR_REQUIRED | 409 | Refund requires VDR |
| MAPPING_NOT_FOUND | 409 | Integration mapping not found |
| INVALID_FILE_TYPE | 422 | Unsupported file type |
| FILE_TOO_LARGE | 422 | File too large |
| STORAGE_ERROR | 500 | Storage error |
| INTEGRATION_CONNECTION_FAILED | 503 | Integration connection failed |
| AUTOMATION_SERVICE_UNAVAILABLE | 503 | Automation/n8n unavailable |

# Appendix C - Event Catalog

| Event | Trigger |
| --- | --- |
| auth.user.created | User created |
| auth.login.failed | Login failed |
| rbac.permission.updated | Permission changed |
| mdm.item_alias.created | Alias created |
| inv.stock_movement.validated | Movement validated |
| inv.stock.critical | Critical stock |
| odr.daily_report.missing | Missing report |
| apr.approval.approved | Approval approved |
| evd.evidence.uploaded | Evidence uploaded |
| aud.audit_flag.created | Audit flag created |
| exp.export.completed | Export completed |
| dsh.alert.created | Dashboard alert created |
| prc.receipt.stocked | Purchase receipt stocked |
| cmp.complaint.sla_overdue | Complaint SLA overdue |
| vdr.void_refund.flagged | VDR flagged |
| cor.correction.applied | Correction applied |
| aut.notification.failed | Notification failed |
| int.sync.failed | Integration sync failed |

# Appendix D - Role Access Baseline

| Role | Baseline Access |
| --- | --- |
| SUPER_ADMIN | All modules, all scopes, audited heavily |
| ERP_OWNER | Most config, master data, dashboard, audit, export, correction, integration, automation, limited system settings |
| DIREKSI | Executive dashboard, high-risk approval, audit summary, high/critical alerts |
| AUDITOR / INSPEKTORAT | Audit logs, audit flags, sensitive exports, VDR anomalies, correction history |
| MANAGER_INVENTORY | Inventory, procurement inventory view, item master, dashboard, reports |
| MANAGER_FINANCE | Procurement, export, approval, VDR, finance-related controls |
| MANAGER_OPS_HR | ODR, HR future, operations dashboard, approval |
| MANAGER_COMMERCIAL | Complaint, VDR, commercial dashboard, ODR limited |
| SPV_OUTLET | Own outlet reports, stock input, evidence, PR, complaint/VDR initial input |
| STAFF | Own tasks, limited input, upload evidence, master request |

# Appendix E - Endpoint Index Summary

| Module | Key Endpoints |
| --- | --- |
| AUTH | /auth/login, /auth/logout, /auth/refresh, /auth/me, /auth/me/permissions |
| Users/RBAC | /users, /roles, /permissions, /rbac/access-overrides |
| CORE/MDM | /companies, /brands, /outlets, /departments, /master-data/items, /master-data/lookup/items |
| INV | /inventory/current-stocks, /inventory/stock-movements, /inventory/stock-opnames, /inventory/waste-records |
| ODR | /daily-reports/templates, /daily-reports, /daily-issues |
| APR | /approvals, /approvals/my-tasks, /approvals/rules |
| EVD | /evidence, /evidence/upload, /evidence/{id}/download-url, /evidence/validate-required |
| AUD | /audit/logs, /audit/flags, /audit/summary |
| EXP | /exports, /exports/{id}/download-url, /exports/templates, /exports/report-types |
| DSH | /dashboard/overview, /dashboard/my-tasks, /dashboard/widgets, /dashboard/alerts |
| PRC | /procurement/purchase-requests, /procurement/receipts |
| CMP | /complaints, /complaints/summary, /complaints/sla-overdue |
| VDR | /void-refunds, /void-refunds/summary, /void-refunds/anomalies |
| AUT | /automation/workflows, /automation/logs, /automation/queue, /automation/notifications |
| COR | /corrections, /corrections/pending-apply, /corrections/summary |
| SYS | /system/settings, /system/feature-flags, /system/modules, /system/health |
| INT | /integrations, /integrations/pawoon/import, /integrations/pawoon/transactions |

# Appendix F - MVP Implementation Priority

| Sprint | Modules | Deliverables |
| --- | --- | --- |
| Sprint 1 - Foundation | AUTH, RBAC, CORE, AUD base, MDM base | Login, user, roles, permission, company/brand/outlet, item master, alias |
| Sprint 2 - Inventory Core | INV, EVD upload, APR basic | Stock movement, opname, validation, evidence upload, approval basic, current stock |
| Sprint 3 - Operational Report | ODR, DSH basic, EXP basic | Opening/closing checklist, issue, SPV validation, dashboard overview, export |
| Sprint 4 - Control & Governance | AUD complete, EVD lock, COR basic, SYS basic, AUT credential email | Audit flags, correction, settings, evidence lock, credential email |
| Sprint 5 - P1 Expansion | PRC, CMP, VDR, AUT reminders, INT Pawoon import | Purchase, complaints, void/refund control, reminders, Pawoon import |

# Final Developer Notes

Do not build all modules at once. Build foundation -> inventory -> report -> approval/evidence/audit -> dashboard -> P1 modules.

If a feature does not reduce leakage, improve control, improve reporting, or reduce manual chaos, defer it.

Backend validation, permission, scope, status transition, and audit are mandatory. Frontend role checking is only UI assistance.

The most important control points are RBAC backend check, item alias standardization, stock movement source of truth, evidence requirement, approval no self-approval, immutable audit, final record lock, correction flow, export logging, and dashboard alerts.

# Document Status

| Part | Status |
| --- | --- |
| Part 1 | Complete |
| Part 2 | Complete |
| Part 3 | Complete |
| Part 4 | Complete |
| Part 5 | Complete |
| Part 6 | Complete |
| Part 7 | Complete |
| Part 8 | Complete |
| Part 9 | Complete |
| Part 10 | Complete |
| Part 11 | Complete |
| Part 12 | Complete |
| Part 13 | Complete |
| Part 14 | Complete |
| Part 15 | Complete |
| Part 16 | Complete |
| Part 17 | Complete |
| Part 18 | Complete |
