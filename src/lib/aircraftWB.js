// Weight & Balance configs keyed by aircraft template label (from Aircraft page)
// Each config provides all aircraft-specific constants needed to compute and chart W&B

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
}

// ── Registry ──────────────────────────────────────────────────────────────────
// Keys must match the `label` field in Aircraft.jsx TEMPLATES exactly
export const WB_CONFIGS = {
  'Bell 206B': BELL_206B3,
}

// Returns the W&B config for the given aircraft label, or null if not available
export function getWBConfig(aircraftLabel) {
  return WB_CONFIGS[aircraftLabel] ?? null
}

// Pure W&B calculation — works with any config from WB_CONFIGS
export function calculateWB(cfg, weights, doors) {
  const { bew, fuel: fuelCfg, stations, doors: doorDefs, cgLimits, maxTOW } = cfg

  let adjW = bew.weight, adjLM = bew.weight * bew.longArm, adjLaM = bew.weight * bew.latArm
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
    items.push({ label: s.label, sub: s.sub, weight: w, longArm: s.longArm, latArm: s.latArm })
    zfW += w; zfLM += w * s.longArm; zfLaM += w * s.latArm
  })

  const zfLongCG = zfW > 0 ? zfLM / zfW : NaN
  const zfLatCG  = zfW > 0 ? zfLaM / zfW : NaN

  const fuelGal  = parseFloat(weights.fuel) || 0
  const fuelLbs  = fuelGal * fuelCfg.lbPerGal
  const auW      = zfW + fuelLbs
  const auLM     = zfLM + fuelLbs * fuelCfg.longArm
  const auLaM    = zfLaM + fuelLbs * fuelCfg.latArm
  const auLongCG = auW > 0 ? auLM / auW : NaN
  const auLatCG  = auW > 0 ? auLaM / auW : NaN

  const anyFrontDoorOff = cfg.hasFrontDoorEffect && (!doors.frontLeft || !doors.frontRight)
  const fwdLim = cgLimits.longFwd(anyFrontDoorOff)
  const zfAft  = cgLimits.longAft(zfW)
  const auAft  = cgLimits.longAft(auW)

  return {
    adjBEW: { weight: adjW, longArm: bew.longArm, latArm: bew.latArm },
    removedDoors, items,
    fuel: fuelLbs > 0 ? { label: `Fuel (${fuelGal} ${fuelCfg.unit})`, weight: fuelLbs, longArm: fuelCfg.longArm, latArm: fuelCfg.latArm } : null,
    zeroFuel: { weight: zfW, longCG: zfLongCG, latCG: zfLatCG },
    allUp:    { weight: auW, longCG: auLongCG, latCG: auLatCG },
    limits:   { fwdLim, zfAft, auAft, anyFrontDoorOff },
    status: {
      hasData: items.length > 0 || fuelLbs > 0,
      overweight: auW > maxTOW,
      zfLongOK: isFinite(zfLongCG) && zfLongCG >= fwdLim && zfLongCG <= zfAft,
      zfLatOK:  isFinite(zfLatCG)  && zfLatCG  >= cgLimits.latLeft && zfLatCG <= cgLimits.latRight,
      auLongOK: isFinite(auLongCG) && auLongCG >= fwdLim && auLongCG <= auAft,
      auLatOK:  isFinite(auLatCG)  && auLatCG  >= cgLimits.latLeft && auLatCG <= cgLimits.latRight,
    },
  }
}
