// Which cruise altitude, and why.
//
// The philosophy is the highest practical altitude — better glide range, better
// true airspeed, better radio and radar coverage — held back by weather,
// aircraft capability, regulation, and the simple fact that a 45 NM hop cannot
// pay for a climb to 12,000 ft.
//
// Two tiers, deliberately kept apart:
//
//   GATES     remove an altitude from consideration and say why. Only hard
//             facts gate: terrain, MEA, ceiling, oxygen regulations, cloud
//             under VFR, and official severe hazards. A modelled indication
//             never gates — it is not a forecast and must not act like one.
//   PENALTIES subtract from 100. Additive, so the reasons list *is* the score
//             breakdown and every point has a quotable cause.
//
// The result is deterministic and computed offline where the data allows, so
// the recommendation stands on its own whether or not the briefing text is
// available.

import { bearing, haversineNm } from './corridor'
import { loadAtmosphere, atAltitude } from './atmosphere'
import { analyzeHazards, worstAt } from './hazards'
import { parseAircraftPerf, legEconomics, headwindComponent } from './climbPerf'

const MOUNTAIN_FT = 5000
const CLOUD_SOLID = 60          // % cover at which a level counts as IMC
const CLOUD_FRAC_GATE = 0.2     // how much of the route in cloud before VFR is out

// The floor an altitude must clear.
//
// IFR is the regulation: §91.177 wants 1,000 ft over the highest obstacle
// within 4 NM, 2,000 ft in designated mountainous terrain. VFR has no en-route
// minimum beyond §91.119, so the gate stays at 1,000 ft — enough to be clear
// of the ridge — and the extra margin mountains deserve is applied as a
// penalty instead of a prohibition. Pilots do fly valleys VFR; the app should
// discourage a thin margin, not refuse to plan it.
function terrainFloor(terrain, flightRules) {
  if (terrain?.status !== 'ok' || terrain.maxFt == null) return null
  const mountainous = terrain.maxFt > MOUNTAIN_FT
  return terrain.maxFt + (flightRules === 'IFR' && mountainous ? 2000 : 1000)
}

// Headwind component along the route at one altitude, weighted evenly across
// the sample points, using each sample's local track rather than the whole
// route's average course — on a dog-leg those differ by more than the wind.
function windAlong(atmo, altFt) {
  if (atmo?.status !== 'ok') return null
  let sumHw = 0, n = 0, sumKt = 0, u = 0, v = 0
  for (let i = 0; i < atmo.samples.length; i++) {
    const cell = atAltitude(atmo.columns[i], altFt)
    if (!cell || cell.windKt == null) continue
    const a = atmo.samples[Math.max(0, i - 1)]
    const b = atmo.samples[Math.min(atmo.samples.length - 1, i + 1)]
    const trk = a === b ? 0 : bearing([a.lat, a.lon], [b.lat, b.lon])
    sumHw += headwindComponent(cell.windDirDeg, cell.windKt, trk)
    sumKt += cell.windKt
    u += -cell.windKt * Math.sin((cell.windDirDeg * Math.PI) / 180)
    v += -cell.windKt * Math.cos((cell.windDirDeg * Math.PI) / 180)
    n++
  }
  if (!n) return null
  return {
    hwKt: sumHw / n,
    windKt: sumKt / n,
    windDirDeg: ((Math.atan2(-u / n, -v / n) * 180) / Math.PI + 360) % 360,
  }
}

// Mean cloud cover at an altitude and the fraction of the route where it is
// solid enough to be IMC.
function cloudAlong(atmo, altFt) {
  if (atmo?.status !== 'ok') return null
  const cells = atmo.columns.map(c => atAltitude(c, altFt)).filter(Boolean)
  if (!cells.length) return null
  const cover = cells.map(c => c.cloudPct ?? 0)
  return {
    meanPct: cover.reduce((s, x) => s + x, 0) / cover.length,
    frac: cover.filter(x => x >= CLOUD_SOLID).length / cover.length,
    tempC: cells.map(c => c.tempC).filter(t => t != null).reduce((s, t, _, a) => s + t / a.length, 0),
  }
}

// VFR cloud clearance, vertical only. §91.155 also requires horizontal
// distance, which nothing in a 9-25 km model grid can answer — the caller
// says so rather than implying the whole rule was checked.
function vfrCloudConflict(atmo, altFt) {
  if (atmo?.status !== 'ok') return null
  const below = altFt < 10000 ? 500 : 1000
  const above = 1000
  let hits = 0
  for (const col of atmo.columns) {
    let inCloud = false
    for (const lv of col) {
      if (lv.altFt >= altFt - below && lv.altFt <= altFt + above && (lv.cloudPct ?? 0) >= CLOUD_SOLID) {
        inCloud = true
        break
      }
    }
    if (inCloud) hits++
  }
  return hits / atmo.columns.length
}

function fmtAlt(ft) {
  return ft >= 18000 ? `FL${Math.round(ft / 100)}` : `${ft.toLocaleString()} ft`
}

// waypoints:      [{lat, lon}, ...] the flown route
// candidateAlts:  legal altitudes for the direction of flight
// aircraft:       the IndexedDB aircraft/profile record
// terrain/airspace: results the caller already holds, to avoid refetching
//
// Returns { status:'ok', recommended, candidates, rejected, atmosphere,
//           hazards, degraded } or a status the caller must surface.
export async function recommendCruise(waypoints, {
  flightRules = 'VFR',
  candidateAlts = [],
  aircraft = null,
  routeMaxMEA = null,
  departAtISO = null,
  terrain = null,
  airspace = null,
  fieldElevFt = 0,
  hasOxygen = false,
  isFIKI = false,
  timeoutMs = 12000,
} = {}) {
  const wps = (waypoints || []).filter(w => Number.isFinite(w?.lat) && Number.isFinite(w?.lon))
  if (wps.length < 2 || !candidateAlts.length) return { status: 'empty' }

  let distNm = 0
  for (let i = 0; i < wps.length - 1; i++) {
    distNm += haversineNm(wps[i].lat, wps[i].lon, wps[i + 1].lat, wps[i + 1].lon)
  }

  const perf = parseAircraftPerf(aircraft)
  const maxAlt = Math.max(...candidateAlts)
  const atmo = await loadAtmosphere(wps, { departAtISO, maxAltFt: maxAlt, timeoutMs })
  const hazards = atmo.status === 'ok'
    ? await analyzeHazards(wps, atmo, { timeoutMs })
    : { status: 'unavailable', icing: [], turbulence: [], coverage: {}, convective: null }

  const degraded = []
  if (atmo.status !== 'ok') degraded.push('winds-aloft-unavailable')
  if (!perf) degraded.push('no-aircraft-performance')
  else if (perf.assumed.roc || perf.assumed.ceiling) degraded.push('assumed-climb-performance')
  if (terrain?.status !== 'ok') degraded.push('terrain-unavailable')

  const floor = terrainFloor(terrain, flightRules)
  const scored = []
  const rejected = []

  for (const altFt of candidateAlts) {
    const gates = []
    const reasons = []

    // ── gates ──────────────────────────────────────────────
    if (routeMaxMEA && flightRules === 'IFR' && altFt < routeMaxMEA) {
      gates.push({ label: `Below the ${routeMaxMEA.toLocaleString()} ft MEA on this routing` })
    }
    if (floor != null && altFt < floor) {
      gates.push({
        label: `Terrain — ${terrain.maxFt.toLocaleString()} ft peak needs ${fmtAlt(floor)}`,
      })
    }
    if (perf && altFt > perf.serviceCeilingFt) {
      gates.push({
        label: `Above the ${perf.serviceCeilingFt.toLocaleString()} ft service ceiling`,
        assumed: perf.assumed.ceiling,
      })
    }
    if (!hasOxygen && altFt > 12500) {
      gates.push({ label: 'Oxygen required above 12,500 ft (§91.211) — none declared' })
    }

    const wind = windAlong(atmo, altFt)
    const hwKt = wind?.hwKt ?? 0
    const econ = perf ? legEconomics(perf, altFt, distNm, hwKt, fieldElevFt) : null
    if (econ && !econ.reachable) {
      gates.push({ label: `Not worth it on ${Math.round(distNm)} NM — ${econ.reason}` })
    }

    const cloud = cloudAlong(atmo, altFt)
    const vfrFrac = flightRules === 'VFR' ? vfrCloudConflict(atmo, altFt) : null
    if (vfrFrac != null && vfrFrac > CLOUD_FRAC_GATE) {
      gates.push({
        label: `In cloud for ${Math.round(vfrFrac * 100)}% of the route — VFR cloud clearance`,
      })
    }

    const ice = worstAt(hazards.icing, altFt)
    const turb = worstAt(hazards.turbulence, altFt)
    if (ice?.official && ice.severity === 'severe') {
      gates.push({ label: 'Severe icing forecast (G-AIRMET)' })
    }
    if (ice?.official && ice.severity === 'moderate' && !isFIKI && ice.routeFrac > 0.15) {
      gates.push({ label: 'Moderate icing forecast (G-AIRMET) — aircraft not certified for known ice' })
    }
    if (turb?.official && turb.severity === 'severe') {
      gates.push({ label: 'Severe turbulence forecast (G-AIRMET)' })
    }

    if (gates.length) {
      rejected.push({ altFt, gates })
      continue
    }

    // ── penalties ──────────────────────────────────────────
    let score = 100
    const add = (points, label, detail, extra = {}) => {
      if (!points) return
      score -= points
      reasons.push({ points: -Math.round(points), label, detail, ...extra })
    }

    if (ice) {
      const base = { trace: 4, light: 12, moderate: 25, severe: 40 }[ice.severity] || 0
      const w = base * ice.routeFrac * (isFIKI ? 0.5 : 1) * (ice.official ? 1 : 0.5)
      add(w, `${ice.severity} icing`, `${ice.basis} · ${Math.round(ice.routeFrac * 100)}% of route`,
          { source: ice.source, official: ice.official })
    }
    if (turb) {
      const base = { light: 5, moderate: 18, severe: 30 }[turb.severity] || 0
      const w = base * turb.routeFrac * (turb.official ? 1 : 0.5)
      add(w, `${turb.severity} turbulence`, `${turb.basis} · ${Math.round(turb.routeFrac * 100)}% of route`,
          { source: turb.source, official: turb.official })
    }
    if (flightRules === 'IFR' && cloud?.frac) {
      add(10 * cloud.frac, 'in cloud', `${Math.round(cloud.frac * 100)}% of the route IMC`)
    }
    // The freezing level is where airframe ice lives even when no product says
    // so — being parked on it in moist air is worth avoiding.
    const freezing = atmo.status === 'ok'
      ? atmo.surface.map(s => s.freezingFt).filter(f => f != null)
      : []
    const freezingFt = freezing.length ? freezing.reduce((s, f) => s + f, 0) / freezing.length : null
    if (freezingFt != null && Math.abs(altFt - freezingFt) <= 2000 && (cloud?.meanPct ?? 0) >= 40) {
      add(8, 'at the freezing level', `0 °C near ${Math.round(freezingFt / 100) * 100} ft with cloud`)
    }
    if (floor != null && terrain.maxFt > MOUNTAIN_FT) {
      const margin = altFt - terrain.maxFt
      if (margin < 2000) add((12 * (2000 - margin)) / 1000, 'thin terrain margin',
                             `${Math.round(margin).toLocaleString()} ft above the highest terrain`)
    }
    if (airspace?.status === 'ok') {
      const at = airspace.areas.filter(a => a.atCruise)
      const worst = at.find(a => a.cls === 'B') || at.find(a => a.cls === 'C') || at.find(a => a.cls === 'D')
      if (worst) {
        add({ B: 6, C: 3, D: 2 }[worst.cls] || 0, `Class ${worst.cls} at cruise`, worst.name)
      }
    }
    if (altFt > 12500) add(10, 'oxygen required', 'above 12,500 ft (§91.211)')
    else if (altFt > 10000) add(3, 'oxygen after 30 min', '10,000–12,500 ft (§91.211)')
    if (perf && altFt > 0.9 * perf.serviceCeilingFt) {
      add(10, 'near the service ceiling', 'little climb rate or manoeuvre margin left')
    }

    scored.push({
      altFt, score, reasons, econ, wind, cloud, ice, turb,
      oatC: cloud?.tempC ?? null,
    })
  }

  if (!scored.length) {
    return { status: 'no-legal-altitude', rejected, atmosphere: atmo, hazards, degraded, distNm }
  }

  // Time and fuel are only comparable once every candidate is known, so those
  // penalties are applied in a second pass.
  const reachable = scored.filter(c => c.econ?.reachable)
  if (reachable.length) {
    const fastest = Math.min(...reachable.map(c => c.econ.blockMin))
    const leanest = Math.min(...reachable.map(c => c.econ.gallons))
    for (const c of reachable) {
      const lost = c.econ.blockMin - fastest
      if (lost > 0.5) {
        const p = Math.min(40, lost * 2)
        c.score -= p
        c.reasons.push({
          points: -Math.round(p), label: 'slower',
          detail: `${Math.round(lost)} min more than the quickest option`,
        })
      }
      const extra = c.econ.gallons - leanest
      if (extra > 0.5) {
        const p = Math.min(15, extra * 2)
        c.score -= p
        c.reasons.push({
          points: -Math.round(p), label: 'more fuel',
          detail: `${extra.toFixed(1)} gal more than the most economical`,
        })
      }
      if (c.wind && c.wind.hwKt < -5) {
        c.reasons.push({
          points: 0, label: `${Math.abs(Math.round(c.wind.hwKt))} kt tailwind`,
          detail: `${Math.round(c.wind.windDirDeg)}° at ${Math.round(c.wind.windKt)} kt`,
        })
      } else if (c.wind && c.wind.hwKt > 5) {
        c.reasons.push({
          points: 0, label: `${Math.round(c.wind.hwKt)} kt headwind`,
          detail: `${Math.round(c.wind.windDirDeg)}° at ${Math.round(c.wind.windKt)} kt`,
        })
      }
    }
  }

  for (const c of scored) c.score = Math.max(0, Math.round(c.score))
  // Ties go to the lower altitude: less climb, more options, warmer air.
  scored.sort((a, b) => b.score - a.score || a.altFt - b.altFt)

  const crossSection = buildCrossSection(atmo, hazards, terrain, {
    recommendedAltFt: scored[0]?.altFt ?? null,
    meaFt: routeMaxMEA,
    ceilingFt: perf?.serviceCeilingFt ?? null,
    maxAltFt: Math.min(maxAlt, perf?.serviceCeilingFt ? perf.serviceCeilingFt + 2000 : maxAlt),
  })

  return {
    status: 'ok',
    recommended: scored[0],
    candidates: scored,
    rejected,
    distNm,
    perf,
    crossSection,
    atmosphere: atmo.status === 'ok'
      ? { model: atmo.model, hourISO: atmo.hourISO, samples: atmo.samples.length }
      : { status: atmo.status },
    hazards,
    degraded,
  }
}

// The vertical slice the cross-section draws: departure on the left,
// destination on the right, altitude up. Everything is already computed by
// this point — this only reshapes it into per-column arrays the renderer can
// walk without knowing where any of it came from.
export function buildCrossSection(atmo, hazards, terrain, {
  chosenAltFt = null, recommendedAltFt = null, meaFt = null, ceilingFt = null, maxAltFt = 18000,
} = {}) {
  if (atmo?.status !== 'ok') return null

  const x = atmo.samples.map(s => ({ distNm: Math.round(s.distNm), lat: s.lat, lon: s.lon }))
  const levelsFt = []
  for (let a = 1000; a <= Math.max(maxAltFt, 6000); a += 1000) levelsFt.push(a)

  const cloud = atmo.columns.map(col => levelsFt.map(a => atAltitude(col, a)?.cloudPct ?? 0))
  const wind = []
  atmo.columns.forEach((col, i) => {
    if (i % 2 !== 0 && i !== atmo.columns.length - 1) return   // every other column
    for (let a = 2000; a <= maxAltFt; a += 4000) {
      const c = atAltitude(col, a)
      if (c?.windKt == null) continue
      wind.push({ distNm: x[i].distNm, altFt: a, dirDeg: c.windDirDeg, kt: c.windKt })
    }
  })

  // terrain.centerlineFt runs along the same track at its own spacing, so it
  // is resampled by position rather than assumed to line up.
  const terrainFt = terrain?.status === 'ok' && terrain.centerlineFt?.length
    ? x.map((_, i) => {
        const t = i / Math.max(1, x.length - 1)
        return terrain.centerlineFt[Math.round(t * (terrain.centerlineFt.length - 1))]
      })
    : null

  return {
    lengthNm: Math.round(atmo.lengthNm),
    x, levelsFt, cloud, wind, terrainFt,
    freezingFt: atmo.surface.map(s => s.freezingFt),
    bands: [...(hazards?.icing || []), ...(hazards?.turbulence || [])],
    chosenAltFt, recommendedAltFt, meaFt, ceilingFt, maxAltFt,
  }
}

export { fmtAlt }
