// The figures a route summary shows, and the arithmetic behind them.
//
// Six, and the test each one had to pass is whether it changes a decision
// before departure:
//
//   distance   the sanity check every other figure is measured against
//   ete        fuel, daylight, currency, endurance
//   eta        clock time. Field hours, sunset, who is expecting you
//   fuel       trip burn
//   reserve    what is left on landing, as time, against the legal minimum
//   altitude   the only one that is a decision rather than a result
//
// Three figures were dropped to make room and it is worth saying why, because
// they look like information and are not:
//
//   True course and variation are not facts of their own. True course minus
//   variation IS magnetic course, so showing all three spends three slots on
//   one relationship the pilot never needs decomposed and never flies two
//   thirds of.
//
//   Magnetic course itself is worse than redundant on a route with waypoints:
//   there is no single course, and what was shown was the first leg's bearing.
//   A figure that is right only when the route happens to be direct, wearing
//   the planner's authority, is the kind of thing a pilot finds out about in
//   the air. Course belongs per leg, in the leg table, where it is true.
//
//   Fuel aboard is an input, not an answer. The tanks holding 91 gallons does
//   not tell anyone whether the flight lands legal. Reserve does, and aboard
//   is one of the terms in it.

import { getRuleset } from './regulations'

// h:mm, the way a flight plan writes it. Not "1.4 hours".
export function fmtEte(hours) {
  if (hours == null || !Number.isFinite(hours)) return null
  const total = Math.round(hours * 60)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// Arrival, on the clock, in the pilot's own timezone.
//
// The departure time is whatever the plan holds; without one the only honest
// reading is "if you left now", which is what a pilot glancing at a drawer
// means anyway. Returned with `assumedNow` so the caller can say which it is
// rather than presenting a guess as a filed time.
export function etaFrom(etdISO, hours) {
  if (hours == null || !Number.isFinite(hours)) return null
  const assumedNow = !etdISO
  const start = etdISO ? new Date(etdISO) : new Date()
  if (Number.isNaN(start.getTime())) return null
  const at = new Date(start.getTime() + hours * 3600_000)
  return {
    at,
    assumedNow,
    text: at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    // A flight that lands on another date is a fact worth carrying: a pilot
    // reading "1:15 am" needs to know it is tomorrow's 1:15.
    nextDay: at.toDateString() !== start.toDateString(),
  }
}

// What is left in the tanks when the wheels touch, in minutes.
//
// Minutes rather than gallons because that is the unit the rule is written in:
// 91.151 asks for 30 minutes of day VFR fuel, not 4 gallons. Gallons would
// have to be converted back by the pilot against a burn rate they are already
// holding in their head, which is the arithmetic this figure exists to do.
export function reserveMinutes({ aboardGal, burnGph, eteHours }) {
  const aboard = Number(aboardGal)
  const burn = Number(burnGph)
  if (!Number.isFinite(aboard) || !Number.isFinite(burn) || burn <= 0) return null
  if (eteHours == null || !Number.isFinite(eteHours)) return null
  return Math.round((aboard / burn - eteHours) * 60)
}

// The minimum that reserve has to beat, from the region's own ruleset rather
// than from a number written here. Jurisdictions differ, the rules cite
// themselves, and a second copy of a legal minimum is the one kind of
// duplication this app cannot afford: Cruise & Fuel and the drawer have to
// answer this identically or one of them is wrong in a way a pilot trusts.
export function requiredReserveMinutes({ region = 'us', flightRules, isHelicopter = false, timeOfDay = 'day' }) {
  // The rulesets answer on 'VFR' or 'IFR' and nothing else. Anything else,
  // including a flight type key like 'RTC' or the whole stored record, falls
  // through to a deliberately conservative "not in the table" answer, which
  // is honest but is not this flight's minimum. Refusing here is better than
  // showing a number that belongs to a different kind of flying.
  if (flightRules !== 'VFR' && flightRules !== 'IFR') return { minutes: null, note: null }
  try {
    const ruleset = getRuleset(region)
    const result = ruleset?.computed?.reserveMinutes?.(ruleset, { flightRules, isHelicopter, timeOfDay })
    return {
      minutes: result?.value ?? null,
      note: (result?.steps ?? []).join(' — ') || null,
    }
  } catch {
    // A ruleset that will not load must not take the figure down with it. No
    // minimum shown beats a wrong one.
    return { minutes: null, note: null }
  }
}

// How the reserve reads: comfortably legal, legal but thin, or short.
//
// The thin band exists because "legal" and "comfortable" are not the same
// answer, and a pilot landing on exactly the minimum has planned no margin for
// the thing that actually happens. Ten minutes is a hold, a go-around and a
// second circuit.
export function reserveStatus(minutes, requiredMin) {
  if (minutes == null) return 'unknown'
  if (requiredMin == null) return 'unknown'
  if (minutes < requiredMin) return 'short'
  if (minutes < requiredMin + 10) return 'thin'
  return 'ok'
}
