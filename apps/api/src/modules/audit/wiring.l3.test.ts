import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray } from 'drizzle-orm'
import * as schema from '@egg-os/db'
import {
  auditLogs,
  brands,
  companies,
  dailyReports,
  itemCategories,
  items,
  outlets,
  pendingStockMovements,
  permissions,
  rolePermissions,
  roles,
  stockBalances,
  userRoles,
  users,
  units,
} from '@egg-os/db'
import type { Db } from '../../lib/db'
import type { AccessFilter } from '../rbac/middleware'
import { createStockIn, type InventoryServiceContext } from '../inventory/service'
import { submitApproval, finalizeApproval } from '../inventory/approval.service'
import { createTransfer } from '../inventory/transfer.service'
import { createItem, updateItem } from '../inventory/master-data.service'
import { createDraft, submitReport, updateReport } from '../report/service'
import { requestUpload, type EvidenceDeps } from '../evidence/service'

const COMPANY_ID = 'af000000-0000-4000-8000-000000000001'
const BRAND_ID = 'af000000-0000-4000-8000-000000000002'
const OUTLET_A_ID = 'af000000-0000-4000-8000-000000000003'
const OUTLET_B_ID = 'af000000-0000-4000-8000-000000000004'
const IN_TRANSIT_ID = 'af000000-0000-4000-8000-000000000005'
const ACTOR_ID = 'af000000-0000-4000-8000-000000000010'
const ACTOR2_ID = 'af000000-0000-4000-8000-000000000011'
const TEST_ROLE_ID = 'af000000-0000-4000-8000-000000000020'
const UNIT_ID = 'af000000-0000-4000-8000-000000000030'
const CATEGORY_ID = 'af000000-0000-4000-8000-000000000031'
const ITEM_ID = 'af000000-0000-4000-8000-000000000040'
const REPORT_ID = 'af000000-0000-4000-8000-000000000050'

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql, { schema }) as unknown as Db

function accessFilter(permission: string, outletId: string): AccessFilter {
  return {
    permission,
    ownOnly: false,
    assignedOnly: false,
    rowLevelScopes: [],
    structuralScopes: [{ scopeType: 'outlet', scopeId: outletId }],
  }
}

function invCtx(permission: string, outletId = OUTLET_A_ID, actorUserId = ACTOR_ID): InventoryServiceContext {
  return { companyId: COMPANY_ID, actorUserId, accessFilter: accessFilter(permission, outletId) }
}

const mockDeps: EvidenceDeps = {
  bucket: { head: async () => ({ size: 1024 }), delete: async () => {} },
  presigner: {
    presignPut: async () => 'https://mock-put-url',
    presignGet: async () => 'https://mock-get-url',
  },
}

async function cleanupAll() {
  await sql`DELETE FROM user_roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM role_permissions WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM roles WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM audit_logs WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM evidence WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM daily_reports WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM report_checklist_answers WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM stock_transfers WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM pending_stock_movements WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM stock_movements WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM stock_balances WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM item_unit_conversions WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM items WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM units WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM item_categories WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM users WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM outlets WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM brands WHERE company_id = ${COMPANY_ID}`
  await sql`DELETE FROM companies WHERE id = ${COMPANY_ID}`
}

beforeAll(async () => {
  await cleanupAll()

  await db.insert(companies).values({ id: COMPANY_ID, companyCode: 'AFL3', companyName: 'L3 Wiring Co', status: 'active' })
  await db.insert(brands).values({ id: BRAND_ID, companyId: COMPANY_ID, brandCode: 'BL3', brandName: 'Brand L3', status: 'active' })
  await db.insert(outlets).values({ id: OUTLET_A_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'OAL3', outletName: 'Outlet A L3', status: 'active', outletType: 'operational' })
  await db.insert(outlets).values({ id: OUTLET_B_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'OBL3', outletName: 'Outlet B L3', status: 'active', outletType: 'operational' })
  await db.insert(outlets).values({ id: IN_TRANSIT_ID, companyId: COMPANY_ID, brandId: BRAND_ID, outletCode: 'OINTL3', outletName: 'In Transit L3', status: 'active', outletType: 'in_transit' })

  await db.insert(users).values({ id: ACTOR_ID, companyId: COMPANY_ID, email: 'l3-actor@af.test', fullName: 'L3 Actor', status: 'active', firstLoginRequired: false })
  await db.insert(users).values({ id: ACTOR2_ID, companyId: COMPANY_ID, email: 'l3-actor2@af.test', fullName: 'L3 Actor2', status: 'active', firstLoginRequired: false })

  await db.insert(units).values({ id: UNIT_ID, companyId: COMPANY_ID, code: 'L3PCS', name: 'L3 Pieces' })
  await db.insert(itemCategories).values({ id: CATEGORY_ID, companyId: COMPANY_ID, code: 'L3CAT', name: 'L3 Category' })
  await db.insert(items).values({ id: ITEM_ID, companyId: COMPANY_ID, sku: 'L3-SKU-001', name: 'L3 Item', baseUnitId: UNIT_ID, categoryId: CATEGORY_ID })

  // Pre-seed stock balance in OUTLET_A for transfer tests
  await db.insert(stockBalances).values({ companyId: COMPANY_ID, itemId: ITEM_ID, outletId: OUTLET_A_ID, qtyBase: '100.000000', updatedAt: new Date() }).onConflictDoNothing()

  // Pre-seed a daily report in OUTLET_A for updateReport (noise gate) and evidence tests
  await db.insert(dailyReports).values({
    id: REPORT_ID,
    companyId: COMPANY_ID,
    outletId: OUTLET_A_ID,
    reportType: 'opening',
    reportDate: '2026-01-01',
    status: 'draft',
    createdBy: ACTOR_ID,
  })

  // Role with all needed permissions
  await db.insert(roles).values({ id: TEST_ROLE_ID, companyId: COMPANY_ID, code: 'L3_ADMIN', name: 'L3 Admin', defaultScopeType: 'global', isSystem: false })

  const permsNeeded = [
    'inventory.read', 'inventory.stock_in', 'inventory.stock_out', 'inventory.opname', 'inventory.waste',
    'inventory.transfer_send', 'inventory.transfer_receive',
    'inventory.approval_submit', 'inventory.approval_validate', 'inventory.approval_finalize',
    'inventory.item_manage',
    'report.read', 'report.submit', 'report.validate',
    'evidence.upload', 'evidence.read',
  ]
  const permRows = await db
    .select({ id: permissions.id, code: permissions.code })
    .from(permissions)
    .where(inArray(permissions.code, permsNeeded))
  if (permRows.length > 0) {
    await db.insert(rolePermissions).values(
      permRows.map((p) => ({ roleId: TEST_ROLE_ID, permissionId: p.id, companyId: COMPANY_ID }))
    ).onConflictDoNothing()
  }

  for (const userId of [ACTOR_ID, ACTOR2_ID]) {
    await db.insert(userRoles).values({
      userId,
      roleId: TEST_ROLE_ID,
      companyId: COMPANY_ID,
      scopeType: 'global',
      scopeId: null,
      grantedBy: ACTOR_ID,
    }).onConflictDoNothing()
  }
})

afterEach(async () => {
  await sql`DELETE FROM audit_logs WHERE company_id = ${COMPANY_ID}`
})

afterAll(async () => {
  await cleanupAll()
  await sql.end()
})

describe('AUDIT 4B L3 — wiring smoke tests', () => {
  it('inventory.stock_in → 1 baris audit, recordType=stock_movement, meta.item_id ada', async () => {
    const ctx = invCtx('inventory.stock_in')
    await createStockIn(db, ctx, { itemId: ITEM_ID, outletId: OUTLET_A_ID, qty: '5', unitId: UNIT_ID })

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('inventory.stock_in')
    expect(rows[0].recordType).toBe('stock_movement')
    expect(rows[0].outletId).toBe(OUTLET_A_ID)
    const meta = rows[0].meta as Record<string, unknown>
    expect(meta?.item_id).toBe(ITEM_ID)
    expect(meta?.qty_base).toBeDefined()
  })

  it('inventory.approval_submit → 1 baris audit inventory.approval_submit', async () => {
    const ctx = invCtx('inventory.approval_submit')
    await submitApproval(db, ctx, { movementType: 'opname', itemId: ITEM_ID, outletId: OUTLET_A_ID, qty: '10', unitId: UNIT_ID })

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('inventory.approval_submit')
    expect(rows[0].recordType).toBe('pending_stock_movement')
    const meta = rows[0].meta as Record<string, unknown>
    expect(meta?.movement_type).toBe('opname')
    expect(meta?.item_id).toBe(ITEM_ID)
  })

  it('inventory.approval_finalize (opname) → TEPAT 1 baris (tidak double dari applyOpnameToLedger)', async () => {
    // Seed pending row in 'validated' status directly (no audit rows created)
    const [pending] = await db.insert(pendingStockMovements).values({
      companyId: COMPANY_ID,
      itemId: ITEM_ID,
      outletId: OUTLET_A_ID,
      movementType: 'opname',
      inputQty: '10.000000',
      inputUnitId: UNIT_ID,
      qtyBase: '10.000000',
      status: 'validated',
      submittedBy: ACTOR2_ID,
      validatedBy: ACTOR_ID,
      validatedAt: new Date(),
    }).returning()

    const ctx = invCtx('inventory.approval_finalize', OUTLET_A_ID, ACTOR_ID)
    await finalizeApproval(db, ctx, pending.id)

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('inventory.approval_finalize')
    expect(rows[0].recordType).toBe('pending_stock_movement')
    const meta = rows[0].meta as Record<string, unknown>
    expect(meta?.movement_type).toBe('opname')
    expect(meta?.movement_id).toBeDefined()
  })

  it('inventory.transfer_create → 1 baris audit, recordType=stock_transfer', async () => {
    const ctx = invCtx('inventory.transfer_send')
    await createTransfer(db, ctx, {
      itemId: ITEM_ID,
      fromOutletId: OUTLET_A_ID,
      toOutletId: OUTLET_B_ID,
      qty: '5',
      unitId: UNIT_ID,
    })

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('inventory.transfer_create')
    expect(rows[0].recordType).toBe('stock_transfer')
    expect(rows[0].outletId).toBe(OUTLET_A_ID)
    const meta = rows[0].meta as Record<string, unknown>
    expect(meta?.item_id).toBe(ITEM_ID)
    expect(meta?.from_outlet_id).toBe(OUTLET_A_ID)
    expect(meta?.to_outlet_id).toBe(OUTLET_B_ID)
  })

  it('inventory.item_create → 1 baris audit, meta.sku ada', async () => {
    const ctx = { companyId: COMPANY_ID, actorUserId: ACTOR_ID }
    await createItem(db, ctx, { sku: 'L3-NEW-SKU', name: 'L3 New Item', baseUnitId: UNIT_ID })

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('inventory.item_create')
    expect(rows[0].recordType).toBe('item')
    const meta = rows[0].meta as Record<string, unknown>
    expect(meta?.sku).toBe('L3-NEW-SKU')
  })

  it('inventory.item_update → 1 baris audit, meta.changed_fields ada', async () => {
    const ctx = { companyId: COMPANY_ID, actorUserId: ACTOR_ID }
    await updateItem(db, ctx, ITEM_ID, { name: 'L3 Item Updated' })

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('inventory.item_update')
    expect(rows[0].recordType).toBe('item')
    expect(rows[0].recordId).toBe(ITEM_ID)
    const meta = rows[0].meta as Record<string, unknown>
    expect(Array.isArray(meta?.changed_fields)).toBe(true)
    expect((meta?.changed_fields as string[]).includes('name')).toBe(true)
  })

  it('report.draft_create → 1 baris audit, recordType=daily_report', async () => {
    const ctx = { companyId: COMPANY_ID, actorUserId: ACTOR_ID, accessFilter: accessFilter('report.submit', OUTLET_A_ID) }
    await createDraft(db, ctx, { outletId: OUTLET_A_ID, reportType: 'closing', reportDate: '2026-01-02' })

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('report.draft_create')
    expect(rows[0].recordType).toBe('daily_report')
    expect(rows[0].outletId).toBe(OUTLET_A_ID)
    const meta = rows[0].meta as Record<string, unknown>
    expect(meta?.report_type).toBe('closing')
  })

  it('report.submit → 1 baris audit action=report.submit', async () => {
    // Seed a draft report directly (no audit row from createDraft)
    const [report] = await db.insert(dailyReports).values({
      companyId: COMPANY_ID,
      outletId: OUTLET_A_ID,
      reportType: 'opening',
      reportDate: '2026-01-03',
      status: 'draft',
      createdBy: ACTOR_ID,
    }).returning()

    const ctx = { companyId: COMPANY_ID, actorUserId: ACTOR_ID, accessFilter: accessFilter('report.submit', OUTLET_A_ID) }
    await submitReport(db, ctx, report.id)

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('report.submit')
    expect(rows[0].recordType).toBe('daily_report')
    expect(rows[0].recordId).toBe(report.id)
  })

  it('report.update (noise gate) → 0 baris audit', async () => {
    // Use pre-seeded REPORT_ID (draft status, inserted in beforeAll)
    const ctx = { companyId: COMPANY_ID, actorUserId: ACTOR_ID, accessFilter: accessFilter('report.submit', OUTLET_A_ID) }
    await updateReport(db, ctx, REPORT_ID, { notes: 'noise gate test' })

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(0)
  })

  it('evidence.request_upload → 1 baris audit (mock deps)', async () => {
    // REPORT_ID (pre-seeded) is a draft daily_report — resolveRecord returns it
    const ctx = { companyId: COMPANY_ID, actorUserId: ACTOR_ID, accessFilter: accessFilter('evidence.upload', OUTLET_A_ID) }
    await requestUpload(db, mockDeps, ctx, {
      recordType: 'daily_report',
      recordId: REPORT_ID,
      fileName: 'test.jpg',
      contentType: 'image/jpeg',
      fileSize: 1024,
    })

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('evidence.request_upload')
    expect(rows[0].recordType).toBe('evidence')
    const meta = rows[0].meta as Record<string, unknown>
    expect(meta?.file_name).toBe('test.jpg')
    expect(meta?.record_type).toBe('daily_report')
  })
})
