// Which cruise altitude, and why.
//
// The philosophy is the highest practical altitude, for the better glide
// range, true airspeed, and radio and radar coverage that come with it. What
// holds it back is weather, aircraft capability, regulation, and the simple
// fact that a 45 NM hop cannot pay for a climb to 12,000 ft.
//
// Two tiers, deliberately kept apart:
//
//   GATES     remove an altitude from consideration and say why. Only hard
//             facts gate: terrain, MEA, ceiling, oxygen regulations, cloud
//             under VFR, and official severe hazards. A modelled indication
//             never gates: it is not a forecast and must not act like one.
//   PENALTIES subtract from 100. Additive, so the reasons list *is* the score
//             breakdown and every point has a quotable cause.
//
// The result is deterministic and computed offline where the data allows, so
// the recommendation stands on its own whether or not the briefing text is
// available.

import { bearing, haversineNm, sampleRoute } from './corridor'
import { loadAtmosphere, atAltitude } from './atmosphere'
import { analyzeHazards, worstAt } from './hazards'
import { parseAircraftPerf, legEconomics, headwindComponent } from './climbPerf'

const MOUNTAIN_FT = 5000
const CLOUD_SOLID = 60          // % cover at which a level counts as IMC
const CLOUD_FRAC_GATE = 0.2     // how much of the route in cloud before VFR is out

// The floor an altitude should clear, and whether missing it is illegal or
// merely unwise.
//
// IFR is regulation: §91.177 wants 1,000 ft over the highest obstacle within
// 4 NM, 2,000 ft in designated mountainous terrain. Missing it is a gate.
//
// VFR is NOT. §91.177 is titled "Minimum altitudes for IFR operations" and
// applies to nothing else; the VFR floor is §91.119, which is 500 ft above the
// surface away from congested areas and says nothing about the highest peak
// somewhere along a 1,167 NM route. Treating the IFR figure as a prohibition
// under VFR ruled out every altitude below the tallest thing anywhere in the
// corridor, and §91.211 rules out everything above 14,000 without oxygen. On
// any route near real mountains those two met in the middle and the answer was
// "no cruising altitude works for this route", which was not true and was the
// common case rather than the exception: from Reno almost every direction has
// a 12,000 ft peak within 5 NM of something.
//
// So under VFR the same figure becomes a penalty, and a heavy one. The pilot
// is told the ground is higher than the level they picked, in those words, and
// keeps the authority the regulation actually leaves them: fly the valley,
// route around it, or climb over it.
function terrainFloor(terrain, flightRules) {
  if (terrain?.status !== 'ok' || terrain.maxFt == null) return null
  const mountainous = terrain.maxFt > MOUNTAIN_FT
  return terrain.maxFt + (flightRules === 'IFR' && mountainous ? 2000 : 1000)
}

// Headwind component along the route at one altitude, weighted evenly across
// the sample points, using each sample's local track rather than the whole
// route's average course, since on a dog-leg those differ by more than the
// wind itself.
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
// distance, which nothing in a 9-25 km model grid can answer. The caller
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
  // Hazards do not depend on the winds. Official G-AIRMET icing and
  // turbulence come from the FAA's AWC, an entirely separate service, and
  // analyzeHazards already asks for the modelled bands only when it has a
  // profile to model them from. Gating the whole call on the wind fetch threw
  // away real, official forecasts whenever Open-Meteo was down or rate
  // limited, and those bands are not decoration: severe icing is a hard gate
  // and moderate icing a penalty, so losing them quietly loosened the
  // altitude advice at exactly the moment there was least else to go on.
  const hazards = await analyzeHazards(wps, atmo, { timeoutMs })

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
    // A gate under IFR, where it is the regulation. Under VFR it is a penalty
    // below, because it is not.
    if (floor != null && altFt < floor && flightRules === 'IFR') {
      gates.push({
        label: `Terrain. ${terrain.maxFt.toLocaleString()} ft peak needs ${fmtAlt(floor)}`,
      })
    }
    if (perf && altFt > perf.serviceCeilingFt) {
      gates.push({
        label: `Above the ${perf.serviceCeilingFt.toLocaleString()} ft service ceiling`,
        assumed: perf.assumed.ceiling,
      })
    }

    const wind = windAlong(atmo, altFt)
    const hwKt = wind?.hwKt ?? 0
    const econ = perf ? legEconomics(perf, altFt, distNm, hwKt, fieldElevFt) : null
    if (econ && !econ.reachable) {
      gates.push({ label: `Not worth it on ${Math.round(distNm)} NM. ${econ.reason}` })
    }

    // 91.211 is two rules, not one. Between 12,500 and 14,000 the crew needs
    // oxygen only for the part of the flight spent up there lasting more than
    // 30 minutes; above 14,000 it is required throughout. Treating everything
    // over 12,500 as forbidden ruled out altitudes that are perfectly legal,
    // and on a route where terrain had already taken the lower ones it left
    // the pilot with nothing at all.
    //
    // The 30 minutes is measured against cruise time, which is close enough:
    // the climb through the band adds a few minutes and the descent takes
    // them back, and a flight near the boundary is one to think about anyway.
    // Without an aircraft on file there is no cruise time, but there is still
    // a distance, and no light aircraft crosses 1,200 NM in half an hour. A
    // nominal 120 kt is plenty to tell twenty minutes from ten hours, and
    // leaving it unknown meant the rule quietly did not apply: the first run
    // of this recommended 13,500 ft without oxygen for a 1,192 NM flight.
    const minutesAtAlt = econ?.cruiseMin ?? (distNm / 120) * 60
    if (!hasOxygen && altFt > 14000) {
      gates.push({ label: 'Above 14,000 ft the crew needs oxygen throughout (91.211). None declared.' })
    } else if (!hasOxygen && altFt > 12500 && minutesAtAlt > 30) {
      gates.push({
        label: `${Math.round(minutesAtAlt)} min above 12,500 ft needs oxygen past the first 30 (91.211). None declared.`,
      })
    }

    const cloud = cloudAlong(atmo, altFt)
    const vfrFrac = flightRules === 'VFR' ? vfrCloudConflict(atmo, altFt) : null
    if (vfrFrac != null && vfrFrac > CLOUD_FRAC_GATE) {
      gates.push({
        label: `In cloud for ${Math.round(vfrFrac * 100)}% of the route. VFR cloud clearance`,
      })
    }

    const ice = worstAt(hazards.icing, altFt)
    const turb = worstAt(hazards.turbulence, altFt)
    if (ice?.official && ice.severity === 'severe') {
      gates.push({ label: 'Severe icing forecast (G-AIRMET)' })
    }
    if (ice?.official && ice.severity === 'moderate' && !isFIKI && ice.routeFrac > 0.15) {
      gates.push({ label: 'Moderate icing forecast (G-AIRMET). Aircraft not certified for known ice' })
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
    // so: being parked on it in moist air is worth avoiding.
    const freezing = atmo.status === 'ok'
      ? atmo.surface.map(s => s.freezingFt).filter(f => f != null)
      : []
    const freezingFt = freezing.length ? freezing.reduce((s, f) => s + f, 0) / freezing.length : null
    if (freezingFt != null && Math.abs(altFt - freezingFt) <= 2000 && (cloud?.meanPct ?? 0) >= 40) {
      add(8, 'at the freezing level', `0 °C near ${Math.round(freezingFt / 100) * 100} ft with cloud`)
    }
    // Terrain, in three bands.
    //
    // Under the floor is only reachable under VFR, since IFR gated it out
    // above. It is the heaviest penalty the engine applies, heavy enough that
    // an altitude which clears the ridge always outranks one that does not,
    // and it grows the further below the peak the level sits. Above the floor
    // but inside 2,000 ft of a mountain keeps the old thin-margin nudge.
    if (floor != null) {
      const margin = altFt - terrain.maxFt
      if (altFt < floor) {
        add(45 + Math.min(35, Math.max(0, -margin) / 100),
            margin < 0 ? 'below the highest terrain on this route' : 'inside 1,000 ft of the terrain',
            `${terrain.maxFt.toLocaleString()} ft peak in the corridor. ${fmtAlt(floor)} clears it by 1,000 ft`)
      } else if (terrain.maxFt > MOUNTAIN_FT && margin < 2000) {
        add((12 * (2000 - margin)) / 1000, 'thin terrain margin',
            `${Math.round(margin).toLocaleString()} ft above the highest terrain`)
      }
    }
    if (airspace?.status === 'ok') {
      const at = airspace.areas.filter(a => a.atCruise)
      const worst = at.find(a => a.cls === 'B') || at.find(a => a.cls === 'C') || at.find(a => a.cls === 'D')
      if (worst) {
        add({ B: 6, C: 3, D: 2 }[worst.cls] || 0, `Class ${worst.cls} at cruise`, worst.name)
      }
    }
    // Legal without oxygen for a short enough leg, and still worth a mark
    // against it: the margin is thin and the rule is measured in minutes.
    if (altFt > 12500) {
      add(10, hasOxygen ? 'oxygen in use' : 'oxygen needed past 30 min',
          `${Math.round(minutesAtAlt)} min at altitude`)
    } else if (altFt > 10000) {
      // No regulation here. The AIM recommends oxygen above 10,000 by day and
      // night vision starts going long before that, so this is a nudge and is
      // labelled as one rather than dressed up as a rule.
      add(3, 'thin air', 'above 10,000 ft, oxygen recommended')
    }
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

  // Geometry for the days the winds do not arrive: five points along the
  // track, the same shape loadAtmosphere would have returned.
  const { samples: csAll } = sampleRoute(wps, { spacingNm: 5, maxSamples: 400 })
  const csStep = Math.max(1, Math.floor((csAll.length - 1) / 4))
  const csSamples = []
  for (let i = 0; i < csAll.length && csSamples.length < 5; i += csStep) csSamples.push(csAll[i])
  if (csSamples[csSamples.length - 1] !== csAll[csAll.length - 1]) csSamples[csSamples.length - 1] = csAll[csAll.length - 1]

  const crossSection = buildCrossSection(atmo, hazards, terrain, {
    samples: csSamples, lengthNm: distNm,
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
      // stale/ageMin ride along so the card can say the winds are the last
      // set that arrived rather than presenting them as current.
      ? { model: atmo.model, hourISO: atmo.hourISO, samples: atmo.samples.length,
          stale: atmo.stale ?? false, ageMin: atmo.ageMin ?? null }
      : { status: atmo.status },
    hazards,
    degraded,
  }
}

// The vertical slice the cross-section draws: departure on the left,
// destination on the right, altitude up. Everything is already computed by
// this point: this only reshapes it into per-column arrays the renderer can
// walk without knowing where any of it came from.
export function buildCrossSection(atmo, hazards, terrain, {
  chosenAltFt = null, recommendedAltFt = null, meaFt = null, ceilingFt = null, maxAltFt = 18000,
  samples = null, lengthNm = null,
} = {}) {
  // Only the sky layers need the wind profile. Terrain, official icing and
  // turbulence bands, the MEA and the service ceiling all come from elsewhere,
  // and a chart showing an icing band across the altitudes you were choosing
  // between is worth drawing even on a day the winds never arrived. Without
  // any geometry at all there is nothing to draw against, so that still
  // returns null.
  const ok = atmo?.status === 'ok'
  const geom = ok
    ? { pts: atmo.samples, len: atmo.lengthNm }
    : (samples?.length ? { pts: samples, len: lengthNm } : null)
  if (!geom) return null

  const x = geom.pts.map(s => ({ distNm: Math.round(s.distNm), lat: s.lat, lon: s.lon }))
  const levelsFt = []
  for (let a = 1000; a <= Math.max(maxAltFt, 6000); a += 1000) levelsFt.push(a)

  const cloud = ok ? atmo.columns.map(col => levelsFt.map(a => atAltitude(col, a)?.cloudPct ?? 0)) : []
  const wind = []
  if (ok) atmo.columns.forEach((col, i) => {
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
    lengthNm: Math.round(geom.len),
    x, levelsFt, cloud, wind, terrainFt,
    freezingFt: ok ? atmo.surface.map(s => s.freezingFt) : null,
    bands: [...(hazards?.icing || []), ...(hazards?.turbulence || [])],
    chosenAltFt, recommendedAltFt, meaFt, ceilingFt, maxAltFt,
    // The renderer says which layers are missing rather than drawing a chart
    // that looks complete and happens to have no weather in it.
    skyMissing: !ok,
    // The FB fallback carries wind and temperature but no cloud or humidity,
    // so the chart is real and the cloud shading is simply not part of it.
    cloudMissing: ok && atmo.cloudMissing === true,
  }
}

export { fmtAlt }
