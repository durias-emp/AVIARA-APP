// Weight & Balance configs and calculation.
//
// The only source of a config is a user-entered config saved on the aircraft
// profile (`profile.wbConfig`). Since every real tail number has different
// BEW/arms/equipment, we never guess these. The user enters them once on
// the Aircraft page (source of truth: POH/AFM/latest W&B report), and enters
// a longitudinal CG envelope as a list of (CG, weight) points (and,
// optionally, a lateral envelope as a list of (lateral CG, longitudinal CG)
// points for helicopters). There is deliberately no generic/template
// fallback config: an aircraft with incomplete W&B setup has no config at
// all (getWBConfig returns null) rather than silently computing real numbers
// from a different aircraft's data.

// ── Generic geometry helper. Point-in-polygon (ray casting) ──────────────────
// Used to test whether a computed (x, y) point. E.g. (CG, weight) or
// (lateral CG, longitudinal CG). Falls inside a user-entered envelope
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
// Returns null if wbConfig is absent. Does NOT validate completeness. Call
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

  // Chart axis ranges: derived with a little padding, not user-entered
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
  return null
}

// Pure W&B calculation: works with any config from getWBConfig()
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

  // ── Longitudinal limits: Bell-style weight-tapered functions, or a
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

  // ── Lateral limits: scalar left/right (Bell), a user-entered envelope
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
