import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config } from 'dotenv'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq, inArray, isNull, sql as drizzleSql } from 'drizzle-orm'
import * as schema from '../src/schema'
import { companies, reportChecklistItems } from '../src/schema'

config({ path: resolve(__dirname, '../../../.env') })

type SeedDb = ReturnType<typeof drizzle<typeof schema>>

type ChecklistSeed = {
  reportType: 'opening' | 'closing' | 'issue'
  label: string
  displayOrder: number
}

export const REPORT_CHECKLIST_GLOBAL_SEED: ChecklistSeed[] = [
  // OPENING — kebersihan, kesiapan, stok awal
  { reportType: 'opening', label: 'Area outlet bersih dan rapi',        displayOrder: 1 },
  { reportType: 'opening', label: 'Kompor & peralatan masak siap',      displayOrder: 2 },
  { reportType: 'opening', label: 'Stok bahan baku awal sudah dicek',   displayOrder: 3 },
  { reportType: 'opening', label: 'Kasir / POS siap dioperasikan',      displayOrder: 4 },
  { reportType: 'opening', label: 'Daftar menu hari ini tersedia',      displayOrder: 5 },
  // CLOSING — kebersihan tutup, stok akhir, kas, perlengkapan
  { reportType: 'closing', label: 'Area outlet sudah dibersihkan',      displayOrder: 1 },
  { reportType: 'closing', label: 'Stok bahan baku akhir sudah dicek',  displayOrder: 2 },
  { reportType: 'closing', label: 'Kas hari ini sudah ditutup',         displayOrder: 3 },
  { reportType: 'closing', label: 'Peralatan masak & listrik dimatikan', displayOrder: 4 },
  { reportType: 'closing', label: 'Pintu & gembok terkunci',            displayOrder: 5 },
  // ISSUE — minimal (issue umumnya pakai notes free-form)
  { reportType: 'issue', label: 'Insiden ringan / observasi',           displayOrder: 1 },
]

async function getEggCompany(db: SeedDb) {
  const company = await db
    .select()
    .from(companies)
    .where(eq(companies.companyCode, 'EGG'))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!company) {
    throw new Error('Company EGG not found. Run pnpm db:seed:core before pnpm db:seed:report.')
  }

  return company
}

export async function seedReportChecklist(db: SeedDb) {
  const company = await getEggCompany(db)
  // Global items: outletId = null. Identitas idempotent: (companyId, reportType, label, outletId IS NULL).
  for (const item of REPORT_CHECKLIST_GLOBAL_SEED) {
    const existing = await db
      .select({ id: reportChecklistItems.id })
      .from(reportChecklistItems)
      .where(
        and(
          eq(reportChecklistItems.companyId, company.id),
          eq(reportChecklistItems.reportType, item.reportType),
          eq(reportChecklistItems.label, item.label),
          isNull(reportChecklistItems.outletId),
          isNull(reportChecklistItems.deletedAt),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (existing) {
      await db
        .update(reportChecklistItems)
        .set({
          displayOrder: item.displayOrder,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(reportChecklistItems.id, existing.id))
    } else {
      await db.insert(reportChecklistItems).values({
        companyId: company.id,
        outletId: null,
        reportType: item.reportType,
        label: item.label,
        displayOrder: item.displayOrder,
        isActive: true,
      })
    }
  }

  return getReportSeedCounts(db, company.id)
}

export async function getReportSeedCounts(db: SeedDb, companyId?: string) {
  const resolvedCompanyId = companyId ?? (await getEggCompany(db)).id
  const labels = REPORT_CHECKLIST_GLOBAL_SEED.map((item) => item.label)

  const [row] = await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(reportChecklistItems)
    .where(
      and(
        eq(reportChecklistItems.companyId, resolvedCompanyId),
        inArray(reportChecklistItems.label, labels),
        isNull(reportChecklistItems.outletId),
        isNull(reportChecklistItems.deletedAt),
      ),
    )

  return {
    companyId: resolvedCompanyId,
    checklistItems: row.count,
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to seed report data')
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1 })
  const db = drizzle(sql, { schema })

  try {
    const result = await seedReportChecklist(db)
    console.log(
      `Report seed complete: company=EGG, checklist_items=${result.checklistItems}`,
    )
  } finally {
    await sql.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
