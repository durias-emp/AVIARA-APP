/**
 * Currency date-logic utilities: 14 CFR 61 / 91
 * All functions are pure (no side-effects) so they can be unit-tested independently.
 */

// ---------------------------------------------------------------------------
// FAR reference config: keep here so numbers are easy to verify / update
// ---------------------------------------------------------------------------
export const FAR = {
  imsafe:         { ref: '91.3',    label: 'FAR 91.3',     desc: 'Responsibility and authority of the pilot in command.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-A/section-91.3' },
  flightReview:   { ref: '61.56',   label: 'FAR 61.56',    desc: 'Flight review. Required every 24 calendar months to act as PIC.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.56' },
  passenger90:    { ref: '61.57(a)',label: 'FAR 61.57(a)', desc: 'Recent flight experience. 3 takeoffs/landings in 90 days to carry passengers.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.57' },
  night90:        { ref: '61.57(b)',label: 'FAR 61.57(b)', desc: 'Night recent experience. 3 full-stop takeoffs/landings at night in 90 days to carry passengers at night.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.57' },
  ifrCurrency:    { ref: '61.57(c)',label: 'FAR 61.57(c)', desc: 'Instrument experience. 6 approaches, holding, and intercepting/tracking courses within 6 calendar months.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.57' },
  ipc:            { ref: '61.57(d)',label: 'FAR 61.57(d)', desc: 'Instrument proficiency check. Required if instrument currency lapses beyond the 6-month grace period.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.57' },
  medical:        { ref: '61.23',   label: 'FAR 61.23',    desc: 'Medical certificates. Class, duration, and when required.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.23' },
  medicalDur:     { ref: '61.23(d)',label: 'FAR 61.23(d)', desc: 'Medical certificate duration matrix by class and age at exam.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.23' },
  crewDocs:       { ref: '61.3',    label: 'FAR 61.3',     desc: 'Certificates, ratings, and documents pilots must carry and present.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.3' },
  airworthCert:   { ref: '91.203',  label: 'FAR 91.203',   desc: 'Civil aircraft. Required certificates and markings on board.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-C/section-91.203' },
  registration:   { ref: '91.203',  label: 'FAR 91.203',   desc: 'Aircraft registration must be aboard and available.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-C/section-91.203' },
  opLimitations:  { ref: '91.9',    label: 'FAR 91.9',     desc: 'Civil aircraft flight manual, markings, and placard requirements.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-A/section-91.9' },
  weightBalance:  { ref: '91.103',  label: 'FAR 91.103',   desc: 'Preflight action. Weight and balance, performance, and runway data must be checked.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-A/section-91.103' },
  annual:         { ref: '91.409',  label: 'FAR 91.409',   desc: 'Annual inspection. Required within the preceding 12 calendar months.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-E/section-91.409' },
  hundredHour:    { ref: '91.409',  label: 'FAR 91.409',   desc: '100-hour inspection. Required for aircraft used for hire/flight instruction for hire.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-E/section-91.409' },
  pitotStatic:    { ref: '91.411',  label: 'FAR 91.411',   desc: 'Pitot-static and altimeter system tests. Required every 24 calendar months for IFR flight.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-E/section-91.411' },
  transponder:    { ref: '91.413',  label: 'FAR 91.413',   desc: 'Transponder tests and inspections. Required every 24 calendar months.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-E/section-91.413' },
  elt:            { ref: '91.207',  label: 'FAR 91.207',   desc: 'Emergency locator transmitters. Required equipment and battery/inspection intervals.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-C/section-91.207' },
  ads:            { ref: '91.417',  label: 'FAR 91.417',   desc: 'Maintenance record keeping requirements.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-E/section-91.417' },
  requiredEquip:  { ref: '91.205',  label: 'FAR 91.205',   desc: 'Powered civil aircraft with standard category U.S. airworthiness certificates. Instrument and equipment requirements.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-C/section-91.205' },
  vorCheck:       { ref: '91.171',  label: 'FAR 91.171',   desc: 'VOR equipment check. Required every 30 days for IFR flight under VOR navigation.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.171' },
}

// ---------------------------------------------------------------------------
// Core date functions: write once, used across all cards
// ---------------------------------------------------------------------------

/**
 * Calendar-month expiry per 14 CFR 61.23(d):
 * "end of the last day of the Nth month after the month of the date of examination."
 * The day of baseDate is irrelevant, only the month matters.
 *
 * Sanity check: exam Jan 15 2025, 12 months -> valid through Jan 31 2026.
 */
// Parse date strings as local dates (avoid UTC midnight shifting across timezones)
function parseLocal(d) {
  if (d instanceof Date) return new Date(d)
  const [y, m, day] = String(d).split('-').map(Number)
  return new Date(y, m - 1, day)
}

export function calendarMonthExpiry(baseDate, months) {
  const d = parseLocal(baseDate)
  // day 0 of (month + N + 1) === last calendar day of (month + N)
  const expiry = new Date(d.getFullYear(), d.getMonth() + months + 1, 0)
  expiry.setHours(23, 59, 59, 999)
  return expiry
}

/**
 * Rolling-days currency: e.g. 61.57(a) 90-day passenger currency.
 */
export function daysCurrencyExpiry(lastEventDate, windowDays = 90) {
  const expiry = parseLocal(lastEventDate)
  expiry.setDate(expiry.getDate() + windowDays)
  expiry.setHours(23, 59, 59, 999)
  return expiry
}

/**
 * Compute status from an expiry date and warning threshold (days).
 * Returns: { status: 'valid'|'expiring'|'expired', expiresOn: Date, daysLeft: number }
 */
export function statusFromExpiry(expiry, warnDays = 30) {
  if (!expiry) return { status: 'unknown', expiresOn: null, daysLeft: null }
  const now = Date.now()
  const exp = expiry instanceof Date ? expiry : new Date(expiry)
  const daysLeft = Math.ceil((exp.getTime() - now) / 86400000)
  const status = daysLeft < 0 ? 'expired' : daysLeft <= warnDays ? 'expiring' : 'valid'
  return { status, expiresOn: exp, daysLeft }
}

/**
 * Compute status for an hour-based item (e.g. Oil Change, 100-hr Inspection)
 * from its next-due hour reading and the aircraft's current Hobbs time.
 * Returns: { status: 'valid'|'expiring'|'expired'|'unknown', hoursLeft: number|null }
 */
export function statusFromHours(nextDueHours, currentHobbs, warnHours = 10) {
  if (nextDueHours == null || nextDueHours === '' || currentHobbs == null) {
    return { status: 'unknown', hoursLeft: null }
  }
  const hoursLeft = Number(nextDueHours) - Number(currentHobbs)
  const status = hoursLeft < 0 ? 'expired' : hoursLeft <= warnHours ? 'expiring' : 'valid'
  return { status, hoursLeft }
}

// ---------------------------------------------------------------------------
// Medical duration matrix: 14 CFR 61.23(d)
// Auditable single source of truth. A row applies when medicalClass <= classMax.
// u40 = months if age-at-exam < 40; o40 = months if age-at-exam >= 40.
// ---------------------------------------------------------------------------
export const MEDICAL_MATRIX = [
  { tier: 'atp',        label: 'ATP (PIC / 121-SIC 3+ pilots)', classMax: 1, u40: 12, o40: 6  },
  { tier: 'commercial', label: 'Commercial / Flt Eng / ATC',     classMax: 2, u40: 12, o40: 12 },
  { tier: 'private',    label: 'Private / Rec / CFI / Student',  classMax: 3, u40: 60, o40: 24 },
]

/**
 * Returns every operation tier applicable to this certificate, each with its
 * expiry duration in months. Age is locked to the exam date (Edge Case 2).
 * The same certificate has multiple simultaneous expirations (Edge Case 1).
 */
export function medicalExpiryRows(medicalClass, ageAtExam) {
  const over40 = ageAtExam >= 40
  return MEDICAL_MATRIX
    .filter(row => medicalClass <= row.classMax)
    .map(row => ({ tier: row.tier, label: row.label, months: over40 ? row.o40 : row.u40 }))
}

/**
 * Backward-compatible single-operation lookup (used by unit tests).
 */
export function medicalExpiryMonths(medicalClass, operation, ageAtExam) {
  const rows = medicalExpiryRows(medicalClass, ageAtExam)
  const row = rows.find(r => r.tier === operation)
  return row ? row.months : null
}

/**
 * Compute age at a given exam date given DOB.
 * Uses parseLocal to avoid UTC-midnight timezone shift on ISO strings.
 */
export function ageAt(dob, examDate) {
  const d = parseLocal(dob)
  const e = parseLocal(examDate)
  let age = e.getFullYear() - d.getFullYear()
  const monthDiff = e.getMonth() - d.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && e.getDate() < d.getDate())) age--
  return age
}

// ---------------------------------------------------------------------------
// getCurrencyStatus: shared selector for Flight Planning module
// ---------------------------------------------------------------------------

/**
 * Derives overall status for each of the four IM cards from raw stored data.
 * Returns { safe, current, valid, airworthy } each as:
 *   { status: 'valid'|'expiring'|'expired'|'incomplete'|'unknown', detail: string, expiresOn: Date|null }
 *
 * @param {object} data - raw data from IndexedDB currency store
 * @param {number} warnDays - days-before-expiry threshold for 'expiring'
 */
export function getCurrencyStatus(data = {}, warnDays = 30) {
  // ── IM SAFE ──────────────────────────────────────────────────────────────
  const safeItems = ['illness', 'medication', 'stress', 'alcohol', 'fatigue', 'eating']
  const safeAll = safeItems.every(k => data.safe?.[k] === true)
  const safe = {
    status: safeAll ? 'valid' : 'incomplete',
    detail: safeAll ? 'All items confirmed' : 'Pre-flight self-check incomplete',
    expiresOn: null,
  }

  // ── IM CURRENT ───────────────────────────────────────────────────────────
  const currentChecks = []

  // Flight review: 24 calendar months
  if (data.current?.flightReviewDate) {
    const exp = calendarMonthExpiry(data.current.flightReviewDate, 24)
    currentChecks.push(statusFromExpiry(exp, warnDays))
  } else {
    currentChecks.push({ status: 'unknown' })
  }

  // Day passenger currency: 90 days, self-reported acknowledgment (no date tracked)
  currentChecks.push({ status: data.current?.dayCurrent === true ? 'valid' : 'unknown' })

  // IFR: 6 calendar months; IPC date still decays on a calendar-month basis,
  // otherwise fall back to the self-reported acknowledgment checkbox
  if (data.current?.ipcDate) {
    const exp = calendarMonthExpiry(data.current.ipcDate, 6)
    currentChecks.push(statusFromExpiry(exp, warnDays))
  } else {
    currentChecks.push({ status: data.current?.ifrCurrent === true ? 'valid' : 'unknown' })
  }

  const worstCurrent = currentChecks.reduce((worst, c) => {
    const rank = { expired: 3, expiring: 2, unknown: 1, valid: 0 }
    return (rank[c.status] ?? 0) > (rank[worst.status] ?? 0) ? c : worst
  }, { status: 'valid' })

  const current = {
    status: worstCurrent.status === 'unknown' ? 'incomplete' : worstCurrent.status,
    detail: 'Flight review · Passenger currency · IFR currency',
    expiresOn: worstCurrent.expiresOn ?? null,
  }

  // ── MEDICAL VALIDITY ─────────────────────────────────────────────────────
  let valid = { status: 'incomplete', detail: 'Enter medical info', expiresOn: null, tiers: [] }
  if (data.medical?.examDate && data.medical?.dob && data.medical?.medClass) {
    const age = ageAt(data.medical.dob, data.medical.examDate)
    const rows = medicalExpiryRows(Number(data.medical.medClass), age)
    const tiers = rows.map(r => {
      const expiresOn = calendarMonthExpiry(data.medical.examDate, r.months)
      return { ...r, expiresOn, ...statusFromExpiry(expiresOn, warnDays) }
    })
    const rank = { expired: 3, expiring: 2, valid: 1, unknown: 0 }
    const worst = tiers.reduce((w, t) => (rank[t.status] ?? 0) > (rank[w.status] ?? 0) ? t : w, tiers[0] ?? { status: 'incomplete' })
    valid = { status: worst.status, expiresOn: worst.expiresOn, detail: `Class ${data.medical.medClass} medical`, tiers }
  }

  // ── IM AIRWORTHY ─────────────────────────────────────────────────────────
  const airworthyInspections = []

  if (data.airworthy?.annualDate) {
    airworthyInspections.push(statusFromExpiry(calendarMonthExpiry(data.airworthy.annualDate, 12), warnDays))
  }
  if (data.airworthy?.transponderDate) {
    airworthyInspections.push(statusFromExpiry(calendarMonthExpiry(data.airworthy.transponderDate, 24), warnDays))
  }
  if (data.airworthy?.pitotDate) {
    airworthyInspections.push(statusFromExpiry(calendarMonthExpiry(data.airworthy.pitotDate, 24), warnDays))
  }

  const worstAirworthy = airworthyInspections.reduce((worst, c) => {
    const rank = { expired: 3, expiring: 2, unknown: 1, valid: 0 }
    return (rank[c.status] ?? 0) > (rank[worst.status] ?? 0) ? c : worst
  }, { status: airworthyInspections.length === 0 ? 'incomplete' : 'valid' })

  const airworthy = {
    status: worstAirworthy.status,
    detail: 'Annual · Transponder · Pitot-static',
    expiresOn: worstAirworthy.expiresOn ?? null,
  }

  return { safe, current, valid, airworthy }
}

// ---------------------------------------------------------------------------
// getGlobalCurrencyStatus: single worst-of-all status for the Home icon
// ---------------------------------------------------------------------------

/**
 * Rolls the four getCurrencyStatus() cards up into one status for a status-
 * indicator icon. 'incomplete'/'unknown' (data not entered yet) reads as
 * 'valid': the icon should only warn about things actually tracked and
 * approaching/past their due date, not nag about unfilled fields.
 * Returns: 'valid' | 'expiring' | 'expired'
 */
export function getGlobalCurrencyStatus(data = {}, warnDays = 30) {
  const cards = getCurrencyStatus(data, warnDays)
  const rank = { expired: 2, expiring: 1, valid: 0, incomplete: 0, unknown: 0 }
  const worst = Object.values(cards).reduce(
    (w, c) => (rank[c.status] ?? 0) > (rank[w] ?? 0) ? c.status : w,
    'valid'
  )
  return rank[worst] ? worst : 'valid'
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
export function fmtDate(date) {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtDaysLeft(daysLeft) {
  if (daysLeft == null) return ''
  if (daysLeft < 0) return `${Math.abs(daysLeft)}d ago`
  if (daysLeft === 0) return 'expires today'
  return `${daysLeft}d left`
}
