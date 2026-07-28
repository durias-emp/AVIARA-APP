// Icing and turbulence along the route, as altitude bands.
//
// Two sources, and the difference between them is never blurred:
//
//   OFFICIAL  G-AIRMET, the FAA's own graphical AIRMET — real forecast areas
//             with a severity and published base/top. United States only.
//   MODELLED  Derived here from the Open-Meteo profile where no official
//             product exists: icing from the classic temperature/humidity
//             envelope, turbulence from vertical wind shear. These are
//             indications, not forecasts. They are labelled "modelled", drawn
//             dashed, carry the numbers they were derived from, never remove
//             an altitude from the list, and count half in the score.
//
// Where an official band covers a level, the modelled band for that level is
// dropped rather than merged — a hazard should have one provenance, not a
// blend of a forecast and an inference.

import { sampleRoute } from './corridor'

const AWC = '/api/awc'
const US_BOXES = [
  [24.0, 50.0, -125.0, -66.0],   // CONUS
  [51.0, 72.0, -170.0, -129.0],  // Alaska
  [18.0, 23.0, -161.0, -154.0],  // Hawaii
]
const inUS = wps => wps.some(w => US_BOXES.some(([s, n, west, e]) =>
  w.lat >= s && w.lat <= n && w.lon >= west && w.lon <= e))

const SEVERITY_RANK = { trace: 1, light: 2, moderate: 3, severe: 4 }
const AWC_SEVERITY = { LGT: 'light', 'LGT-MOD': 'light', MOD: 'moderate', 'MOD-SEV': 'severe', SEV: 'severe' }

function pointInPoly(lat, lon, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a[0] > lat) !== (b[0] > lat) &&
        lon < ((b[1] - a[1]) * (lat - a[0])) / (b[0] - a[0]) + a[1]) inside = !inside
  }
  return inside
}

// G-AIRMET base/top are hundreds of feet, and either can be absent: a missing
// top means unbounded, not zero. Getting this backwards inverts every gate.
function ft(v, fallback) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n * 100 : fallback
}

async function fetchGairmet(hazard, timeoutMs) {
  const url = `${AWC}?path=gairmet&format=json&hazard=${hazard}`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(String(res.status))
  // AWC answers 204 with an empty body when the product is current and holds
  // nothing — no icing G-AIRMETs anywhere in the country, which is ordinary on
  // a summer afternoon. Parsing that as JSON throws, and the rejection used to
  // be read as "the service is down", which downgraded coverage to none and
  // sent the card looking for a modelled substitute. "Asked, and there is
  // none" is a better answer than either.
  if (res.status === 204) return []
  const text = await res.text()
  if (!text.trim()) return []
  const data = JSON.parse(text)
  return Array.isArray(data) ? data : []
}

// Bands from the official product, clipped to the part of the route inside
// each area — a band that touches 10 NM of a 500 NM route should not read the
// same as one that covers the whole thing.
function officialBands(records, samples, kind) {
  const out = []
  for (const r of records) {
    const poly = (r.coords || []).map(c => [parseFloat(c.lat), parseFloat(c.lon)])
    if (poly.length < 3) continue
    const hits = samples.filter(s => pointInPoly(s.lat, s.lon, poly))
    if (!hits.length) continue

    out.push({
      kind,
      severity: AWC_SEVERITY[r.severity] || 'light',
      baseFt: ft(r.base, 0),
      topFt: ft(r.top, 60000),
      fromDistNm: Math.round(hits[0].distNm),
      toDistNm: Math.round(hits[hits.length - 1].distNm),
      routeFrac: hits.length / samples.length,
      source: 'G-AIRMET',
      official: true,
      basis: `G-AIRMET ${r.tag || ''} ${r.severity || ''} valid ${r.validTime || ''}`.trim(),
      validTime: r.validTime || null,
    })
  }
  return out
}

// ── Modelled indications ─────────────────────────────────────────
// Icing needs supercooled water: liquid cloud below freezing. The classic
// envelope is 0 to -20 °C with high humidity, worst around -8 to -12 °C where
// droplets stay large and liquid.
function icingFromProfile(column) {
  const bands = []
  for (const lv of column) {
    if (lv.tempC == null || lv.rhPct == null) continue
    const t = lv.tempC, rh = lv.rhPct, cloud = lv.cloudPct ?? 0
    if (t > 0 || t < -20) continue
    // Icing needs visible moisture. Cold, humid, cloudless air ices nothing,
    // and reporting a band there would be a hazard the pilot cannot verify.
    if (cloud < 25) continue
    let severity = null
    if (t <= -2 && t >= -15 && rh >= 90 && cloud >= 70) severity = 'moderate'
    else if (rh >= 70 && cloud >= 40) severity = 'light'
    else if (rh >= 60) severity = 'trace'
    if (!severity) continue
    bands.push({
      baseFt: lv.altFt - 1000, topFt: lv.altFt + 1000, severity,
      basis: `${t.toFixed(0)} °C, RH ${rh.toFixed(0)}%, cloud ${cloud.toFixed(0)}%`,
    })
  }
  return bands
}

// Clear-air turbulence tracks vertical wind shear. Thresholds are the usual
// operational rule of thumb in knots per 1,000 ft.
function turbulenceFromProfile(column) {
  const bands = []
  for (let i = 0; i < column.length - 1; i++) {
    const a = column[i], b = column[i + 1]
    if (a.windKt == null || b.windKt == null || a.windDirDeg == null || b.windDirDeg == null) continue
    const uv = w => [-w.windKt * Math.sin((w.windDirDeg * Math.PI) / 180),
                     -w.windKt * Math.cos((w.windDirDeg * Math.PI) / 180)]
    const [ua, va] = uv(a), [ub, vb] = uv(b)
    const dz = Math.max(500, b.altFt - a.altFt)
    const shear = (Math.hypot(ub - ua, vb - va) / dz) * 1000
    let severity = null
    if (shear >= 14) severity = 'moderate'
    else if (shear >= 8) severity = 'moderate'
    else if (shear >= 4) severity = 'light'
    if (!severity) continue
    bands.push({
      baseFt: a.altFt, topFt: b.altFt, severity,
      basis: `shear ${shear.toFixed(0)} kt/1000 ft`,
    })
  }
  return bands
}

// Merge per-sample bands into route-wide ones, carrying the along-track
// fraction so the engine can weigh a patch differently from a wall.
function collapse(perSample, kind, samples) {
  const byKey = new Map()
  perSample.forEach((bands, i) => {
    for (const b of bands) {
      const key = `${Math.round(b.baseFt / 1000)}|${b.severity}`
      const prev = byKey.get(key)
      const dist = samples[i]?.distNm ?? 0
      if (prev) {
        prev.baseFt = Math.min(prev.baseFt, b.baseFt)
        prev.topFt = Math.max(prev.topFt, b.topFt)
        prev.fromDistNm = Math.min(prev.fromDistNm, dist)
        prev.toDistNm = Math.max(prev.toDistNm, dist)
        prev.count++
      } else {
        byKey.set(key, {
          kind, severity: b.severity, baseFt: b.baseFt, topFt: b.topFt,
          fromDistNm: dist, toDistNm: dist, count: 1,
          source: 'model', official: false, basis: b.basis,
        })
      }
    }
  })
  return [...byKey.values()].map(b => ({
    ...b,
    fromDistNm: Math.round(b.fromDistNm),
    toDistNm: Math.round(b.toDistNm),
    routeFrac: b.count / Math.max(1, samples.length),
  }))
}

// waypoints: [{lat,lon}], atmo: result of loadAtmosphere
//
// Returns { status:'ok', icing:[Band], turbulence:[Band], convective,
//           coverage:{icing:'official'|'modelled'|'none', turbulence:...} }
export async function analyzeHazards(waypoints, atmo, { timeoutMs = 10000 } = {}) {
  const wps = (waypoints || []).filter(w => Number.isFinite(w?.lat) && Number.isFinite(w?.lon))
  if (wps.length < 2) return { status: 'empty' }

  const { samples: dense } = sampleRoute(wps, { spacingNm: 10, maxSamples: 200 })
  const coverage = { icing: 'none', turbulence: 'none' }
  let icing = [], turbulence = []

  if (inUS(wps)) {
    const [ice, lo, hi] = await Promise.allSettled([
      fetchGairmet('ice', timeoutMs),
      fetchGairmet('turb-lo', timeoutMs),
      fetchGairmet('turb-hi', timeoutMs),
    ])
    if (ice.status === 'fulfilled') {
      icing = officialBands(ice.value, dense, 'icing')
      coverage.icing = 'official'
    }
    if (lo.status === 'fulfilled' || hi.status === 'fulfilled') {
      turbulence = [
        ...(lo.status === 'fulfilled' ? officialBands(lo.value, dense, 'turbulence') : []),
        ...(hi.status === 'fulfilled' ? officialBands(hi.value, dense, 'turbulence') : []),
      ]
      coverage.turbulence = 'official'
    }
  }

  // Model-derived indications wherever the official product does not reach.
  if (atmo?.status === 'ok') {
    if (coverage.icing !== 'official') {
      icing = collapse(atmo.columns.map(icingFromProfile), 'icing', atmo.samples)
      coverage.icing = icing.length ? 'modelled' : 'modelled'
    }
    if (coverage.turbulence !== 'official') {
      turbulence = collapse(atmo.columns.map(turbulenceFromProfile), 'turbulence', atmo.samples)
      coverage.turbulence = 'modelled'
    }
  }

  // Convection is not an altitude-selection problem — you go around it, not
  // over it in a light aircraft — so it is reported as a route advisory rather
  // than pretending some level is smooth.
  const maxCape = atmo?.status === 'ok'
    ? Math.max(0, ...atmo.surface.map(s => s.capeJkg ?? 0))
    : 0
  const convective = maxCape >= 1000
    ? { level: maxCape >= 2500 ? 'strong' : 'moderate', capeJkg: Math.round(maxCape) }
    : null

  return { status: 'ok', icing, turbulence, convective, coverage }
}

// Worst band overlapping an altitude, or null. `official` bands win ties so a
// forecast is never hidden behind an inference.
export function worstAt(bands, altFt) {
  let worst = null
  for (const b of bands || []) {
    if (altFt < b.baseFt || altFt > b.topFt) continue
    const rank = SEVERITY_RANK[b.severity] || 0
    const bestRank = worst ? SEVERITY_RANK[worst.severity] || 0 : -1
    if (rank > bestRank || (rank === bestRank && b.official && !worst.official)) worst = b
  }
  return worst
}

export { SEVERITY_RANK }
