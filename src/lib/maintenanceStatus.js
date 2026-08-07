// Where each maintenance item stands, worked out at render time.
//
// The architecture is Diego's, from the CNA OpsBoard handoff, and it survives
// intact because it is right: an item stores the absolute hours, cycles and
// date at which it falls due, never a countdown. "How far away" is subtraction
// against the aircraft's current counters, done here, every render. So flying
// the aircraft moves all 118 countdowns and writes to nothing. The due values
// move only when a mechanic logs compliance.
//
// Four things differ from the original, and each is a correction rather than a
// preference.
//
// 1. An unknown counter is not zero. The original read `hobbsCurrent ?? 0`,
//    which made an aircraft with no airframe time on file compare every due
//    figure against zero: a 100-hour inspection due at 17,510 hours reported
//    "17,510 hours remaining", in green, on an airframe that might be overdue.
//    Items whose clock cannot be read are UNKNOWN and say which figure is
//    missing. (This is main's correction; it is right and it is kept.)
//
// 2. A due date is good through the end of that day. The original compared a
//    due date at local noon against now, so an item due on the 31st read as
//    expired from 1pm on the 31st. Deliberately NOT calendarMonthExpiry, which
//    the currency screens use: that returns the end of the due date's MONTH,
//    which is right for "within the preceding 12 calendar months" reckoned
//    from a compliance date, and wrong here, where the sheet has already done
//    that reckoning and handed us a date. Extending it to the end of the month
//    would grant up to thirty days the sheet never gave.
//
// 3. Months remaining is measured in whole days, not by subtracting month
//    numbers. The original's arithmetic said "1 month" for both the 2nd of
//    next month and the 30th of it.
//
// 4. Retirement lives are not inspections. See RETIREMENT below.

// How close counts as close.
//
// Ten hours is the original's figure and the one main already uses for the
// airworthiness items on the aircraft page, so the two agree. Fifty for the
// long intervals, because ten hours' warning on a 2,000-hour overhaul is no
// warning at all: it arrives after the decision to fly the trip that runs it
// out. A month, and a hundred cycles, likewise.
const WARN_HOURS_STANDARD = 10
const WARN_HOURS_HEAVY = 50
const HEAVY_INTERVAL_HOURS = 1500
const WARN_DAYS = 31
const WARN_CYCLES = 100

export const STATUS = Object.freeze({
  OVERDUE: 'overdue',
  DUE_SOON: 'due_soon',
  OK: 'ok',
  ON_CONDITION: 'on_condition',
  NOT_APPLICABLE: 'not_applicable',
  UNKNOWN: 'unknown',
})

// The order they matter in, worst first. Used for sorting and for picking the
// one status a whole aircraft is in.
export const STATUS_RANK = Object.freeze({
  [STATUS.OVERDUE]: 5,
  [STATUS.DUE_SOON]: 4,
  [STATUS.UNKNOWN]: 3,
  [STATUS.OK]: 2,
  [STATUS.ON_CONDITION]: 1,
  [STATUS.NOT_APPLICABLE]: 0,
})

export const STATUS_LABEL = Object.freeze({
  [STATUS.OVERDUE]: 'Overdue',
  [STATUS.DUE_SOON]: 'Due soon',
  [STATUS.OK]: 'In limits',
  [STATUS.ON_CONDITION]: 'On condition',
  [STATUS.NOT_APPLICABLE]: 'Not applicable',
  [STATUS.UNKNOWN]: 'Cannot tell',
})

// An item that retires a part rather than inspecting one.
//
// A third of this aircraft's schedule is life-limited components: turbine
// wheels and the like, with a part number, a serial number and a life in hours
// and cycles. They are not overhauled back to zero. When the life is reached
// the part comes off and a DIFFERENT part goes on, with its own serial and its
// own remaining life, which may not be zero.
//
// That matters because the compliance flow rolls due values forward by the
// interval, which for an inspection is exactly right and for a retirement
// grants the same physical part a second full life while the log still names
// the old serial. The flag is read by the compliance UI, which asks for the
// replacement's details instead of pretending the old part was serviced.
export const RETIREMENT = 'Retire'
export function isRetirement(item) {
  return (item.eventType ?? '').trim().toLowerCase() === RETIREMENT.toLowerCase()
}

// Days from today until a date, positive in the future. Whole days, so an
// item due today reads 0 and is still in limits, and one due yesterday reads
// -1 and is overdue.
function daysUntil(dueDateStr) {
  if (!dueDateStr) return null
  // Parsed at local noon, not midnight: a bare YYYY-MM-DD is treated as UTC by
  // Date, which lands on the previous day for anyone west of Greenwich.
  const due = new Date(`${dueDateStr}T12:00:00`)
  if (isNaN(due)) return null
  due.setHours(23, 59, 59, 999)
  return Math.floor((due - new Date()) / 86400000)
}

// The special prefixes the sheet carries in its notes column.
//
// "N/A" marks an item that does not apply to this airframe: a system it does
// not have, or a bulletin already complied with terminally. It is not a
// failure to track something, it is a decision, and it is shown greyed rather
// than hidden so the decision stays visible.
function isNotApplicable(item) {
  return (item.notes ?? '').trim().toUpperCase().startsWith('N/A')
}

// "TRACK:1234.5:678.9" carries two reference figures for an on-condition item:
// total time and time since overhaul at the last compliance. The running
// totals are those plus everything flown since.
function trackingRefs(notes) {
  if (!notes?.startsWith('TRACK:')) return null
  const [, totalStr, sinceStr] = notes.split(':')
  const total = parseFloat(totalStr)
  const since = parseFloat(sinceStr)
  if (isNaN(total) || isNaN(since)) return null
  return { total, since }
}

function statusOf(item, remaining) {
  if (isNotApplicable(item)) return STATUS.NOT_APPLICABLE
  if (item.limitType === 'ON_CONDITION') return STATUS.ON_CONDITION

  const { hoursLeft, cyclesLeft, daysLeft, unreadable } = remaining

  // Nothing to measure against. An item with a due figure and no counter to
  // compare it to is not in limits, it is unknown, and saying so is the whole
  // point of this branch.
  if (unreadable.length && hoursLeft == null && cyclesLeft == null && daysLeft == null) {
    return STATUS.UNKNOWN
  }

  if ((hoursLeft != null && hoursLeft <= 0)
    || (cyclesLeft != null && cyclesLeft <= 0)
    || (daysLeft != null && daysLeft < 0)) return STATUS.OVERDUE

  const warnHours = (item.hoursInterval != null && item.hoursInterval >= HEAVY_INTERVAL_HOURS)
    ? WARN_HOURS_HEAVY : WARN_HOURS_STANDARD

  if ((hoursLeft != null && hoursLeft <= warnHours)
    || (cyclesLeft != null && cyclesLeft <= WARN_CYCLES)
    || (daysLeft != null && daysLeft <= WARN_DAYS)) return STATUS.DUE_SOON

  // A due figure exists on some clock and every one of them is comfortable,
  // but another clock could not be read. Still worth flagging.
  if (unreadable.length) return STATUS.UNKNOWN

  return STATUS.OK
}

// One item, plus everything derived from the aircraft's counters.
// hobbs and cycles are null when not recorded, and null is not zero.
export function enrich(item, hobbs, cycles) {
  const unreadable = []
  if (item.dueAtHours != null && hobbs == null) unreadable.push('airframe time')
  if (item.dueAtCycles != null && cycles == null) unreadable.push('cycles')

  const hoursLeft = item.dueAtHours != null && hobbs != null
    ? Math.round((item.dueAtHours - hobbs) * 10) / 10 : null
  const cyclesLeft = item.dueAtCycles != null && cycles != null
    ? item.dueAtCycles - cycles : null
  const daysLeft = daysUntil(item.dueDate)

  const remaining = { hoursLeft, cyclesLeft, daysLeft, unreadable }
  const status = statusOf(item, remaining)

  // Running totals for the on-condition items that track time rather than
  // fall due. Only meaningful once something has been flown since the
  // reference was taken.
  let trackedTotal = null, trackedSinceOverhaul = null
  const refs = trackingRefs(item.notes)
  if (refs && item.lastCompliedHours != null && hobbs != null) {
    const flown = hobbs - item.lastCompliedHours
    trackedTotal = Math.round((refs.total + flown) * 10) / 10
    trackedSinceOverhaul = Math.round((refs.since + flown) * 10) / 10
  }

  return {
    ...item,
    status,
    hoursLeft,
    cyclesLeft,
    daysLeft,
    unreadable,
    isRetirement: isRetirement(item),
    trackedTotal,
    trackedSinceOverhaul,
  }
}

// Which clock is the binding one, for sorting and for the one-line summary.
// Hours and cycles are converted to a rough number of days at a nominal 1.5
// hours flown a day so three different units can be ranked against each other.
// It decides display order only; every figure is shown in its own unit.
export function urgency(item) {
  const candidates = []
  if (item.hoursLeft != null) candidates.push(item.hoursLeft / 1.5)
  if (item.cyclesLeft != null) candidates.push(item.cyclesLeft / 3)
  if (item.daysLeft != null) candidates.push(item.daysLeft)
  return candidates.length ? Math.min(...candidates) : Infinity
}

// The whole schedule, enriched and grouped.
export function summarise(items, hobbs, cycles) {
  const enriched = items.map(i => enrich(i, hobbs, cycles))
  const by = (s) => enriched.filter(i => i.status === s).sort((a, b) => urgency(a) - urgency(b))
  return {
    items: enriched,
    overdue: by(STATUS.OVERDUE),
    dueSoon: by(STATUS.DUE_SOON),
    ok: by(STATUS.OK),
    unknown: by(STATUS.UNKNOWN),
    onCondition: by(STATUS.ON_CONDITION),
    notApplicable: by(STATUS.NOT_APPLICABLE),
  }
}
