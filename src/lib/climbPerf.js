// Aircraft performance for altitude selection. What it costs to get up there,
// and what you get back once you are.
//
// The altitude engine needs to answer "does climbing higher pay for itself over
// this leg?", which needs four numbers the profile stores as prose strings
// ('124 kt', '6.1 GPH', '1,000 fpm', '14,000 ft DA') and two it may not store
// at all. Everything here is pure. No network, no IndexedDB, so it can be
// checked against the book figures in the POH.
//
// Nothing is silently invented: any value that had to be inferred is listed in
// `assumed` so the UI can say which numbers are the pilot's and which are ours.

const ISA_LAPSE = 6.87535e-6      // per foot, standard atmosphere
const DESCENT_FPM = 500           // comfortable, unpressurised, ears intact
const CLIMB_SPEED_FACTOR = 0.85   // Vy is slower than cruise
const DESCENT_SPEED_FACTOR = 1.05 // and descent is faster
const DESCENT_BURN_FACTOR = 0.6

// A number out of a string that carries its unit: '1,081 lb' -> 1081.
export function num(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

// Density ratio at a pressure altitude, ISA.
export function sigma(altFt) {
  return Math.max(0.05, (1 - ISA_LAPSE * altFt) ** 4.2559)
}

// Gagg-Farrar: the fraction of sea-level power a normally-aspirated engine
// still makes at altitude.
function powerRatio(altFt) {
  const s = sigma(altFt)
  return Math.max(0.05, (s - 0.117) / 0.883)
}

// Class is only used to guess the numbers a profile does not carry, and to pick
// where the engine stops making rated power.
function classify(tasKt, burnGph, category) {
  if (category === 'helicopter') return 'helicopter'
  if (tasKt > 200 || burnGph > 40) return 'turbine'
  if (tasKt > 140 || burnGph > 15) return 'hp-single'
  return 'light-single'
}

const DEFAULTS = {
  'light-single': { rocFpm: 700, ceilingFt: 13500, hCritFt: 8000 },
  'hp-single':    { rocFpm: 1000, ceilingFt: 17000, hCritFt: 8000 },
  'turbine':      { rocFpm: 1800, ceilingFt: 25000, hCritFt: 25000 },
  'helicopter':   { rocFpm: 1000, ceilingFt: 12000, hCritFt: 8000 },
}

// profile: the IndexedDB aircraft/profile record.
// Returns null only when there is no usable cruise speed at all, without that
// the whole model is guesswork and the caller should say so instead.
export function parseAircraftPerf(profile) {
  if (!profile) return null
  const tasKt = num(profile.vspeeds?.cruise)
  if (!tasKt) return null

  const burnCruiseGph = num(profile.burnRate?.cruise) ?? 0
  const klass = classify(tasKt, burnCruiseGph, profile.category)
  const def = DEFAULTS[klass]

  const rocRaw = num(profile.perf?.roc)
  const ceilRaw = num(profile.perf?.ceiling)
  const burnClimbRaw = num(profile.burnRate?.climb)

  return {
    tasKt,
    // The reference altitude for the published cruise speed. Book cruise
    // figures are quoted at 6,000–8,000 ft for pistons; using sea level would
    // overstate the speed gain from climbing.
    tasRefFt: klass === 'turbine' ? 20000 : 7000,
    burnCruiseGph,
    burnClimbGph: burnClimbRaw ?? (burnCruiseGph ? burnCruiseGph * 1.25 : 0),
    rocFpm: rocRaw ?? def.rocFpm,
    serviceCeilingFt: ceilRaw ?? def.ceilingFt,
    hCritFt: def.hCritFt,
    klass,
    assumed: {
      roc: rocRaw == null,
      ceiling: ceilRaw == null,
      burnClimb: burnClimbRaw == null,
    },
  }
}

// True airspeed at altitude. Constant-IAS gain below the critical altitude,
// power-limited above it: V is proportional to the cube root of available
// power in level flight.
export function tasAt(perf, altFt) {
  if (!perf) return null
  const base = perf.tasKt * (1 + 0.02 * (Math.min(altFt, perf.hCritFt) - perf.tasRefFt) / 1000)
  if (altFt <= perf.hCritFt) return Math.max(20, base)
  return Math.max(20, base * (powerRatio(altFt) / powerRatio(perf.hCritFt)) ** (1 / 3))
}

// Fuel flow falls with available power once the engine can no longer be leaned
// to rated output.
export function burnAt(perf, altFt) {
  if (!perf?.burnCruiseGph) return 0
  if (altFt <= perf.hCritFt) return perf.burnCruiseGph
  return perf.burnCruiseGph * (powerRatio(altFt) / powerRatio(perf.hCritFt))
}

// Absolute ceiling, where the climb rate reaches zero. Service ceiling is
// defined at 100 fpm, which is what makes this solvable.
function absoluteCeiling(perf) {
  if (perf.rocFpm <= 100) return perf.serviceCeilingFt
  return (perf.rocFpm * perf.serviceCeilingFt) / (perf.rocFpm - 100)
}

// Time, fuel and ground distance to climb between two altitudes.
//
// Climb rate falls linearly with altitude, so the time is the integral of
// dh/ROC(h): closed form, and it correctly runs away as the absolute ceiling
// is approached rather than pretending the aircraft still climbs there.
export function climbTo(perf, fromFt, toFt, hwKt = 0) {
  if (!perf || toFt <= fromFt) return { minutes: 0, gallons: 0, distNm: 0 }
  const hAbs = absoluteCeiling(perf)
  if (toFt >= hAbs) return null                      // cannot get there at all

  const minutes = (hAbs / perf.rocFpm) * Math.log((hAbs - fromFt) / (hAbs - toFt))
  if (!Number.isFinite(minutes) || minutes <= 0) return null

  const midTas = tasAt(perf, (fromFt + toFt) / 2) * CLIMB_SPEED_FACTOR
  return {
    minutes,
    gallons: (minutes / 60) * perf.burnClimbGph,
    distNm: (minutes / 60) * Math.max(20, midTas - hwKt),
  }
}

// Descent is flown at a chosen rate rather than a performance limit, so it is
// simple arithmetic, but it has to be modelled, because it is half of why a
// high altitude does not pay on a short leg.
export function descentFrom(perf, fromFt, toFt, hwKt = 0) {
  if (!perf || fromFt <= toFt) return { minutes: 0, gallons: 0, distNm: 0 }
  const minutes = (fromFt - toFt) / DESCENT_FPM
  const midTas = tasAt(perf, (fromFt + toFt) / 2) * DESCENT_SPEED_FACTOR
  return {
    minutes,
    gallons: (minutes / 60) * perf.burnCruiseGph * DESCENT_BURN_FACTOR,
    distNm: (minutes / 60) * Math.max(20, midTas - hwKt),
  }
}

// Block time and fuel for the whole leg at a given cruise altitude: climb,
// cruise, descent. `hwKt` is the headwind component at cruise (negative for a
// tailwind); the climb and descent use half of it, since they spend their time
// in the lower half of the column.
//
// Returns reachable:false when the climb and descent alone eat the leg. That
// is the arithmetic reason a 50 NM hop never recommends 12,000 ft, rather than
// a hardcoded rule about short legs.
export function legEconomics(perf, altFt, distNm, hwKt = 0, elevFt = 0) {
  if (!perf || !(distNm > 0)) return null
  const climb = climbTo(perf, elevFt, altFt, hwKt / 2)
  if (!climb) return { reachable: false, reason: 'above the aircraft ceiling' }
  const desc = descentFrom(perf, altFt, elevFt, hwKt / 2)

  const cruiseNm = distNm - climb.distNm - desc.distNm
  if (cruiseNm < 0.1 * distNm) {
    return { reachable: false, reason: 'climb and descent use up the leg' }
  }

  const gsKt = Math.max(20, tasAt(perf, altFt) - hwKt)
  const cruiseMin = (cruiseNm / gsKt) * 60
  return {
    reachable: true,
    blockMin: climb.minutes + cruiseMin + desc.minutes,
    gallons: climb.gallons + (cruiseMin / 60) * burnAt(perf, altFt) + desc.gallons,
    gsKt,
    hwKt,
    tasKt: tasAt(perf, altFt),
    climbMin: climb.minutes,
    // Time actually spent at the cruise altitude, which is what the oxygen
    // rule is measured against rather than the whole block time.
    cruiseMin,
    climbNm: climb.distNm,
    descentNm: desc.distNm,
    cruiseNm,
  }
}

// Headwind component of a wind at a given track. Positive slows you down.
export function headwindComponent(windDirDeg, windKt, trackDeg) {
  if (windDirDeg == null || windKt == null || trackDeg == null) return 0
  return windKt * Math.cos(((windDirDeg - trackDeg) * Math.PI) / 180)
}
