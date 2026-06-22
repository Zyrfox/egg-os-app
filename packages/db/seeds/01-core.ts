import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config } from 'dotenv'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq } from 'drizzle-orm'
import {
  brands,
  companies,
  departments,
  outlets,
} from '../src/schema/core'

config({ path: resolve(__dirname, '../../../.env') })

type SeedDb = ReturnType<typeof drizzle>

const CORE_SEED = {
  company: {
    companyCode: 'EGG',
    companyName: 'Easy Going Group',
    legalName: 'Easy Going Group',
  },
  brands: [
    { brandCode: 'BTMK', brandName: 'Betamek', brandType: 'fnb' },
    { brandCode: 'BTMF', brandName: 'Betamorf', brandType: 'fnb' },
    { brandCode: 'TSF', brandName: 'The Social Food', brandType: 'fnb' },
    { brandCode: 'HCP', brandName: 'HCP', brandType: 'business_unit' },
    { brandCode: 'ENC', brandName: 'ENC', brandType: 'business_unit' },
    { brandCode: 'FRC', brandName: 'FRC', brandType: 'business_unit' },
  ],
  outlets: [
    {
      brandCode: 'BTMK',
      outletCode: 'BTMK-01',
      outletName: 'Betamek Outlet 01',
      outletType: 'pilot',
      timezone: 'Asia/Jakarta',
    },
    {
      brandCode: 'BTMF',
      outletCode: 'BTMF-01',
      outletName: 'Betamorf Outlet 01',
      outletType: 'pilot',
      timezone: 'Asia/Jakarta',
    },
  ],
  departments: [
    { departmentCode: 'KITCHEN', departmentName: 'Kitchen', departmentType: 'KITCHEN' },
    { departmentCode: 'SERVICE', departmentName: 'Service', departmentType: 'SERVICE' },
    { departmentCode: 'INVENTORY', departmentName: 'Inventory', departmentType: 'INVENTORY' },
  ],
}

async function ensureCompany(db: SeedDb) {
  const existing = await db
    .select()
    .from(companies)
    .where(eq(companies.companyCode, CORE_SEED.company.companyCode))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (existing) {
    const [updated] = await db
      .update(companies)
      .set({
        companyName: CORE_SEED.company.companyName,
        legalName: CORE_SEED.company.legalName,
        status: 'active',
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, existing.id))
      .returning()
    return updated
  }

  const [inserted] = await db
    .insert(companies)
    .values(CORE_SEED.company)
    .returning()
  return inserted
}

async function ensureBrand(
  db: SeedDb,
  companyId: string,
  seed: typeof CORE_SEED.brands[number]
) {
  const existing = await db
    .select()
    .from(brands)
    .where(and(eq(brands.companyId, companyId), eq(brands.brandCode, seed.brandCode)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (existing) {
    const [updated] = await db
      .update(brands)
      .set({
        brandName: seed.brandName,
        brandType: seed.brandType,
        status: 'active',
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(brands.id, existing.id))
      .returning()
    return updated
  }

  const [inserted] = await db
    .insert(brands)
    .values({ companyId, ...seed })
    .returning()
  return inserted
}

async function ensureOutlet(
  db: SeedDb,
  companyId: string,
  brandId: string,
  seed: Omit<typeof CORE_SEED.outlets[number], 'brandCode'>
) {
  const existing = await db
    .select()
    .from(outlets)
    .where(and(eq(outlets.brandId, brandId), eq(outlets.outletCode, seed.outletCode)))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (existing) {
    const [updated] = await db
      .update(outlets)
      .set({
        outletName: seed.outletName,
        outletType: seed.outletType,
        timezone: seed.timezone,
        status: 'active',
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(outlets.id, existing.id))
      .returning()
    return updated
  }

  const [inserted] = await db
    .insert(outlets)
    .values({ companyId, brandId, ...seed })
    .returning()
  return inserted
}

async function ensureDepartment(
  db: SeedDb,
  companyId: string,
  brandId: string,
  outletId: string,
  seed: typeof CORE_SEED.departments[number]
) {
  const existing = await db
    .select()
    .from(departments)
    .where(
      and(
        eq(departments.companyId, companyId),
        eq(departments.outletId, outletId),
        eq(departments.departmentCode, seed.departmentCode)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (existing) {
    const [updated] = await db
      .update(departments)
      .set({
        brandId,
        departmentName: seed.departmentName,
        departmentType: seed.departmentType,
        status: 'active',
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(departments.id, existing.id))
      .returning()
    return updated
  }

  const [inserted] = await db
    .insert(departments)
    .values({ companyId, brandId, outletId, ...seed })
    .returning()
  return inserted
}

export async function seedCore(db: SeedDb) {
  const company = await ensureCompany(db)
  const brandByCode = new Map<string, Awaited<ReturnType<typeof ensureBrand>>>()
  const outletByCode = new Map<string, Awaited<ReturnType<typeof ensureOutlet>>>()

  for (const brandSeed of CORE_SEED.brands) {
    const brand = await ensureBrand(db, company.id, brandSeed)
    brandByCode.set(brand.brandCode, brand)
  }

  for (const outletSeed of CORE_SEED.outlets) {
    const { brandCode, ...outletData } = outletSeed
    const brand = brandByCode.get(brandCode)
    if (!brand) {
      throw new Error(`Missing brand for outlet seed: ${brandCode}`)
    }

    const outlet = await ensureOutlet(db, company.id, brand.id, outletData)
    outletByCode.set(outlet.outletCode, outlet)

    for (const departmentSeed of CORE_SEED.departments) {
      await ensureDepartment(db, company.id, brand.id, outlet.id, departmentSeed)
    }
  }

  return {
    company,
    brands: Array.from(brandByCode.values()),
    outlets: Array.from(outletByCode.values()),
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to seed core data')
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1 })
  const db = drizzle(sql)

  try {
    const result = await seedCore(db)
    console.log(
      `Core seed complete: company=${result.company.companyCode}, brands=${result.brands.length}, outlets=${result.outlets.length}`
    )
  } finally {
    await sql.end()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
