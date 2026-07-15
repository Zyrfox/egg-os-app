export function todayWIB(now?: () => Date): string {
  const d = (now ?? (() => new Date()))()
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

export function monthRangeWIB(
  month: string,
  now?: () => Date,
): {
  startDate: string
  nextMonthStart: string
  calendarDays: number
  elapsedDays: number
} {
  const year = parseInt(month.slice(0, 4), 10)
  const mon = parseInt(month.slice(5, 7), 10)
  const startDate = `${month}-01`
  const nextYear = mon === 12 ? year + 1 : year
  const nextMon = mon === 12 ? 1 : mon + 1
  const nextMonthStart = `${nextYear}-${String(nextMon).padStart(2, '0')}-01`
  // JS trick: day 0 of month `mon+1` = last day of month `mon`
  const calendarDays = new Date(year, mon, 0).getDate()
  const today = todayWIB(now)
  let elapsedDays: number
  if (today < startDate) {
    elapsedDays = 0
  } else if (today >= nextMonthStart) {
    elapsedDays = calendarDays
  } else {
    elapsedDays = parseInt(today.slice(8, 10), 10)
  }
  return { startDate, nextMonthStart, calendarDays, elapsedDays }
}
