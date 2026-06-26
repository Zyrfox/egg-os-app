import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '@egg-os/db'
import { companies } from '@egg-os/db'
import type { Db } from '../../lib/db'
import {
  addItemUnitConversion,
  createCategory,
  createItem,
  createUnit,
  getItem,
  listCategories,
  listItems,
  listUnits,
  updateItem,
} from './master-data.service'
import { InventoryServiceError, type InventoryServiceContext } from './service'

const sql = postgres(process.env.DATABASE_URL!)
// The schema-aware drizzle test client is structurally compatible with the app Db alias.
const db = drizzle(sql, { schema }) as unknown as Db

const COMPANY_ID = '95000000-0000-4000-8000-000000000001'
const OTHER_COMPANY_ID = '95000000-0000-4000-8000-000000000002'
const ACTOR_USER_ID = '95000000-0000-4000-8000-000000000003'
const OTHER_ACTOR_USER_ID = '95000000-0000-4000-8000-000000000004'

const ctx: InventoryServiceContext = {
  companyId: COMPANY_ID,
  actorUserId: ACTOR_USER_ID,
}

const otherCtx: InventoryServiceContext = {
  companyId: OTHER_COMPANY_ID,
  actorUserId: OTHER_ACTOR_USER_ID,
}

async function cleanupFixtures() {
  await sql`DELETE FROM stock_transfers WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_movements WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM stock_balances WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM item_unit_conversions WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM items WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM units WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM item_categories WHERE company_id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
  await sql`DELETE FROM companies WHERE id IN (${COMPANY_ID}, ${OTHER_COMPANY_ID})`
}

async function seedCompanies() {
  await db.insert(companies).values([
    {
      id: COMPANY_ID,
      companyCode: 'INV-MD-A',
      companyName: 'Inventory Master Data A',
      status: 'active',
    },
    {
      id: OTHER_COMPANY_ID,
      companyCode: 'INV-MD-B',
      companyName: 'Inventory Master Data B',
      status: 'active',
    },
  ])
}

async function seedBaseItem(sku = 'MD-ITEM') {
  const baseUnit = await createUnit(db, ctx, { code: `${sku}-PCS`, name: `${sku} Pieces` })
  const category = await createCategory(db, ctx, { code: `${sku}-CAT`, name: `${sku} Category` })
  const item = await createItem(db, ctx, {
    sku,
    name: `${sku} Name`,
    categoryId: category.id,
    baseUnitId: baseUnit.id,
    pawoonRef: null,
  })

  return { baseUnit, category, item }
}

async function expectServiceError(promise: Promise<unknown>, status: number, code: string) {
  try {
    await promise
    throw new Error('expected service error')
  } catch (error) {
    expect(error).toBeInstanceOf(InventoryServiceError)
    expect((error as InventoryServiceError).status).toBe(status)
    expect((error as InventoryServiceError).code).toBe(code)
  }
}

beforeEach(async () => {
  await cleanupFixtures()
  await seedCompanies()
})

afterAll(async () => {
  await cleanupFixtures()
  await sql.end()
})

describe('inventory master-data service', () => {
  it('N1 creates item with base unit and optional category', async () => {
    const baseUnit = await createUnit(db, ctx, { code: 'PCS', name: 'Pieces' })
    const category = await createCategory(db, ctx, { code: 'RAW', name: 'Raw Material' })

    const item = await createItem(db, ctx, {
      sku: 'SKU-001',
      name: 'Chicken Egg',
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      pawoonRef: 'PW-001',
    })

    expect(item).toMatchObject({
      company_id: COMPANY_ID,
      sku: 'SKU-001',
      name: 'Chicken Egg',
      category_id: category.id,
      base_unit_id: baseUnit.id,
      pawoon_ref: 'PW-001',
      is_active: true,
    })
  })

  it('N2 rejects duplicate active SKU in the same company', async () => {
    const { baseUnit, category } = await seedBaseItem('DUP-SKU')

    await expectServiceError(
      createItem(db, ctx, {
        sku: 'DUP-SKU',
        name: 'Duplicate',
        categoryId: category.id,
        baseUnitId: baseUnit.id,
        pawoonRef: null,
      }),
      409,
      'ERR_DUPLICATE',
    )
  })

  it('N3 rejects conversion factor <= 0 as validation error', async () => {
    const { item } = await seedBaseItem('BAD-FACTOR')
    const boxUnit = await createUnit(db, ctx, { code: 'BOX', name: 'Box' })

    await expectServiceError(
      addItemUnitConversion(db, ctx, item.id, {
        fromUnitId: boxUnit.id,
        factorToBase: '0',
      }),
      422,
      'ERR_VALIDATION',
    )
  })

  it('N4 returns item detail with unit conversions', async () => {
    const { item } = await seedBaseItem('DETAIL')
    const boxUnit = await createUnit(db, ctx, { code: 'DETAIL-BOX', name: 'Detail Box' })

    const conversion = await addItemUnitConversion(db, ctx, item.id, {
      fromUnitId: boxUnit.id,
      factorToBase: '12',
    })
    const detail = await getItem(db, ctx, item.id)

    expect(conversion.factor_to_base).toBe('12.000000')
    expect(detail.item.id).toBe(item.id)
    expect(detail.conversions).toHaveLength(1)
    expect(detail.conversions[0]).toMatchObject({
      item_id: item.id,
      from_unit_id: boxUnit.id,
      factor_to_base: '12.000000',
    })
  })

  it('rejects duplicate unit, category, and item conversion keys', async () => {
    const { item } = await seedBaseItem('DUP-KEY')
    const boxUnit = await createUnit(db, ctx, { code: 'DUP-BOX', name: 'Duplicate Box' })
    await addItemUnitConversion(db, ctx, item.id, {
      fromUnitId: boxUnit.id,
      factorToBase: '24',
    })

    await expectServiceError(createUnit(db, ctx, { code: 'DUP-KEY-PCS', name: 'Again' }), 409, 'ERR_DUPLICATE')
    await expectServiceError(createCategory(db, ctx, { code: 'DUP-KEY-CAT', name: 'Again' }), 409, 'ERR_DUPLICATE')
    await expectServiceError(
      addItemUnitConversion(db, ctx, item.id, {
        fromUnitId: boxUnit.id,
        factorToBase: '24',
      }),
      409,
      'ERR_DUPLICATE',
    )
  })

  it('lists items with tenant isolation, pagination, category filter, and active filter', async () => {
    const baseUnit = await createUnit(db, ctx, { code: 'ITM-PCS', name: 'Pieces' })
    const category = await createCategory(db, ctx, { code: 'ITM-CAT', name: 'Item Category' })
    const otherCategory = await createCategory(db, ctx, { code: 'ITM-OTHER', name: 'Other Category' })
    const otherCompanyUnit = await createUnit(db, otherCtx, { code: 'ITM-PCS', name: 'Other Pieces' })

    const first = await createItem(db, ctx, {
      sku: 'A-ITEM',
      name: 'A Item',
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      pawoonRef: null,
    })
    await createItem(db, ctx, {
      sku: 'B-ITEM',
      name: 'B Item',
      categoryId: category.id,
      baseUnitId: baseUnit.id,
      pawoonRef: null,
    })
    const inactive = await createItem(db, ctx, {
      sku: 'C-ITEM',
      name: 'C Item',
      categoryId: otherCategory.id,
      baseUnitId: baseUnit.id,
      pawoonRef: null,
    })
    await updateItem(db, ctx, inactive.id, { isActive: false })
    await createItem(db, otherCtx, {
      sku: 'Z-OTHER',
      name: 'Other Company Item',
      categoryId: null,
      baseUnitId: otherCompanyUnit.id,
      pawoonRef: null,
    })

    const page1 = await listItems(db, ctx, { page: 1, pageSize: 2 })
    const page2 = await listItems(db, ctx, { page: 2, pageSize: 2 })
    const byCategory = await listItems(db, ctx, { categoryId: category.id })
    const activeOnly = await listItems(db, ctx, { isActive: true })

    expect(page1.meta).toEqual({ page: 1, page_size: 2, total: 3 })
    expect(page1.data.map((row) => row.sku)).toEqual(['A-ITEM', 'B-ITEM'])
    expect(page2.data.map((row) => row.sku)).toEqual(['C-ITEM'])
    expect(byCategory.data.map((row) => row.id)).toEqual([first.id, expect.any(String)])
    expect(activeOnly.data.map((row) => row.sku)).toEqual(['A-ITEM', 'B-ITEM'])
  })

  it('lists units and categories with tenant isolation and pagination', async () => {
    await Promise.all([
      createUnit(db, ctx, { code: 'A-UNIT', name: 'A Unit' }),
      createUnit(db, ctx, { code: 'B-UNIT', name: 'B Unit' }),
      createUnit(db, ctx, { code: 'C-UNIT', name: 'C Unit' }),
      createUnit(db, otherCtx, { code: 'Z-UNIT', name: 'Other Unit' }),
      createCategory(db, ctx, { code: 'A-CAT', name: 'A Category' }),
      createCategory(db, ctx, { code: 'B-CAT', name: 'B Category' }),
      createCategory(db, ctx, { code: 'C-CAT', name: 'C Category' }),
      createCategory(db, otherCtx, { code: 'Z-CAT', name: 'Other Category' }),
    ])

    const unitsPage = await listUnits(db, ctx, { page: 1, pageSize: 2 })
    const categoriesPage = await listCategories(db, ctx, { page: 2, pageSize: 2 })

    expect(unitsPage.meta).toEqual({ page: 1, page_size: 2, total: 3 })
    expect(unitsPage.data.map((row) => row.code)).toEqual(['A-UNIT', 'B-UNIT'])
    expect(categoriesPage.meta).toEqual({ page: 2, page_size: 2, total: 3 })
    expect(categoriesPage.data.map((row) => row.code)).toEqual(['C-CAT'])
  })

  it('updates item fields and rejects cross-company updates', async () => {
    const { item } = await seedBaseItem('UPDATE')
    const nextCategory = await createCategory(db, ctx, { code: 'UPDATE-NEXT', name: 'Updated Category' })
    const otherCompanyUnit = await createUnit(db, otherCtx, { code: 'UPDATE-PCS', name: 'Other Pieces' })
    const otherCompanyItem = await createItem(db, otherCtx, {
      sku: 'UPDATE-OTHER',
      name: 'Other Item',
      categoryId: null,
      baseUnitId: otherCompanyUnit.id,
      pawoonRef: null,
    })

    const updated = await updateItem(db, ctx, item.id, {
      name: 'Updated Item',
      categoryId: nextCategory.id,
      isActive: false,
    })

    expect(updated).toMatchObject({
      id: item.id,
      name: 'Updated Item',
      category_id: nextCategory.id,
      is_active: false,
    })
    await expectServiceError(updateItem(db, ctx, otherCompanyItem.id, { name: 'Nope' }), 404, 'ERR_OUT_OF_SCOPE')
  })

  it('returns 404 for cross-company item and conversion resources', async () => {
    const otherCompanyUnit = await createUnit(db, otherCtx, { code: 'CROSS-PCS', name: 'Other Pieces' })
    const otherCompanyItem = await createItem(db, otherCtx, {
      sku: 'CROSS-ITEM',
      name: 'Cross Company Item',
      categoryId: null,
      baseUnitId: otherCompanyUnit.id,
      pawoonRef: null,
    })
    const localUnit = await createUnit(db, ctx, { code: 'CROSS-LOCAL', name: 'Local Unit' })

    await expectServiceError(getItem(db, ctx, otherCompanyItem.id), 404, 'ERR_OUT_OF_SCOPE')
    await expectServiceError(
      addItemUnitConversion(db, ctx, otherCompanyItem.id, {
        fromUnitId: localUnit.id,
        factorToBase: '2',
      }),
      404,
      'ERR_OUT_OF_SCOPE',
    )
  })
})

