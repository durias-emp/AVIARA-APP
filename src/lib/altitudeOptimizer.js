// Deterministic scoring/ranking of legal cruise-altitude candidates — the
// "AI suggests the best altitude" feature, built as plain, explainable
// arithmetic rather than an LLM call, so every number in the suggestion is
// real, reproducible, and cross-referenceable (matches this app's existing
// "show the work" philosophy already used throughout Aircraft performance).
//
// `candidates` is always exactly the array ruleset.computed.cruisingAltitude
// already produces (src/lib/regulations.js) — this module never invents or
// filters that list, only annotates it. A factor this module can't compute
// is excluded (never guessed) and its weight is redistributed among what IS
// present, the same degrade convention as interpolateChart/getPerfChart in
// lib/aircraftPerf.js. If nothing at all is computable, every candidate's
// `score` is null — callers should show "not enough data to rank," never a
// fabricated ordering.
//
// Hard invariant for every caller: `disqualified` is informational only.
// This module never removes a legal altitude from consideration — the
// pilot always keeps final say over which one to fly.

const WEIGHTS = {
  time: 0.30,
  fuel: 0.20,
  terrain: 0.15,
  tfr: 0.15,
  icingTurbulence: 0.15,
  waterMargin: 0.05,
}

const HAZARD_PENALTY = { none: 0, unknown: 0.5, light: 0.4, moderate: 0.75, severe: 0.95 }

function minMaxPenalty(values, value) {
  const nums = values.filter(v => v != null)
  if (nums.length < 2 || value == null) return null
  const lo = Math.min(...nums), hi = Math.max(...nums)
  if (hi === lo) return 0
  return (value - lo) / (hi - lo)
}

// ctx = {
//   isIFR, courseDeg, totalDistNm, routeMaxMEA,
//   cruiseByAlt:  (altFt) => {tasKt, ffGph} | null   — chart-interpolated or flat POH fallback, caller's job
//   climbByAlt:   async (altFt) => {timeMin, fuelGal, distNm, caveats} | null   — sub-phase 2, optional
//   windByAlt:    (altFt) => {dir, spd, temp} | null                            — src/lib/windsAloft.js, optional
//   terrainByAlt: async (altFt) => {status, meetsMin, clearanceFt} | null       — analyzeTerrain, optional
//   waterResult:  {overwater, pctOverwater} | null                             — analyzeWater, altitude-independent
//   tfrConflicts: [{ desc, floorFt, ceilingFt, confirmed3D }]                  — existing lateral list; confirmed3D added in sub-phase 3
//   hazardByAlt:  async (altFt) => {risk:'none'|'light'|'moderate'|'severe'|'unknown', sources} | null  — sub-phase 4, optional
// }
export async function scoreAltitudes(candidates, ctx = {}) {
  if (!Array.isArray(candidates) || !candidates.length) return []

  const {
    isIFR = false, courseDeg = null, totalDistNm = null, routeMaxMEA = null,
    cruiseByAlt = null, climbByAlt = null, windByAlt = null, terrainByAlt = null,
    waterResult = null, tfrConflicts = [], hazardByAlt = null,
  } = ctx

  const rows = await Promise.all(candidates.map(async (alt) => {
    const caveats = []
    let timeMin = null, fuelGal = null, windComponentKt = null

    const cruise = cruiseByAlt ? cruiseByAlt(alt) : null
    const wind = windByAlt ? windByAlt(alt) : null
    if (wind != null && courseDeg != null) {
      windComponentKt = Math.round(wind.spd * Math.cos((wind.dir - courseDeg) * Math.PI / 180))
    }

    if (cruise?.tasKt && totalDistNm) {
      const groundSpeed = windComponentKt != null ? Math.max(1, cruise.tasKt - windComponentKt) : cruise.tasKt
      const cruiseTimeMin = (totalDistNm / groundSpeed) * 60
      const climb = climbByAlt ? await climbByAlt(alt) : null

      if (climb?.timeMin != null) {
        const cruiseOnlyMin = Math.max(0, cruiseTimeMin - (climb.distNm ? (climb.distNm / groundSpeed) * 60 : 0))
        timeMin = climb.timeMin + cruiseOnlyMin
        if (climb.fuelGal != null && cruise.ffGph != null) {
          fuelGal = climb.fuelGal + (cruiseOnlyMin / 60) * cruise.ffGph
        }
        if (climb.caveats?.length) caveats.push(...climb.caveats)
      } else {
        timeMin = cruiseTimeMin
        if (cruise.ffGph != null) fuelGal = (timeMin / 60) * cruise.ffGph
        caveats.push('Climb performance not available — comparing cruise-only time, not full trip time')
      }
    }

    const terrain = terrainByAlt ? await terrainByAlt(alt) : null
    const hazard = hazardByAlt ? await hazardByAlt(alt) : null

    // TFR: a conflict entry only becomes a hard disqualify once sub-phase 3
    // confirms the candidate altitude is actually inside its floor/ceiling
    // (confirmed3D === true). Lateral-only hits (confirmed3D absent/false)
    // stay a soft penalty forever — they can't prove the altitude is really
    // inside the restricted band.
    let tfrPenalty = 0, tfrNote = null, tfr3DHit = false
    for (const c of tfrConflicts) {
      const inBand = (c.floorFt == null || alt >= c.floorFt) && (c.ceilingFt == null || alt <= c.ceilingFt)
      if (c.confirmed3D === true && inBand) { tfrPenalty = 1; tfrNote = c.desc || 'Confirmed TFR conflict'; tfr3DHit = true; break }
      if (tfrPenalty < 0.6) { tfrPenalty = 0.6; tfrNote = 'Route passes near a TFR — altitude not verified against it' }
    }

    const disqualifyReasons = []
    if (isIFR && routeMaxMEA != null && alt < routeMaxMEA) {
      disqualifyReasons.push(`Below the route's minimum en route altitude (${routeMaxMEA.toLocaleString()} ft MEA)`)
    }
    if (tfr3DHit) disqualifyReasons.push(tfrNote)

    return { altitude: alt, timeMin, fuelGal, windComponentKt, terrain, hazard, tfrPenalty, tfrNote, tfr3DHit, disqualifyReasons, caveats }
  }))

  const timeVals = rows.map(r => r.timeMin)
  const fuelVals = rows.map(r => r.fuelGal)
  const overwaterOrMountain = !!waterResult?.overwater

  const withPenalties = rows.map(r => ({
    ...r,
    disqualified: r.disqualifyReasons.length > 0,
    penalties: {
      time: minMaxPenalty(timeVals, r.timeMin),
      fuel: minMaxPenalty(fuelVals, r.fuelGal),
      terrain: r.terrain?.status === 'ok' ? (r.terrain.meetsMin ? 0 : 0.85) : null,
      tfr: r.tfrPenalty,
      icingTurbulence: r.hazard ? (HAZARD_PENALTY[r.hazard.risk] ?? null) : null,
      waterMargin: null, // filled below — needs the full candidate set for ranking
    },
  }))

  if (overwaterOrMountain && withPenalties.length > 1) {
    const byAlt = [...withPenalties].sort((a, b) => a.altitude - b.altitude)
    byAlt.forEach((r, i) => { r.penalties.waterMargin = 1 - i / (byAlt.length - 1) })
  }

  return withPenalties.map(r => {
    const present = Object.entries(WEIGHTS).filter(([k]) => r.penalties[k] != null)
    const weightSum = present.reduce((s, [, w]) => s + w, 0)
    const rawScore = weightSum > 0
      ? 1 - present.reduce((s, [k, w]) => s + w * r.penalties[k], 0) / weightSum
      : null

    return {
      altitude: r.altitude,
      score: r.disqualified ? 0 : rawScore,
      disqualified: r.disqualified,
      disqualifyReasons: r.disqualifyReasons,
      breakdown: {
        timeMin: r.timeMin,
        fuelGal: r.fuelGal,
        windComponentKt: r.windComponentKt,
        terrain: r.terrain,
        water: waterResult,
        tfr: { note: r.tfrNote, confirmed3D: r.tfr3DHit },
        icingTurbulence: r.hazard,
        caveats: r.caveats,
      },
    }
  })
}
