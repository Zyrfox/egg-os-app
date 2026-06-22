import { Hono } from 'hono'
import { createDb } from '../../lib/db'
import { errResponse, okResponse, ERR } from '../../lib/errors'
import { authMiddleware } from '../../middleware/auth'
import type { Env, AuthCtx } from '../../types'
import {
  BrandQuery,
  CompanyQuery,
  DepartmentQuery,
  OutletQuery,
  formatZodErrors,
} from './dto'
import {
  listBrands,
  listCompanies,
  listDepartments,
  listOutlets,
} from './service'

const core = new Hono<{ Bindings: Env; Variables: { auth: AuthCtx } }>()

core.get('/companies', authMiddleware, async (c) => {
  const parsed = CompanyQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
  if (!parsed.success) {
    return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)), 422)
  }

  const db = createDb(c.env.DATABASE_URL)
  const companyId = c.get('auth').companyId
  return c.json(okResponse(await listCompanies(db, companyId)), 200)
})

core.get('/brands', authMiddleware, async (c) => {
  const parsed = BrandQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
  if (!parsed.success) {
    return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)), 422)
  }

  const db = createDb(c.env.DATABASE_URL)
  const companyId = c.get('auth').companyId
  return c.json(okResponse(await listBrands(db, companyId, parsed.data)), 200)
})

core.get('/outlets', authMiddleware, async (c) => {
  const parsed = OutletQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
  if (!parsed.success) {
    return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)), 422)
  }

  const db = createDb(c.env.DATABASE_URL)
  const companyId = c.get('auth').companyId
  return c.json(okResponse(await listOutlets(db, companyId, parsed.data)), 200)
})

core.get('/departments', authMiddleware, async (c) => {
  const parsed = DepartmentQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
  if (!parsed.success) {
    return c.json(errResponse(ERR.VALIDATION.code, ERR.VALIDATION.message, formatZodErrors(parsed.error)), 422)
  }

  const db = createDb(c.env.DATABASE_URL)
  const companyId = c.get('auth').companyId
  return c.json(okResponse(await listDepartments(db, companyId, parsed.data)), 200)
})

export default core

