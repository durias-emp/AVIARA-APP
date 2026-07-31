/**
 * Unit tests for currency.js date logic.
 * Run with: npx vitest run src/lib/currency.test.js
 */
import { describe, it, expect } from 'vitest'
import {
  calendarMonthExpiry,
  daysCurrencyExpiry,
  statusFromExpiry,
  medicalExpiryMonths,
  ageAt,
} from './currency'

// ---------------------------------------------------------------------------
// calendarMonthExpiry
// ---------------------------------------------------------------------------
describe('calendarMonthExpiry', () => {
  it('Jan 15 2025 + 12 months -> valid through Jan 31 2026', () => {
    const exp = calendarMonthExpiry('2025-01-15', 12)
    expect(exp.getFullYear()).toBe(2026)
    expect(exp.getMonth()).toBe(0) // January = 0
    expect(exp.getDate()).toBe(31)
  })

  it('Jan 1 2025 + 12 months -> Jan 31 2026 (day irrelevant)', () => {
    const exp = calendarMonthExpiry('2025-01-01', 12)
    expect(exp.getDate()).toBe(31)
    expect(exp.getMonth()).toBe(0)
  })

  it('Jan 31 2025 + 12 months -> Jan 31 2026 (day irrelevant)', () => {
    const exp = calendarMonthExpiry('2025-01-31', 12)
    expect(exp.getDate()).toBe(31)
    expect(exp.getMonth()).toBe(0)
  })

  it('Feb 2024 + 24 months -> Feb 28 2026 (non-leap year)', () => {
    const exp = calendarMonthExpiry('2024-02-15', 24)
    expect(exp.getFullYear()).toBe(2026)
    expect(exp.getMonth()).toBe(1) // February
    expect(exp.getDate()).toBe(28)
  })

  it('Feb 2024 + 12 months -> Feb 28 2025', () => {
    const exp = calendarMonthExpiry('2024-02-15', 12)
    expect(exp.getFullYear()).toBe(2025)
    expect(exp.getDate()).toBe(28)
  })

  it('24-month: Mar 2024 + 24 -> Mar 31 2026', () => {
    const exp = calendarMonthExpiry('2024-03-10', 24)
    expect(exp.getFullYear()).toBe(2026)
    expect(exp.getMonth()).toBe(2)
    expect(exp.getDate()).toBe(31)
  })

  it('6-month IFR: Sep 2025 + 6 -> Mar 31 2026', () => {
    const exp = calendarMonthExpiry('2025-09-01', 6)
    expect(exp.getFullYear()).toBe(2026)
    expect(exp.getMonth()).toBe(2) // March
    expect(exp.getDate()).toBe(31)
  })
})

// ---------------------------------------------------------------------------
// daysCurrencyExpiry
// ---------------------------------------------------------------------------
describe('daysCurrencyExpiry', () => {
  it('90-day window from Jan 1 -> Apr 1 (90 days later)', () => {
    const exp = daysCurrencyExpiry('2025-01-01', 90)
    // Jan(31) + Feb(28) + Mar(31) = 90 days -> Apr 1
    expect(exp.getMonth()).toBe(3) // April = 3
    expect(exp.getDate()).toBe(1)
    expect(exp.getFullYear()).toBe(2025)
  })

  it('30-day window from Jan 1 -> Jan 31', () => {
    const exp = daysCurrencyExpiry('2025-01-01', 30)
    expect(exp.getDate()).toBe(31)
    expect(exp.getMonth()).toBe(0) // January
  })
})

// ---------------------------------------------------------------------------
// statusFromExpiry
// ---------------------------------------------------------------------------
describe('statusFromExpiry', () => {
  it('future date -> valid', () => {
    const future = new Date(Date.now() + 60 * 86400000) // 60 days from now
    expect(statusFromExpiry(future, 30).status).toBe('valid')
  })

  it('within warn window -> expiring', () => {
    const soon = new Date(Date.now() + 15 * 86400000) // 15 days
    expect(statusFromExpiry(soon, 30).status).toBe('expiring')
  })

  it('past date -> expired', () => {
    const past = new Date(Date.now() - 86400000) // yesterday
    expect(statusFromExpiry(past, 30).status).toBe('expired')
  })

  it('null -> unknown', () => {
    expect(statusFromExpiry(null).status).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// ageAt
// ---------------------------------------------------------------------------
describe('ageAt', () => {
  it('born Jan 1 1980, exam Jan 1 2020 -> age 40', () => {
    expect(ageAt('1980-01-01', '2020-01-01')).toBe(40)
  })

  it('born Jan 2 1980, exam Jan 1 2020 -> age 39 (birthday not reached)', () => {
    expect(ageAt('1980-01-02', '2020-01-01')).toBe(39)
  })

  it('born Jun 15 1985, exam Jun 14 2025 -> age 39', () => {
    expect(ageAt('1985-06-15', '2025-06-14')).toBe(39)
  })

  it('born Jun 15 1985, exam Jun 15 2025 -> age 40', () => {
    expect(ageAt('1985-06-15', '2025-06-15')).toBe(40)
  })
})

// ---------------------------------------------------------------------------
// medicalExpiryMonths
// ---------------------------------------------------------------------------
describe('medicalExpiryMonths', () => {
  // Private / recreational, under 40
  it('any class + private + under 40 -> 60 months', () => {
    expect(medicalExpiryMonths(1, 'private', 35)).toBe(60)
    expect(medicalExpiryMonths(2, 'private', 35)).toBe(60)
    expect(medicalExpiryMonths(3, 'private', 35)).toBe(60)
  })

  // Private: 40 or older
  it('any class + private + over 40 -> 24 months', () => {
    expect(medicalExpiryMonths(1, 'private', 40)).toBe(24)
    expect(medicalExpiryMonths(2, 'private', 55)).toBe(24)
    expect(medicalExpiryMonths(3, 'private', 40)).toBe(24)
  })

  // Commercial: 1st or 2nd class
  it('1st class + commercial -> 12 months (age-independent)', () => {
    expect(medicalExpiryMonths(1, 'commercial', 35)).toBe(12)
    expect(medicalExpiryMonths(1, 'commercial', 45)).toBe(12)
  })

  it('2nd class + commercial -> 12 months', () => {
    expect(medicalExpiryMonths(2, 'commercial', 35)).toBe(12)
    expect(medicalExpiryMonths(2, 'commercial', 60)).toBe(12)
  })

  it('3rd class + commercial -> null (not valid)', () => {
    expect(medicalExpiryMonths(3, 'commercial', 35)).toBe(null)
  })

  // ATP: 1st class only
  it('1st class + ATP + under 40 -> 12 months', () => {
    expect(medicalExpiryMonths(1, 'atp', 35)).toBe(12)
  })

  it('1st class + ATP + 40 or older -> 6 months', () => {
    expect(medicalExpiryMonths(1, 'atp', 40)).toBe(6)
    expect(medicalExpiryMonths(1, 'atp', 55)).toBe(6)
  })

  it('2nd class + ATP -> null (not valid)', () => {
    expect(medicalExpiryMonths(2, 'atp', 35)).toBe(null)
  })

  it('3rd class + ATP -> null', () => {
    expect(medicalExpiryMonths(3, 'atp', 35)).toBe(null)
  })

  // Boundary: exactly 40
  it('1st class + private, exactly age 40 -> 24 months (over-40 rule)', () => {
    expect(medicalExpiryMonths(1, 'private', 40)).toBe(24)
  })
})

// ---------------------------------------------------------------------------
// Integration: medical expiry end-to-end with calendarMonthExpiry
// ---------------------------------------------------------------------------
describe('medical expiry integration', () => {
  it('1st class ATP, under 40, exam Jan 2025 -> expires Jan 31 2026 (12 mo)', () => {
    const months = medicalExpiryMonths(1, 'atp', 35)
    const exp = calendarMonthExpiry('2025-01-15', months)
    expect(exp.getFullYear()).toBe(2026)
    expect(exp.getMonth()).toBe(0)
    expect(exp.getDate()).toBe(31)
  })

  it('1st class ATP, over 40, exam Jan 2025 -> expires Jul 31 2025 (6 mo)', () => {
    const months = medicalExpiryMonths(1, 'atp', 42)
    const exp = calendarMonthExpiry('2025-01-15', months)
    expect(exp.getFullYear()).toBe(2025)
    expect(exp.getMonth()).toBe(6) // July
    expect(exp.getDate()).toBe(31)
  })

  it('private, under 40, exam Jan 2025 -> expires Jan 31 2030 (60 mo)', () => {
    const months = medicalExpiryMonths(3, 'private', 28)
    const exp = calendarMonthExpiry('2025-01-15', months)
    expect(exp.getFullYear()).toBe(2030)
    expect(exp.getMonth()).toBe(0)
    expect(exp.getDate()).toBe(31)
  })

  it('private, over 40, exam Jan 2025 -> expires Jan 31 2027 (24 mo)', () => {
    const months = medicalExpiryMonths(2, 'private', 45)
    const exp = calendarMonthExpiry('2025-01-15', months)
    expect(exp.getFullYear()).toBe(2027)
    expect(exp.getMonth()).toBe(0)
    expect(exp.getDate()).toBe(31)
  })
})
