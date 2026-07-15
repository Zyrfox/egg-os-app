import { describe, expect, it } from 'vitest'
import { monthRangeWIB, todayWIB } from './date'

describe('todayWIB', () => {
  it('UTC 16:59 = WIB 23:59 → still same date', () => {
    expect(todayWIB(() => new Date('2025-06-15T16:59:00Z'))).toBe('2025-06-15')
  })

  it('UTC 17:00 = WIB 00:00 → next day', () => {
    expect(todayWIB(() => new Date('2025-06-15T17:00:00Z'))).toBe('2025-06-16')
  })

  it('UTC 18:30 = WIB 01:30 → next day', () => {
    expect(todayWIB(() => new Date('2025-06-15T18:30:00Z'))).toBe('2025-06-16')
  })

  it('UTC midnight = WIB 07:00 → same date', () => {
    expect(todayWIB(() => new Date('2025-06-15T00:00:00Z'))).toBe('2025-06-15')
  })
})

describe('monthRangeWIB', () => {
  it('February non-leap (2025): calendarDays=28, nextMonthStart=2025-03-01', () => {
    const result = monthRangeWIB('2025-02', () => new Date('2025-02-15T10:00:00Z'))
    expect(result.calendarDays).toBe(28)
    expect(result.startDate).toBe('2025-02-01')
    expect(result.nextMonthStart).toBe('2025-03-01')
    expect(result.elapsedDays).toBe(15)
  })

  it('February leap (2024): calendarDays=29, nextMonthStart=2024-03-01', () => {
    const result = monthRangeWIB('2024-02', () => new Date('2024-02-29T10:00:00Z'))
    expect(result.calendarDays).toBe(29)
    expect(result.nextMonthStart).toBe('2024-03-01')
    expect(result.elapsedDays).toBe(29)
  })

  it('December: nextMonthStart crosses year boundary to 2026-01-01', () => {
    const result = monthRangeWIB('2025-12', () => new Date('2025-12-10T10:00:00Z'))
    expect(result.calendarDays).toBe(31)
    expect(result.nextMonthStart).toBe('2026-01-01')
    expect(result.elapsedDays).toBe(10)
  })

  it('future month: elapsedDays=0', () => {
    const result = monthRangeWIB('2025-08', () => new Date('2025-06-15T10:00:00Z'))
    expect(result.elapsedDays).toBe(0)
  })

  it('past month: elapsedDays=calendarDays', () => {
    const result = monthRangeWIB('2025-04', () => new Date('2025-06-15T10:00:00Z'))
    expect(result.calendarDays).toBe(30)
    expect(result.elapsedDays).toBe(30)
  })
})
