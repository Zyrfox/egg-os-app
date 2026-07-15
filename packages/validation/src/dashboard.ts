import { z } from 'zod'

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format tanggal harus YYYY-MM-DD')
const MonthString = z.string().regex(/^\d{4}-\d{2}$/, 'format bulan harus YYYY-MM')

export const DashboardDateMonthQuery = z.object({
  date: DateString.optional(),
  month: MonthString.optional(),
})
export type DashboardDateMonthQuery = z.infer<typeof DashboardDateMonthQuery>

export const DashboardDateQuery = z.object({
  date: DateString.optional(),
})
export type DashboardDateQuery = z.infer<typeof DashboardDateQuery>
