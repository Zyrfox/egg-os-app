# EGG OS DBD v0.2

**Version:** v0.2  
**Status:** Draft for Review  
**Technical Baseline:** Cloudflare-Native TanStack Stack  
Database model remains PostgreSQL. ORM/tooling baseline updated to Drizzle ORM + Hyperdrive.

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

Database Design Document

Database schema, module table catalog, constraints, views, and migration strategy for EGG OS MVP

Version 0.2 | Prepared for Easy Going Group | Generated 2026-06-11

| Document purpose
Dokumen ini disusun sebagai pegangan teknis internal untuk perancangan dan pembangunan MVP EGG OS. Isi dokumen berfokus pada kebutuhan sistem, kontrol operasional, audit, dan kesiapan implementasi. |
| --- |

# Document Control

| Field | Value |
| --- | --- |
| Document | DBD - Database Design Document |
| Product | EGG OS - Internal ERP / Operating System |
| Version | 0.2 |
| Owner / Custodian | Ilham Juniansyah S. |
| Business Context | Easy Going Group multi-outlet operation |
| Pilot Scope | BTMK + BTMF |
| Future Scope | TSF, Healthopia, EGC, ENC, FRC, SaaS external businesses |
| Generated Date | 2026-06-11 |

# 1. Database Overview

DBD EGG OS v0.2 dirancang untuk PostgreSQL dengan pola relational core + JSONB untuk metadata fleksibel. Semua tabel utama multi-company ready dan memakai UUID sebagai primary key.

| Area | Decision |
| --- | --- |
| Database | PostgreSQL recommended |
| ID Type | UUID |
| Naming | snake_case, plural table names |
| Multi-company | company_id wajib pada main tables |
| Soft Delete | deleted_at pada main operational tables |
| Audit | Central audit_logs mandatory |
| Evidence | Metadata in DB, file in private object storage |
| Inventory Source of Truth | stock_movements |
| Current Stock | current_stocks as cache/snapshot |
| Dashboard | Views + snapshots + dashboard_alerts |

# 2. High-Level ERD Summary

| ERD Summary
companies -> brands -> outlets -> operational modules. users -> roles/permissions -> actions. inventory_items -> stock_movements/current_stocks. approval_requests/evidence_files/audit_logs connect across modules using related_record_type + related_record_id. |
| --- |

| Parent | Key Children / Connected Records |
| --- | --- |
| companies | brands, outlets, departments, users, roles, permissions, inventory_items, audit_logs, export_logs, dashboard_alerts. |
| outlets | storage_locations, daily_reports, stock_movements, stock_opnames, purchase_requests, complaints, void_refund_references. |
| users | user_roles, auth_events, audit_logs, approval_requests, reports, evidence uploads, notification preferences. |
| inventory_items | item_aliases, current_stocks, stock_movements, stock_opname_lines, purchase lines. |
| approval_requests | approval_steps, approval_histories, approval_comments, evidence_files, source records. |
| evidence_files | linked to any operational record using module + related_record_type + related_record_id. |
| audit_logs | central activity history across all modules. |

# 3. Global Database Standards

| Standard | Rule |
| --- | --- |
| Primary Key | id UUID PRIMARY KEY DEFAULT gen_random_uuid(). |
| Foreign Key | Use {entity}_id naming pattern. |
| Status | Use status VARCHAR(30) with CHECK constraint where practical. |
| Timestamps | created_at, updated_at, deleted_at for main tables. |
| JSONB | Use metadata or *_payload for flexible config, snapshots, filters, and extra context. |
| Unique Codes | Business code unique per company: UNIQUE(company_id, code). |
| Final Data | Final/closed/locked records cannot be edited directly. Use correction flow. |
| Audit | Important changes must insert audit_logs. |
| Evidence | High-risk records must have evidence before submit/approve/close as applicable. |

# 4. Module Table Catalog

## CORE

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| companies | id, company_code, company_name, legal_name, status, metadata, created_by, created_at, updated_at, deleted_at | Root tenant/company. Seed: EGG - Easy Going Group. Unique company_code. |
| brands | id, company_id, brand_code, brand_name, brand_type, status, metadata, timestamps | Brand/unit bisnis. Seed: BTMK, BTMF, TSF, HCP, EGC, ENC, FRC. |
| outlets | id, company_id, brand_id, outlet_code, outlet_name, outlet_type, address, timezone, opening_time, closing_time, status, timestamps | Outlet fisik/operasional. MVP seed: BTMK + BTMF. |
| departments | id, company_id, department_code, department_name, department_type, status, timestamps | Divisi/fungsi kerja. Seed: INV, FIN, OPS, HR, COM, MED, AUD, KTN, CSR, TECH. |

## AUTH + RBAC

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| users | id, company_id, full_name, email, password_hash, account_type, status, first_login_required, email_verified_at, last_login_at, expires_at, metadata, created_by, timestamps | Email unique per company. Password hash only. Inactive/suspended cannot login. |
| password_tokens | id, user_id, token_hash, token_type, expires_at, used_at, created_by, created_at, metadata | set_password/reset_password/temporary_password. Single-use, hashed, expiry 24-72h. |
| refresh_tokens | id, user_id, token_hash, device_info, ip_address, expires_at, revoked_at, created_at | Session refresh token hashed and revocable. |
| auth_events | id, company_id, actor_user_id, target_user_id, event_type, status, ip_address, device_info, notes, created_at | login_success, login_failed, logout, password_set, credential_email_sent, etc. |
| roles | id, company_id nullable, role_code, role_name, description, level, is_system_role, status, timestamps | Role seed: SUPER_ADMIN, ERP_OWNER, DIREKSI, MANAGER_*, SPV_OUTLET, STAFF, AUDITOR. |
| permissions | id, permission_code, module, action, description, is_system_permission | Permission catalog per module/action. |
| role_permissions | id, role_id, permission_id, scope_type, created_at | Maps permission to role + scope. Scope: global/company/brand/outlet/department/own/assigned/audit_view. |
| user_roles | id, user_id, role_id, company_id, brand_id, outlet_id, department_id, scope_type, status, starts_at, expires_at, created_by, timestamps | Multi-role supported. Scoped assignment. |
| access_overrides | id, user_id, permission_id, company_id, brand_id, outlet_id, department_id, scope_type, effect, reason, status, starts_at, expires_at, created_by, created_at, deleted_at | Temporary allow/deny. Deny wins. Reason+expiry required. |
| user_login_attempts | id, company_id, email, ip_address, attempt_status, attempted_at | P1 security/rate-limit support. |

## MDM

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| storage_locations | id, company_id, brand_id, outlet_id, storage_code, storage_name, storage_type, is_shared, status, metadata, timestamps | Storage per outlet: freezer, chiller, dry storage, kitchen station, bar area, outlet area. |
| categories | id, company_id, parent_category_id, category_code, category_name, category_type, status, metadata | Item/procurement/expense categories. Supports hierarchy. |
| units | id, company_id, unit_code, unit_name, unit_type, symbol, status, metadata | PCS, PACK, KG, G, L, ML, BOTOL, PORSI, SACHET. |
| unit_conversions | id, company_id, from_unit_id, to_unit_id, item_id nullable, conversion_rate, status | Global conversion if item_id null; item-specific for pack/dus. |
| inventory_items | id, company_id, brand_id, category_id, default_storage_location_id, item_code, standard_name, item_type, primary_unit_id, purchase_unit_id, minimum_stock, maximum_stock, estimated_unit_cost, is_stock_tracked, is_high_risk, is_recipe_component, status, metadata, approved_by, timestamps | Company-level item master. Standardized item names. |
| item_aliases | id, company_id, item_id, alias_name, normalized_alias, source, confidence_score, status, created_by, approved_by, timestamps | Alias unique per company. Handles Telor/Telur Kitchen, Saos/Saus, Tepunh Dkriuk. |
| vendors | id, company_id, vendor_code, vendor_name, vendor_type, contact_name, phone, email, address, status, metadata, created_by, approved_by | P1 vendor master. |
| master_data_requests | id, company_id, requested_by, reviewed_by, request_type, target_entity_type, target_entity_id, payload, reason, status, review_notes, applied_at | Staff request create/update master; reviewed before applied. |

## INV

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| current_stocks | id, company_id, brand_id, outlet_id, storage_location_id, item_id, unit_id, quantity, last_movement_id, last_updated_at, timestamps | Cache only. Unique company/outlet/storage/item. Rebuildable from stock_movements. |
| stock_movements | id, company_id, brand_id, outlet_id, storage_location_id, item_id, movement_type, direction, quantity, unit_id, quantity_base, base_unit_id, unit_conversion_rate, movement_date, reason_category, reason_detail, source_type, source_id, approval_request_id, status, created_by, submitted_at, validated_by, validated_at, finalized_at, notes, timestamps | Source of truth for stock change. Final/validated movements affect current_stocks. |
| stock_opnames | id, company_id, brand_id, outlet_id, storage_location_id, opname_type, opname_date, started_at, submitted_at, validated_by, finalized_at, status, totals, notes, timestamps | Daily/monthly/spot/opening/correction stock count header. |
| stock_opname_lines | id, stock_opname_id, company_id, outlet_id, storage_location_id, item_id, unit_id, system_quantity, physical_quantity, variance_quantity, estimated_unit_cost, estimated_variance_value, discrepancy_level, reason_category, reason_detail, status | Variance = physical - system. High/critical requires evidence/approval. |
| stock_adjustments | id, company_id, outlet_id, storage_location_id, item_id, adjustment_type, adjustment_direction, quantity, unit_id, estimated_value, source_opname_id, source_opname_line_id, approval_request_id, stock_movement_id, reason, status, requested_by, approved_by, applied_at | Approved adjustment creates stock_movement once. |
| waste_records | id, company_id, outlet_id, storage_location_id, item_id, record_type, quantity, unit_id, reason_category, reason_detail, risk_level, stock_movement_id, approval_request_id, status, reported_by, validated_by, timestamps | Reject/waste. High-risk evidence required. Final creates minus movement. |
| emergency_use_records | id, company_id, outlet_id, storage_location_id, item_id, quantity, unit_id, reason, risk_level, related_purchase_request_id, approval_request_id, stock_movement_id, status, used_by, used_at, validated_by, timestamps | Bypass only for urgent need with reason/evidence/approval susulan. |
| transfer_requests | id, company_id, from_brand_id, from_outlet_id, from_storage_id, to_brand_id, to_outlet_id, to_storage_id, transfer_type, reason, approval_request_id, status, requested_by, approved_by, sent_by, received_by, timestamps | Transfer between storage/outlet/brand. |
| transfer_request_lines | id, transfer_request_id, item_id, quantity_requested, quantity_sent, quantity_received, unit_id, transfer_out_movement_id, transfer_in_movement_id, condition_on_receive, notes | Sent creates transfer_out. Received creates transfer_in. |
| inventory_snapshots | id, company_id, brand_id, outlet_id, storage_location_id, snapshot_type, snapshot_date, snapshot_payload, created_by, created_at | Report/closing/audit snapshots. Not source of truth. |

## ODR

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| checklist_templates | id, company_id, brand_id, outlet_id, department_id, template_code, template_name, report_type, version, is_active, status, metadata, created_by, approved_by, approved_at, timestamps | Reusable opening/closing/daily issue checklist template. |
| checklist_template_items | id, template_id, company_id, section_name, item_label, item_description, field_type, options, is_required, evidence_required, sort_order, risk_level, status, timestamps | Template questions/items. Field types: yes_no, text, number, photo, select, etc. |
| daily_reports | id, company_id, brand_id, outlet_id, department_id, template_id, report_type, report_date, shift_code, status, submitted_by, submitted_at, validated_by, validated_at, finalized_at, is_late, late_minutes, issue_count, missing_required_count, missing_evidence_count, notes, created_by, timestamps | Opening/closing/daily issue report header. Unique outlet/date/type/shift. |
| daily_report_items | id, daily_report_id, template_item_id, company_id, item_label_snapshot, field_type_snapshot, section_name_snapshot, answer_text, answer_number, answer_boolean, answer_json, is_required, evidence_required, evidence_status, risk_level, sort_order, notes | Answer snapshot so template changes do not affect old reports. |
| daily_issues | id, company_id, brand_id, outlet_id, department_id, daily_report_id, daily_report_item_id, issue_code, issue_date, category, severity, title, description, status, reported_by, assigned_to, resolved_by, closed_by, resolution_notes, is_high_risk, timestamps | Operational issue log linked to reports or standalone. |
| issue_assignments | id, issue_id, company_id, assigned_to, assigned_by, assignment_type, notes, assigned_at, unassigned_at, status | Issue PIC history. |
| report_validation_logs | id, daily_report_id, company_id, action, previous_status, new_status, actor_user_id, notes, created_at | Append-only validation timeline. |

## APR

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| approval_requests | id, company_id, brand_id, outlet_id, department_id, approval_code, related_module, related_record_type, related_record_id, request_type, title, description, requested_by, requested_at, amount, risk_level, approval_level, current_step_order, current_approver_id, status, final_decision, final_decision_by, final_decision_at, evidence_required, notes, timestamps | Central approval header. Polymorphic link to source record. |
| approval_steps | id, approval_request_id, company_id, step_order, approval_level, approver_role_id, approver_user_id, approver_department_id, is_required, status, decision, decision_by, decision_at, decision_notes, due_at, timestamps | Sequential approval step. Unique step_order per request. |
| approval_histories | id, approval_request_id, approval_step_id, company_id, actor_user_id, actor_type, action, previous_status, new_status, notes, metadata, created_at | Approval action timeline. |
| approval_rules | id, company_id, rule_code, rule_name, module, request_type, priority, approval_level, approver_role_id, approver_user_id, approver_department_id, is_active, status, created_by, approved_by, timestamps | Routing rule for approval based on request context. |
| approval_rule_conditions | id, approval_rule_id, company_id, field_name, operator, value_text, value_number, value_json, sort_order, created_at | Rule conditions such as amount > 500000. |
| approval_comments | id, approval_request_id, company_id, comment_by, comment_text, is_internal, timestamps, deleted_at | Approval discussion/comment. |
| approval_slas | id, company_id, module, request_type, approval_level, reminder_after_minutes, escalate_after_minutes, is_active, created_by, timestamps | P1 SLA/reminder/escalation config. |
| approval_delegations | id, company_id, delegator_user_id, delegate_user_id, module, approval_level, reason, starts_at, ends_at, status, created_by, created_at, cancelled_at | P1/P2 temporary delegation. |

## EVD

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| evidence_files | id, company_id, brand_id, outlet_id, department_id, module, related_record_type, related_record_id, evidence_type, original_filename, stored_filename, file_extension, mime_type, file_size_bytes, storage_provider, storage_bucket, storage_path, checksum, is_required, is_sensitive, is_locked, status, notes, uploaded_by, uploaded_at, locked_at, archived_by, deleted_by, timestamps | Metadata only. File lives in private storage. |
| evidence_links | id, evidence_file_id, company_id, module, related_record_type, related_record_id, link_type, linked_by, linked_at, unlinked_by, unlinked_at, status, notes | Optional multi-link one evidence to many records. |
| evidence_access_logs | id, evidence_file_id, company_id, user_id, action, status, ip_address, device_info, reason, created_at | P1 access log for sensitive evidence. |
| evidence_versions | id, evidence_file_id, previous_evidence_file_id, company_id, version_number, replace_reason, replaced_by, replaced_at | P1 versioning on replace. |
| evidence_retention_policies | id, company_id, module, evidence_type, retention_days, archive_after_days, delete_after_days, is_active, created_by, timestamps | P2 retention policy. |

## AUD

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| audit_logs | id, company_id, brand_id, outlet_id, department_id, actor_type, actor_user_id, actor_role_id, module, action, record_type, record_id, related_record_type, related_record_id, previous_value, new_value, changed_fields, status, severity, ip_address, device_info, request_id, notes, metadata, created_at | Central append-only audit log concept. |
| audit_log_details | id, audit_log_id, company_id, detail_type, detail_payload, created_at | Optional big payload/detail table. |
| audit_flags | id, audit_log_id, company_id, flag_type, severity, source, flag_reason, created_by, resolved_by, resolution_notes, status, timestamps | Flag high-risk/security/fraud/data integrity events. |
| audit_review_notes | id, audit_log_id, audit_flag_id, company_id, reviewed_by, review_note, review_status, timestamps, deleted_at | Auditor/ERP Owner review notes. |
| audit_exports | id, company_id, audit_log_id, exported_by, export_type, report_type, export_format, filter_payload, scope_payload, row_count, file_name, storage_path, reason, status, error_message, created_at | Dedicated sensitive export metadata. |
| audit_retention_policies | id, company_id, module, severity, retention_days, archive_after_days, is_active, created_by, timestamps | P2 retention policy. |

## EXP

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| export_logs | id, company_id, brand_id, outlet_id, department_id, export_code, report_type, report_name, export_format, filter_payload, scope_payload, column_payload, row_count, file_name, file_size_bytes, storage_provider, storage_path, download_expires_at, status, error_message, is_sensitive, reason, requested_by, requested_at, completed_at, audit_log_id, metadata, timestamps | Every export attempt success/failed/denied is logged. |
| report_templates | id, company_id, template_code, template_name, report_type, module, supported_formats, default_format, default_filter_payload, default_sort_payload, is_sensitive, requires_reason, max_rows, status, created_by, approved_by, timestamps | Export/report template. |
| report_template_columns | id, report_template_id, company_id, column_key, column_label, column_type, source_field, is_default, is_required, is_sensitive, sort_order, format_config, status, timestamps | Default export columns. |
| scheduled_reports | id, company_id, report_template_id, schedule_code, schedule_name, schedule_type, cron_expression, timezone, export_format, filter_payload, scope_payload, is_active, last_run_at, next_run_at, status, created_by, timestamps | P1 scheduled exports. |
| scheduled_report_recipients | id, scheduled_report_id, company_id, recipient_type, user_id, role_id, department_id, email, delivery_channel, status, timestamps | P1 recipients. |
| export_file_archives | id, export_log_id, company_id, archive_type, file_name, file_format, file_size_bytes, storage_provider, storage_bucket, storage_path, expires_at, status, created_by, created_at, deleted_at | P1/P2 temporary/permanent exported file archive. |

## PRC

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| purchase_requests | id, company_id, brand_id, outlet_id, department_id, purchase_request_code, request_type, purpose, vendor_id, vendor_name_free_text, estimated_total_amount, actual_total_amount, risk_level, approval_request_id, status, requested_by, requested_at, approved_by, purchased_by, ordered_at, closed_by, notes, metadata, timestamps | Procurement header. Approval required by amount/risk. |
| purchase_request_lines | id, purchase_request_id, company_id, item_type, item_id, item_description, quantity, unit_id, estimated_unit_price, estimated_line_amount, actual_unit_price, actual_line_amount, needed_date, destination_storage_location_id, received_quantity_total, stocked_quantity_total, status, notes, timestamps | Line item/service/non-inventory/asset. |
| purchase_receipts | id, company_id, brand_id, outlet_id, purchase_request_id, receipt_code, received_by, received_at, validated_by, validated_at, status, invoice_number, delivery_note_number, notes, timestamps | Goods receipt header. One PR can have many receipts. |
| purchase_receipt_lines | id, purchase_receipt_id, purchase_request_line_id, company_id, item_id, received_quantity, unit_id, condition, destination_storage_location_id, stock_movement_id, stocked_quantity, status, notes, timestamps | Receipt line; good inventory item can create stock_in. |
| purchase_status_histories | id, purchase_request_id, company_id, action, previous_status, new_status, actor_user_id, actor_type, notes, metadata, created_at | Procurement timeline. |
| purchase_order_notes | id, purchase_request_id, company_id, note_type, note_text, created_by, timestamps, deleted_at | Optional process notes. |
| purchase_invoice_reviews | id, purchase_request_id, purchase_receipt_id, company_id, invoice_evidence_id, review_status, reviewed_by, reviewed_at, notes, timestamps | P1/P2 finance review. |

## CMP

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| complaints | id, company_id, brand_id, outlet_id, department_id, complaint_code, channel, category, severity, complaint_date, complaint_at, customer_name, customer_contact, customer_username, title, description, status, assigned_to, reported_by, resolved_by, closed_by, resolution_summary, requires_service_recovery, related_void_refund_id, risk_level, is_public, metadata, timestamps | Complaint header. Not full CRM; complaint control layer. |
| complaint_followups | id, complaint_id, company_id, followup_type, followup_text, visibility, created_by, timestamps, deleted_at | Follow-up timeline. |
| complaint_assignments | id, complaint_id, company_id, assigned_to, assigned_by, assignment_type, notes, assigned_at, unassigned_at, status | PIC assignment history. |
| complaint_status_histories | id, complaint_id, company_id, action, previous_status, new_status, actor_user_id, actor_type, notes, metadata, created_at | Status timeline. |
| complaint_sla_rules | id, company_id, channel, category, severity, first_response_minutes, resolution_minutes, escalate_after_minutes, is_active, created_by, timestamps | P1 SLA rules. |
| complaint_resolution_actions | id, complaint_id, company_id, action_type, description, amount, related_void_refund_id, status, created_by, completed_by, completed_at, timestamps | P1 service recovery/refund/voucher/etc. |
| complaint_links | id, complaint_id, company_id, related_module, related_record_type, related_record_id, link_type, linked_by, linked_at, status, notes | P1/P2 generic links. |

## VDR

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| void_refund_references | id, company_id, brand_id, outlet_id, department_id, vdr_code, pos_system, pos_transaction_id, pos_receipt_number, transaction_date, transaction_at, void_refund_date, void_refund_at, vdr_type, reason_category, reason_detail, amount, payment_method, cashier_user_id, cashier_name_free_text, requested_by, reviewed_by, approval_request_id, related_complaint_id, risk_level, status, review_notes, metadata, timestamps | Void/refund reference from Pawoon/POS. Control layer only. |
| void_refund_reviews | id, void_refund_reference_id, company_id, review_level, review_status, reviewed_by, reviewed_at, notes, timestamps | Multiple reviews by SPV/Manager/Finance/Direksi/Auditor. |
| void_refund_flags | id, void_refund_reference_id, company_id, flag_type, severity, source, flag_reason, created_by, resolved_by, resolution_notes, status, timestamps | Anomaly/fraud risk flags. |
| void_refund_status_histories | id, void_refund_reference_id, company_id, action, previous_status, new_status, actor_user_id, actor_type, notes, metadata, created_at | VDR timeline. |
| void_refund_line_items | id, void_refund_reference_id, company_id, item_name_snapshot, inventory_item_id, quantity, unit_price, line_amount, reason_detail, created_at | P1 line details. |
| void_refund_pos_links | id, void_refund_reference_id, company_id, pos_system, external_transaction_id, external_payload, matched_status, matched_at, created_at | P2 POS import/API link. |

## N8N

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| automation_workflows | id, company_id, workflow_code, workflow_name, workflow_type, module, trigger_event, n8n_workflow_id, webhook_url_key, schedule_cron, timezone, is_enabled, status, config_payload, created_by, approved_by, timestamps | Automation master config. |
| automation_logs | id, company_id, automation_workflow_id, workflow_code, trigger_type, trigger_event, related_module, related_record_type, related_record_id, idempotency_key, status, attempt_count, max_attempts, started_at, completed_at, next_retry_at, triggered_by, actor_type, input_payload, output_payload, error_message, audit_log_id, metadata, timestamps | Execution log. Idempotency key prevents duplicate. |
| notification_templates | id, company_id, template_code, template_name, channel, template_type, subject_template, body_template, variables_schema, language, version, is_active, status, created_by, approved_by, timestamps | Message template, versioned. |
| notification_queue | id, company_id, automation_log_id, notification_template_id, channel, priority, recipient_user_id, recipient_email, recipient_name, subject, body, related_module, related_record_type, related_record_id, status, scheduled_at, sent_at, expires_at, attempt_count, max_attempts, error_message, metadata, timestamps | Queue for email/in-app/dashboard/etc. |
| notification_delivery_logs | id, company_id, notification_queue_id, automation_log_id, channel, recipient_user_id, recipient_address, provider, provider_message_id, delivery_status, attempt_number, error_code, error_message, sent_at, created_at, metadata | Delivery attempt history. |
| notification_recipients | id, company_id, automation_workflow_id, recipient_type, user_id, role_id, department_id, custom_email, channel, priority, is_active, timestamps | Default recipients per workflow. |
| notification_preferences | id, company_id, user_id, module, notification_type, channel, is_enabled, mute_until, timestamps | P1 user preferences. |
| automation_webhook_events | id, company_id, automation_workflow_id, automation_log_id, direction, event_name, webhook_key, request_payload, response_payload, status_code, status, error_message, ip_address, created_at | Webhook debugging log. |
| automation_retry_policies | id, company_id, automation_workflow_id, max_attempts, backoff_type, initial_delay_seconds, max_delay_seconds, retry_on_statuses, is_active, created_by, timestamps | Retry configuration. |
| automation_failures | id, company_id, automation_log_id, automation_workflow_id, failure_type, severity, error_message, error_payload, status, assigned_to, resolved_by, resolved_at, resolution_notes, timestamps | Failures needing manual action. |

## DSH

| Table | Core Columns / Field Groups | Key Notes / Rules |
| --- | --- | --- |
| dashboard_widgets | id, company_id, widget_code, widget_name, module, widget_type, data_source_type, data_source_name, default_filter_payload, config_payload, refresh_interval_seconds, is_sensitive, status, created_by, timestamps | Widget definition. |
| dashboard_layouts | id, company_id, layout_code, layout_name, layout_scope, role_id, user_id, department_id, outlet_id, layout_payload, is_default, status, created_by, timestamps | Dashboard layout by role/user/department/company/outlet. |
| dashboard_metric_snapshots | id, company_id, brand_id, outlet_id, department_id, metric_code, metric_name, module, period_type, period_start, period_end, metric_value_number, metric_value_text, metric_payload, generated_by, generated_at, created_at | Trend/snapshot metrics. |
| dashboard_alerts | id, company_id, brand_id, outlet_id, department_id, alert_code, alert_type, severity, title, description, related_module, related_record_type, related_record_id, assigned_to, status, first_detected_at, last_detected_at, acknowledged_by, resolved_by, dismissed_by, resolution_notes, metadata, timestamps | Active alerts. |
| dashboard_alert_histories | id, dashboard_alert_id, company_id, action, previous_status, new_status, actor_user_id, actor_type, notes, metadata, created_at | Alert status history. |
| dashboard_user_preferences | id, company_id, user_id, preference_key, preference_value, timestamps | P1 user display preferences. |
| dashboard_view_logs | id, company_id, user_id, dashboard_type, layout_id, viewed_at, filter_payload, device_info, ip_address, metadata | P2 dashboard access log. |

# 5. Dashboard Views Catalog

| View | Purpose |
| --- | --- |
| vw_current_stock_summary | Summary current stock by item/storage/outlet with stock_status normal/critical/out_of_stock/unknown. |
| vw_stock_movement_summary | Summary movement count, total_in, total_out, net_quantity per item/date/type. |
| vw_stock_discrepancy_summary | Summary discrepancy from stock opname lines. |
| vw_daily_report_status | Daily report status, late flag, missing evidence count, validation info. |
| vw_report_compliance | Daily report compliance count and on-time rate. |
| vw_pending_approval_summary | Pending approval counts by module/request/risk/current approver. |
| vw_missing_evidence_summary | Records that require evidence but do not have active/locked evidence. |
| vw_high_risk_audit_events | Audit events with severity high/critical. |
| vw_complaint_summary | Complaint counts by outlet/channel/category/severity/status. |
| vw_vdr_summary | Void/refund counts and amount by outlet/type/reason/risk/status. |
| vw_procurement_summary | Purchase request counts and totals by outlet/department/status. |
| vw_automation_health_summary | Workflow execution health: success/failed/retrying counts. |

# 6. Cross-Module Constraints

| Area | Constraint |
| --- | --- |
| RBAC | All backend queries must enforce user_roles + role_permissions + scope. Frontend filters are not trusted. |
| No Self Approval | Requester cannot approve or review their own high-risk request. |
| Final Lock | Final/closed/locked data cannot be edited directly. Correction request is required. |
| Evidence Required | Emergency use, high discrepancy, refund, high/critical complaint, high-risk approval, and final correction require evidence. |
| Audit Required | Role changes, stock finalization, approval decisions, evidence operations, exports, VDR reviews, complaint closure, and dashboard alert actions require audit. |
| Stock Before Use | Item must be stocked before use. Emergency flow exists but requires reason/evidence/approval. |
| Export Scope | Exports must store filter_payload and scope_payload and must be generated by backend scope. |
| Duplicate Prevention | Use unique constraints and idempotency keys for daily reports, stock-in from receipt, automation, notification, export codes, and active approval per related record. |

# 7. Status Standards

| Status | Meaning / Use |
| --- | --- |
| draft | Created but not submitted. |
| submitted | Submitted by user for validation/approval. |
| pending_validation | Waiting SPV/Manager validation. |
| pending_approval | Waiting approver decision. |
| validated | Validated by authorized user. |
| approved | Approved by approver. |
| rejected | Rejected with notes. |
| revision_requested | Revision requested with notes. |
| revised | Revised by requester. |
| final | Finalized and locked. |
| closed | Completed/closed. |
| cancelled | Cancelled with reason. |
| archived | Archived/inactive for new transactions. |

# 8. Index Strategy

| Index Area | Recommended Focus |
| --- | --- |
| Scope | company_id, brand_id, outlet_id, department_id. |
| Status | status + created_at/date columns for queues and dashboard. |
| User | created_by, requested_by, assigned_to, current_approver_id. |
| Related Records | related_record_type + related_record_id. |
| Inventory | item_id + storage_location_id + outlet_id. |
| Audit | company_id + created_at, module + action, actor_user_id, record_type + record_id, severity. |
| Evidence | company_id + related_record_type + related_record_id. |
| Dashboard | status + severity + created_at for alerts. |
| Automation | idempotency_key, status + next_retry_at, related_record_type + related_record_id. |

# 9. Migration Strategy

| Migration Order | File / Scope |
| --- | --- |
| 001 | core_companies_brands_outlets_departments.sql |
| 002 | auth_users_tokens_events.sql |
| 003 | rbac_roles_permissions_user_roles.sql |
| 004 | audit_logs_base.sql |
| 005 | mdm_storage_categories_units_items_aliases.sql |
| 006 | inventory_core.sql |
| 007 | odr_reports_checklists_issues.sql |
| 008 | approval_core.sql |
| 009 | evidence_core.sql |
| 010 | export_core.sql |
| 011 | procurement.sql |
| 012 | complaints.sql |
| 013 | void_refund.sql |
| 014 | automation_notifications.sql |
| 015 | dashboard_tables.sql |
| 016 | dashboard_views.sql |
| 017 | seed_data.sql |
| 018 | indexes.sql |
| 019 | functions_triggers.sql |
| 020 | rls_policies_optional.sql |

# 10. Seed Data Strategy

| Seed Area | Values |
| --- | --- |
| Company | EGG - Easy Going Group |
| Brands | BTMK, BTMF, TSF, HCP, EGC, ENC, FRC |
| MVP Outlets | BTMK, BTMF |
| Departments | INV, FIN, OPS, HR, COM, MED, AUD, KTN, CSR, TECH |
| Roles | SUPER_ADMIN, ERP_OWNER, DIREKSI, MANAGER_INVENTORY, MANAGER_FINANCE, MANAGER_OPS_HR, MANAGER_COMMERCIAL, SPV_OUTLET, STAFF, FREELANCE, AUDITOR |
| Starter Items | Nugget, Sosis, Ayam Ungkep, Katsu, Baso Topping, Dumpling, Pokpok, Telur, Kentang, Otak-Otak, Cireng, Roti, Keju, Gula, Saus, Masako, Sedotan, Kental Manis, Garam, Saori, Ladaku, Mineral Water, Yakult, Minyak, Tepung Dkriuk, Ultra Mimi, Vanilla, Mangga |
| Starter Aliases | Telur: Telor/Telur Kitchen; Saus: Saos; Tepung Dkriuk: Tepunh Dkriuk; Nugget: Nuget; Kental Manis: SKM; Otak-Otak: Otak; Mineral Water: Mineral |

# 11. Database Function & Trigger Recommendation

| Function / Trigger | Purpose / Caution |
| --- | --- |
| set_updated_at() | DB trigger for updated_at. Safe and recommended. |
| generate_code() | Backend or DB helper for business codes. Frontend must not generate official code. |
| normalize_alias() | Normalize item alias: lowercase, trim, remove duplicate spaces, remove unnecessary punctuation. |
| update_current_stock() | Can be backend service or DB transaction helper. Avoid complex business logic hidden only in trigger. |
| create_audit_log() | Optional DB helper, but backend should control audit payload. |
| calculate_risk_level() | Backend service recommended; DB helper optional. |
| calculate_report_late() | Backend or DB helper using outlet schedule/deadline. |

# 12. Security Baseline

| Security Rule | Decision |
| --- | --- |
| Password hash only | Mandatory |
| Token hash only | Mandatory |
| Secret/API key not logged | Mandatory |
| RBAC backend check | Mandatory |
| Evidence private bucket | Recommended |
| Sensitive export audit | Mandatory |
| User inactive cannot login | Mandatory |
| No self-approval | Mandatory |
| Audit high-risk actions | Mandatory |
| Healthopia patient data | Excluded from MVP |

# 13. UAT Master Checklist

| Test | Expected Result |
| --- | --- |
| Create company/brand/outlet | Success |
| Create user and assign role | Success; audit role assignment. |
| Login inactive user | Blocked. |
| Create duplicate item alias | Blocked. |
| Stock movement final | current_stocks updated. |
| Negative stock | Blocked by default. |
| Submit incomplete daily report | Blocked. |
| Missing required evidence | Blocked or flagged based on rule. |
| Requester self-approval | Blocked. |
| Upload valid evidence | Success and linked. |
| Final record locks evidence | Success. |
| Export report | export_logs + audit_logs created. |
| Critical action | audit_logs severity critical and dashboard alert. |
| User access outside scope | Denied + audit access_denied. |

# 14. Open Decisions Before Production

| Area | Open Decision |
| --- | --- |
| Tech Stack | Cloudflare Workers + Hono, PostgreSQL via Hyperdrive, Drizzle ORM. |
| Storage Provider | Cloudflare R2. |
| Email Provider | Resend / SMTP / SES. |
| n8n Hosting | Cloud / self-host. |
| Approval Limits | Final amount/risk thresholds. |
| Daily Report Deadline | Final per outlet. |
| Checklist Templates | Final opening/closing checklist per outlet. |
| Initial Stock | Need cleaned item + alias + unit + storage data. |
| User Roles | Need final user-role-scope mapping. |
| Dashboard Wireframe | Need final UI by role. |
