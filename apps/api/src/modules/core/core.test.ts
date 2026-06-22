import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, isNull, sql as drizzleSql } from 'drizzle-orm'
import app from '../../index'
import { brands, companies, departments, outlets, users } from '@egg-os/db'
import { seedCore } from '../../../../../packages/db/seeds/01-core'
import { signAccessToken } from '../../lib/jwt'

const TEST_ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_ACCESS_SECRET: 'dev-egg-os-jwt-secret-change-in-production-min32chars',
}

const sql = postgres(process.env.DATABASE_URL!)
const db = drizzle(sql)

let eggToken: string
let companyBId: string | undefined

async function req(path: string, token?: string) {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await app.request(`http://localhost${path}`, { method: 'GET', headers }, TEST_ENV)
  return { status: res.status, body: await res.json() }
}

describe('CORE', () => {
  beforeAll(async () => {
    await seedCore(db)

    const [eggCompany] = await db
      .select()
      .from(companies)
      .where(eq(companies.companyCode, 'EGG'))
      .limit(1)

    await db.insert(users).values({
      companyId: eggCompany.id,
      email: 'core-test@egg.test',
      fullName: 'Core Test User',
      status: 'active',
      firstLoginRequired: false,
    }).onConflictDoNothing()

    const [testUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'core-test@egg.test'))
      .limit(1)

    eggToken = await signAccessToken(
      {
        sub: testUser.id,
        company_id: testUser.companyId,
        roles: [],
        scopes: [],
        first_login_required: false,
      },
      TEST_ENV.JWT_ACCESS_SECRET
    )
  })

  afterAll(async () => {
    await db.delete(users).where(eq(users.email, 'core-test@egg.test'))
    if (companyBId) {
      await db.delete(brands).where(eq(brands.companyId, companyBId))
      await db.delete(users).where(eq(users.companyId, companyBId))
      await db.delete(companies).where(eq(companies.id, companyBId))
    }
    await sql.end()
  })

  it('SP1A seed data is idempotent and available', async () => {
    await seedCore(db)

    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.companyCode, 'EGG'))
      .limit(1)

    expect(company?.companyName).toBe('Easy Going Group')

    const [brandCount] = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(brands)
      .where(isNull(brands.deletedAt))

    const [outletCount] = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(outlets)
      .where(isNull(outlets.deletedAt))

    const [departmentCount] = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(departments)
      .where(isNull(departments.deletedAt))

    expect(brandCount.count).toBeGreaterThanOrEqual(6)
    expect(outletCount.count).toBeGreaterThanOrEqual(2)
    expect(departmentCount.count).toBeGreaterThanOrEqual(6)
  })

  it('GET /api/v1/companies requires auth (401 without token)', async () => {
    const { status } = await req('/api/v1/companies')
    expect(status).toBe(401)
  })

  it('GET /api/v1/companies returns EGG', async () => {
    const { status, body } = await req('/api/v1/companies', eggToken)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          company_code: 'EGG',
          company_name: 'Easy Going Group',
        }),
      ])
    )
  })

  it('GET /api/v1/brands returns EGG brands', async () => {
    const { status, body } = await req('/api/v1/brands', eggToken)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.map((brand: { brand_code: string }) => brand.brand_code)).toEqual(
      expect.arrayContaining(['BTMK', 'BTMF', 'TSF', 'HCP', 'ENC', 'FRC'])
    )
  })

  it('GET /api/v1/outlets filters by brand_id', async () => {
    const [brand] = await db
      .select()
      .from(brands)
      .where(eq(brands.brandCode, 'BTMK'))
      .limit(1)

    const { status, body } = await req(`/api/v1/outlets?brand_id=${brand.id}`, eggToken)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outlet_code: 'BTMK-01' }),
      ])
    )
  })

  it('GET /api/v1/departments filters by outlet_id', async () => {
    const [outlet] = await db
      .select()
      .from(outlets)
      .where(eq(outlets.outletCode, 'BTMK-01'))
      .limit(1)

    const { status, body } = await req(`/api/v1/departments?outlet_id=${outlet.id}`, eggToken)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.map((department: { department_code: string }) => department.department_code)).toEqual(
      expect.arrayContaining(['KITCHEN', 'SERVICE', 'INVENTORY'])
    )
  })

  it('GET /api/v1/outlets rejects invalid UUID filters', async () => {
    const { status, body } = await req('/api/v1/outlets?brand_id=not-a-uuid', eggToken)

    expect(status).toBe(422)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('ERR_VALIDATION')
  })

  it('GET /api/v1/brands does not return other company data (tenant isolation)', async () => {
    const [newCompanyB] = await db.insert(companies).values({
      companyCode: 'TST-ISOL',
      companyName: 'Isolation Test Company B',
      status: 'active',
    }).returning()
    companyBId = newCompanyB.id

    await db.insert(brands).values({
      companyId: companyBId,
      brandCode: 'ISOL-BRAND',
      brandName: 'Isolation Brand',
      status: 'active',
    })

    await db.insert(users).values({
      companyId: companyBId,
      email: 'user-b@isoltest.test',
      fullName: 'User B',
      status: 'active',
      firstLoginRequired: false,
    })

    const [userB] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'user-b@isoltest.test'))
      .limit(1)

    const tokenB = await signAccessToken(
      {
        sub: userB.id,
        company_id: userB.companyId,
        roles: [],
        scopes: [],
        first_login_required: false,
      },
      TEST_ENV.JWT_ACCESS_SECRET
    )

    // EGG user must NOT see ISOL-BRAND
    const { body: bodyEgg } = await req('/api/v1/brands', eggToken)
    const eggCodes = bodyEgg.data.map((b: { brand_code: string }) => b.brand_code)
    expect(eggCodes).not.toContain('ISOL-BRAND')

    // Company B user must see ISOL-BRAND but NOT BTMK
    const { body: bodyB } = await req('/api/v1/brands', tokenB)
    const bCodes = bodyB.data.map((b: { brand_code: string }) => b.brand_code)
    expect(bCodes).toContain('ISOL-BRAND')
    expect(bCodes).not.toContain('BTMK')
  })
})
