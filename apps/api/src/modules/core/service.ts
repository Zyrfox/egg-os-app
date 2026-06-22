import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  brands,
  companies,
  departments,
  outlets,
} from '@egg-os/db'
import type { Db } from '../../lib/db'
import type {
  BrandQueryInput,
  DepartmentQueryInput,
  OutletQueryInput,
} from './dto'

function iso(date: Date | null) {
  return date?.toISOString() ?? null
}

function companyDto(company: typeof companies.$inferSelect) {
  return {
    id: company.id,
    company_code: company.companyCode,
    company_name: company.companyName,
    legal_name: company.legalName,
    status: company.status,
    is_active: company.isActive,
    metadata: company.metadata,
    created_at: iso(company.createdAt),
    updated_at: iso(company.updatedAt),
  }
}

function brandDto(brand: typeof brands.$inferSelect) {
  return {
    id: brand.id,
    company_id: brand.companyId,
    brand_code: brand.brandCode,
    brand_name: brand.brandName,
    brand_type: brand.brandType,
    status: brand.status,
    is_active: brand.isActive,
    metadata: brand.metadata,
    created_at: iso(brand.createdAt),
    updated_at: iso(brand.updatedAt),
  }
}

function outletDto(outlet: typeof outlets.$inferSelect) {
  return {
    id: outlet.id,
    company_id: outlet.companyId,
    brand_id: outlet.brandId,
    outlet_code: outlet.outletCode,
    outlet_name: outlet.outletName,
    outlet_type: outlet.outletType,
    address: outlet.address,
    timezone: outlet.timezone,
    opening_time: outlet.openingTime,
    closing_time: outlet.closingTime,
    status: outlet.status,
    is_active: outlet.isActive,
    metadata: outlet.metadata,
    created_at: iso(outlet.createdAt),
    updated_at: iso(outlet.updatedAt),
  }
}

function departmentDto(department: typeof departments.$inferSelect) {
  return {
    id: department.id,
    company_id: department.companyId,
    brand_id: department.brandId,
    outlet_id: department.outletId,
    department_code: department.departmentCode,
    department_name: department.departmentName,
    department_type: department.departmentType,
    status: department.status,
    is_active: department.isActive,
    metadata: department.metadata,
    created_at: iso(department.createdAt),
    updated_at: iso(department.updatedAt),
  }
}

export async function listCompanies(db: Db, companyId: string) {
  const rows = await db
    .select()
    .from(companies)
    .where(and(isNull(companies.deletedAt), eq(companies.status, 'active'), eq(companies.id, companyId)))
    .orderBy(asc(companies.companyCode))

  return rows.map(companyDto)
}

export async function listBrands(db: Db, companyId: string, query: BrandQueryInput) {
  const conditions = [
    isNull(brands.deletedAt),
    eq(brands.status, 'active'),
    eq(brands.companyId, companyId),
  ]

  const rows = await db
    .select()
    .from(brands)
    .where(and(...conditions))
    .orderBy(asc(brands.brandCode))

  return rows.map(brandDto)
}

export async function listOutlets(db: Db, companyId: string, query: OutletQueryInput) {
  const conditions = [
    isNull(outlets.deletedAt),
    eq(outlets.status, 'active'),
    eq(outlets.companyId, companyId),
  ]

  if (query.brand_id) {
    conditions.push(eq(outlets.brandId, query.brand_id))
  }

  const rows = await db
    .select()
    .from(outlets)
    .where(and(...conditions))
    .orderBy(asc(outlets.outletCode))

  return rows.map(outletDto)
}

export async function listDepartments(db: Db, companyId: string, query: DepartmentQueryInput) {
  const conditions = [
    isNull(departments.deletedAt),
    eq(departments.status, 'active'),
    eq(departments.companyId, companyId),
  ]

  if (query.brand_id) {
    conditions.push(eq(departments.brandId, query.brand_id))
  }

  if (query.outlet_id) {
    conditions.push(eq(departments.outletId, query.outlet_id))
  }

  const rows = await db
    .select()
    .from(departments)
    .where(and(...conditions))
    .orderBy(asc(departments.departmentCode))

  return rows.map(departmentDto)
}

