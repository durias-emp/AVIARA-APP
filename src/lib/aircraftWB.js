// Weight & Balance configs and calculation.
//
// Two sources of a config are supported:
//  1. The built-in Bell 206B config below (WB_CONFIGS) — verified against
//     BHT-206B3-FM-1, uses weight-tapered fwd/aft CG limit functions.
//  2. A user-entered config saved on the aircraft profile (`profile.wbConfig`).
//     Since every real tail number has different BEW/arms/equipment, we never
//     guess these — the user enters them once on the Aircraft page (source of
//     truth: POH/AFM/latest W&B report), and enters a longitudinal CG envelope
//     as a list of (CG, weight) points (and, optionally, a lateral envelope as
//     a list of (lateral CG, longitudinal CG) points for helicopters).
//
// calculateWB() works with either shape: it detects which kind of CG-limit
// data a config provides and checks the computed CG against it accordingly.
// Bell's own code path is unchanged from before this file supported custom
// configs — the branch it takes has always existed, just extracted so a
// second (polygon-based) branch could be added alongside it.

// ── Bell 206B-3 JetRanger III ─────────────────────────────────────────────────
const BELL_206B3 = {
  name: 'Bell 206B-3 JetRanger III',
  maxTOW: 3200,
  bew: { weight: 1976.0, longArm: 115.96, latArm: 0.14 },
  fuel: { lbPerGal: 6.7, longArm: 110.60, latArm: 0.0, maxGal: 91, label: 'Main tank · 6.7 lbs/USG', unit: 'USG' },
  stations: [
    { id: 'pilot',    label: 'Pilot',            sub: 'Front Right',   longArm: 65.0,  latArm:  14.0  },
    { id: 'pax1',     label: 'Front Left Pax',   sub: 'Front Left',    longArm: 65.0,  latArm: -11.0  },
    { id: 'pax2',     label: 'Rear Right Pax',   sub: 'Rear Right',    longArm: 104.0, latArm:  16.10 },
    { id: 'pax3',     label: 'Rear Center Pax',  sub: 'Rear Center',   longArm: 104.0, latArm:   0.0  },
    { id: 'pax4',     label: 'Rear Left Pax',    sub: 'Rear Left',     longArm: 104.0, latArm: -16.10 },
    { id: 'baggage',  label: 'Baggage',           sub: 'Compartment',   longArm: 148.0, latArm:   0.0  },
    { id: 'extender', label: 'Ext. Baggage',      sub: 'Max 42 lbs',    longArm: 185.0, latArm:   0.0, maxWeight: 42 },
  ],
  doors: {
    frontLeft:  { label: 'Fwd Left',  weight: 11, longArm: 66.0,  latArm: -25.0 },
    frontRight: { label: 'Fwd Right', weight: 11, longArm: 66.0,  latArm:  25.0 },
    rearLeft:   { label: 'Aft Left',  weight: 15, longArm: 100.0, latArm: -25.0 },
    rearRight:  { label: 'Aft Right', weight: 15, longArm: 100.0, latArm:  25.0 },
  },
  cgLimits: {
    latLeft: -3.0,
    latRight: 4.0,
    // Forward limit: 106" normally, 111.6" if any front door off
    longFwd: (anyFrontDoorOff) => anyFrontDoorOff ? 111.6 : 106.0,
    // Aft limit: linear from 114.2" at <=2425 lb to 111.6" at >=3200 lb
    longAft: (w) => {
      if (w <= 2425) return 114.2
      if (w >= 3200) return 111.6
      return 114.2 - (w - 2425) * 2.6 / 775
    },
  },
  // Chart axis ranges
  longChart: { cgMin: 105.0, cgMax: 115.0, wtMin: 1800, wtMax: 3400 },
  latChart:  { longMin: 105.0, longMax: 115.0, latMin: -4.0, latMax: 5.0 },
  // Longitudinal envelope polygon [cgIn, weightLb]
  longEnvelope: (cfg) => [
    [cfg.cgLimits.longFwd(false), 1800],
    [cfg.cgLimits.longFwd(false), cfg.maxTOW],
    [cfg.cgLimits.longAft(cfg.maxTOW), cfg.maxTOW],
    [114.2, 2425],
    [114.2, 1800],
  ],
  // Lateral envelope polygon [latIn, longCgIn] — matches BHT-206B3-FM-1 Fig 1-2
  latEnvelope: [
    [-2.3, 106.0],
    [ 3.0, 106.0],
    [ 4.0, 108.0],
    [ 4.0, 114.2],
    [-3.0, 114.2],
    [-3.0, 108.0],
  ],
  ref: 'BHT-206B3-FM-1',
  hasDoors: true,
  hasFrontDoorEffect: true,
  hasLateral: true,
}

// ── Registry ──────────────────────────────────────────────────────────────────
// Keys must match the `label` field in Aircraft.jsx TEMPLATES exactly
export const WB_CONFIGS = {
  'Bell 206B': BELL_206B3,
}

// ── Generic geometry helper — point-in-polygon (ray casting) ──────────────────
// Used to test whether a computed (x, y) point — e.g. (CG, weight) or
// (lateral CG, longitudinal CG) — falls inside a user-entered envelope
// polygon. Bell's own envelope uses weight-tapered fwd/aft functions instead
// (see calculateWB below) and never goes through this path.
function pointInPolygon([x, y], poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}

// ── Normalize a user-entered profile.wbConfig into calculation-ready shape ────
// Returns null if wbConfig is absent. Does NOT validate completeness — call
// validateWBConfig() on the result before trusting it for a "configured"
// state. Never invents/guesses a value that wasn't entered by the user.
export function normalizeUserWBConfig(wbConfig, profile) {
  if (!wbConfig) return null

  const num = v => {
    const n = parseFloat(v)
    return isFinite(n) ? n : null
  }

  const bewWeight  = num(wbConfig.bew?.weight)
  const bewLongArm = num(wbConfig.bew?.longArm)
  const bewLatArm  = num(wbConfig.bew?.latArm) ?? 0

  const maxTOW = num(wbConfig.maxTOW)

  const fuelLbPerGal = num(wbConfig.fuel?.lbPerGal)
  const fuelLongArm  = num(wbConfig.fuel?.longArm)
  const fuelMaxGal   = num(wbConfig.fuel?.maxGal)
  const fuelUnit     = wbConfig.fuel?.unit || 'USG'

  const stations = (wbConfig.stations ?? [])
    .map((s, i) => ({
      id: s.id || `station-${i}`,
      label: (s.label ?? '').trim(),
      sub: (s.sub ?? '').trim(),
      longArm: num(s.longArm),
      latArm: num(s.latArm) ?? 0,
      maxWeight: num(s.maxWeight) ?? undefined,
    }))
    .filter(s => s.label && s.longArm != null)

  const longEnvelopePoints = (wbConfig.longEnvelopePoints ?? [])
    .map(p => [num(p.cg), num(p.weight)])
    .filter(([cg, w]) => cg != null && w != null)

  const latEnvelopePoints = (wbConfig.latEnvelopePoints ?? [])
    .map(p => [num(p.lat), num(p.longCG)])
    .filter(([lat, lc]) => lat != null && lc != null)
  const hasLateral = latEnvelopePoints.length >= 3

  // Chart axis ranges — derived with a little padding, not user-entered
  const cgVals = longEnvelopePoints.map(p => p[0])
  const wtVals = [bewWeight, maxTOW, ...longEnvelopePoints.map(p => p[1])].filter(v => v != null)
  const cgMin = cgVals.length ? Math.min(...cgVals) - 1 : 0
  const cgMax = cgVals.length ? Math.max(...cgVals) + 1 : 1
  const wtMin = wtVals.length ? Math.min(...wtVals) - 100 : 0
  const wtMax = wtVals.length ? Math.max(...wtVals) + 100 : 1

  const latVals = latEnvelopePoints.map(p => p[0])
  const longFromLat = latEnvelopePoints.map(p => p[1])

  return {
    name: profile?.fullName || profile?.label || 'Custom Aircraft',
    maxTOW,
    bew: { weight: bewWeight, longArm: bewLongArm, latArm: bewLatArm },
    fuel: {
      lbPerGal: fuelLbPerGal,
      longArm: fuelLongArm,
      latArm: 0,
      maxGal: fuelMaxGal,
      unit: fuelUnit,
      label: fuelLbPerGal != null ? `${fuelUnit} · ${fuelLbPerGal} lbs/gal` : fuelUnit,
    },
    stations,
    hasDoors: false,
    hasFrontDoorEffect: false,
    hasLateral,
    longEnvelopePoints,
    longEnvelope: c => c.longEnvelopePoints,
    longChart: { cgMin, cgMax, wtMin, wtMax },
    latEnvelope: hasLateral ? latEnvelopePoints : undefined,
    latChart: hasLateral ? {
      longMin: Math.min(...longFromLat) - 1,
      longMax: Math.max(...longFromLat) + 1,
      latMin: Math.min(...latVals) - 1,
      latMax: Math.max(...latVals) + 1,
    } : undefined,
    cgLimits: {},
    ref: (wbConfig.source ?? '').trim() || 'User-entered',
  }
}

// ── Validate a normalized config is complete enough to compute real numbers ───
// Anything short of this shows a setup-required state rather than a
// misleadingly-blank or partially-correct calculator.
export function validateWBConfig(cfg) {
  if (!cfg) return false
  if (!(cfg.bew?.weight > 0)) return false
  if (!isFinite(cfg.bew?.longArm)) return false
  if (!(cfg.maxTOW > 0) || cfg.maxTOW <= cfg.bew.weight) return false
  if (!(cfg.fuel?.lbPerGal > 0)) return false
  if (!isFinite(cfg.fuel?.longArm)) return false
  if (!(cfg.stations?.length >= 1)) return false
  if (!(cfg.longEnvelopePoints?.length >= 3)) return false
  return true
}

// ── Resolve the active W&B config for an aircraft profile ─────────────────────
// Priority: a valid user-entered config on the profile, else the built-in
// Bell config (Bell only), else null (not configured).
export function getWBConfig(profile) {
  if (!profile) return null
  const userCfg = normalizeUserWBConfig(profile.wbConfig, profile)
  if (userCfg && validateWBConfig(userCfg)) return userCfg
  if (profile.label === 'Bell 206B') return WB_CONFIGS['Bell 206B']
  return null
}

// Pure W&B calculation — works with any config from getWBConfig()
export function calculateWB(cfg, weights, doors) {
  const { bew, fuel: fuelCfg, stations, doors: doorDefs, cgLimits, maxTOW } = cfg

  let adjW = bew.weight, adjLM = bew.weight * bew.longArm, adjLaM = bew.weight * (bew.latArm || 0)
  const removedDoors = []

  if (cfg.hasDoors) {
    Object.entries(doors).forEach(([key, isOn]) => {
      if (!isOn) {
        const d = doorDefs[key]
        adjW -= d.weight; adjLM -= d.weight * d.longArm; adjLaM -= d.weight * d.latArm
        removedDoors.push({ label: d.label, weight: -d.weight, longArm: d.longArm, latArm: d.latArm })
      }
    })
  }

  const items = []
  let zfW = adjW, zfLM = adjLM, zfLaM = adjLaM
  stations.forEach(s => {
    const w = parseFloat(weights[s.id]) || 0
    if (w === 0) return
    items.push({ label: s.label, sub: s.sub, weight: w, longArm: s.longArm, latArm: s.latArm || 0 })
    zfW += w; zfLM += w * s.longArm; zfLaM += w * (s.latArm || 0)
  })

  const zfLongCG = zfW > 0 ? zfLM / zfW : NaN
  const zfLatCG  = zfW > 0 ? zfLaM / zfW : NaN

  const fuelGal  = parseFloat(weights.fuel) || 0
  const fuelLbs  = fuelGal * fuelCfg.lbPerGal
  const auW      = zfW + fuelLbs
  const auLM     = zfLM + fuelLbs * fuelCfg.longArm
  const auLaM    = zfLaM + fuelLbs * (fuelCfg.latArm || 0)
  const auLongCG = auW > 0 ? auLM / auW : NaN
  const auLatCG  = auW > 0 ? auLaM / auW : NaN

  // ── Longitudinal limits — Bell-style weight-tapered functions, or a
  // user-entered envelope polygon tested via point-in-polygon ──
  const anyFrontDoorOff = cfg.hasFrontDoorEffect && (!doors.frontLeft || !doors.frontRight)
  let fwdLim, zfAft, auAft, zfLongOK, auLongOK

  if (typeof cgLimits?.longFwd === 'function' && typeof cgLimits?.longAft === 'function') {
    fwdLim = cgLimits.longFwd(anyFrontDoorOff)
    zfAft  = cgLimits.longAft(zfW)
    auAft  = cgLimits.longAft(auW)
    zfLongOK = isFinite(zfLongCG) && zfLongCG >= fwdLim && zfLongCG <= zfAft
    auLongOK = isFinite(auLongCG) && auLongCG >= fwdLim && auLongCG <= auAft
  } else {
    const poly = typeof cfg.longEnvelope === 'function' ? cfg.longEnvelope(cfg) : null
    zfLongOK = !!poly?.length && isFinite(zfLongCG) && zfW > 0 && pointInPolygon([zfLongCG, zfW], poly)
    auLongOK = !!poly?.length && isFinite(auLongCG) && auW > 0 && pointInPolygon([auLongCG, auW], poly)
  }

  // ── Lateral limits — scalar left/right (Bell), a user-entered envelope
  // polygon, or not applicable (aircraft with no lateral data at all) ──
  let zfLatOK = true, auLatOK = true
  if (cfg.hasLateral) {
    if (typeof cgLimits?.latLeft === 'number' && typeof cgLimits?.latRight === 'number') {
      zfLatOK = isFinite(zfLatCG) && zfLatCG >= cgLimits.latLeft && zfLatCG <= cgLimits.latRight
      auLatOK = isFinite(auLatCG) && auLatCG >= cgLimits.latLeft && auLatCG <= cgLimits.latRight
    } else if (cfg.latEnvelope?.length >= 3) {
      zfLatOK = isFinite(zfLatCG) && isFinite(zfLongCG) && pointInPolygon([zfLatCG, zfLongCG], cfg.latEnvelope)
      auLatOK = isFinite(auLatCG) && isFinite(auLongCG) && pointInPolygon([auLatCG, auLongCG], cfg.latEnvelope)
    }
  }

  return {
    adjBEW: { weight: adjW, longArm: bew.longArm, latArm: bew.latArm || 0 },
    removedDoors, items,
    fuel: fuelLbs > 0 ? { label: `Fuel (${fuelGal} ${fuelCfg.unit})`, weight: fuelLbs, longArm: fuelCfg.longArm, latArm: fuelCfg.latArm || 0 } : null,
    zeroFuel: { weight: zfW, longCG: zfLongCG, latCG: zfLatCG },
    allUp:    { weight: auW, longCG: auLongCG, latCG: auLatCG },
    limits:   { fwdLim, zfAft, auAft, anyFrontDoorOff },
    status: {
      hasData: items.length > 0 || fuelLbs > 0,
      overweight: auW > maxTOW,
      zfLongOK, zfLatOK, auLongOK, auLatOK,
    },
  }
}
