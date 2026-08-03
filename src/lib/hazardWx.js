// AIRMET/SIGMET/PIREP icing & turbulence — the newest signal in the
// altitude optimizer (see lib/altitudeOptimizer.js): a hard-cruise-altitude
// decision genuinely needs to know about ice or chop before committing to
// an altitude, not just legality/time/fuel. Nothing in this codebase talked
// to these endpoints before this file — confirmed live while building it,
// not guessed:
//
//   gairmet (Graphical AIRMET) — polygon + altitude band:
//     { hazard, severity, base, top (HUNDREDS of ft, e.g. "220"=22,000ft),
//       geom:'AREA', coords:[{lat,lon}] }
//   isigmet (international SIGMET) — polygon + altitude band:
//     { hazard, base, top (ACTUAL feet — different unit convention than
//       gairmet, easy to get wrong), coords:[{lat,lon}], qualifier }
//   pirep — point report, base/top/fltLvl all in HUNDREDS of feet (same
//     convention as flight levels, confirmed against a real report: FL180
//     aircraft, "IC LGT RIME 150" -> icgBas1:150 = 15,000ft):
//     { lat, lon, fltLvl, icgBas1, icgTop1, icgInt1, tbBas1, tbTop1, tbInt1, ... }
//
// All three go through the existing generic /api/awc proxy — confirmed it
// forwards any `path` verbatim to aviationweather.gov/api/data/, so no new
// server code was needed for this phase. Every base/top is normalized to
// plain feet here so nothing downstream has to know which source it came
// from.
import { awcUrl } from '../pages/Checklists/shared/awc'
import { routeCrossesPoly } from './airspace'
import { haversineNm } from './corridor'

async function fetchAwcJson(path, params) {
  try {
    const res = await fetch(awcUrl(path, params), { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function bboxOfWaypoints(waypoints, padDeg = 1) {
  const lats = waypoints.map(w => w.lat), lons = waypoints.map(w => w.lon)
  return {
    minLat: Math.min(...lats) - padDeg, maxLat: Math.max(...lats) + padDeg,
    minLon: Math.min(...lons) - padDeg, maxLon: Math.max(...lons) + padDeg,
  }
}

const SEVERITY_MAP = {
  LGT: 'light', 'LGT-MOD': 'light', MOD: 'moderate', 'MOD-SEV': 'moderate',
  SEV: 'severe', SEVERE: 'severe', HVY: 'severe',
}
function mapSeverity(raw) {
  if (!raw) return 'unknown'
  return SEVERITY_MAP[String(raw).toUpperCase()] ?? 'unknown'
}

function toPoly(coords) {
  // Both gairmet and isigmet carry named {lat, lon} keys (not positional
  // [lon,lat] GeoJSON arrays), so there's no swap to get wrong here — just
  // parseFloat, since gairmet's values are strings.
  return (coords ?? [])
    .map(c => [parseFloat(c.lat), parseFloat(c.lon)])
    .filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon))
}

// waypoints: [{lat, lon}, ...] — the same shape analyzeTerrain/analyzeWater
// already accept.
// Returns:
//   { status:'ok', icing:[{polygon,baseFt,topFt,severity,source}],
//     turbulence:[same shape], pireps:[{lat,lon,icgBaseFt,icgTopFt,
//     icgIntensity,tbBaseFt,tbTopFt,tbIntensity}] }
//   { status:'unavailable' }
export async function fetchIcingTurbulence(waypoints) {
  if (!waypoints || waypoints.length < 2) return { status: 'unavailable' }
  const bbox = bboxOfWaypoints(waypoints)
  const bboxStr = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`

  const [iceRes, turbHiRes, turbLoRes, sigRes, pirepRes] = await Promise.all([
    fetchAwcJson('gairmet', { hazard: 'ice', format: 'json' }),
    fetchAwcJson('gairmet', { hazard: 'turb-hi', format: 'json' }),
    fetchAwcJson('gairmet', { hazard: 'turb-lo', format: 'json' }),
    fetchAwcJson('isigmet', { format: 'json' }),
    fetchAwcJson('pirep', { format: 'json', bbox: bboxStr }),
  ])

  if (!iceRes && !turbHiRes && !turbLoRes && !sigRes && !pirepRes) return { status: 'unavailable' }

  const gairmetToBand = g => ({
    polygon: toPoly(g.coords),
    baseFt: g.base != null ? parseFloat(g.base) * 100 : null,
    topFt: g.top != null ? parseFloat(g.top) * 100 : null,
    severity: mapSeverity(g.severity),
    source: 'gairmet',
  })
  const sigmetToBand = s => ({
    polygon: toPoly(s.coords),
    baseFt: s.base != null ? parseFloat(s.base) : null,
    topFt: s.top != null ? parseFloat(s.top) : null,
    severity: mapSeverity(s.qualifier),
    source: 'isigmet',
  })

  const icing = [
    ...(iceRes ?? []).map(gairmetToBand),
    ...(sigRes ?? []).filter(s => s.hazard === 'ICE').map(sigmetToBand),
  ]
  const turbulence = [
    ...(turbHiRes ?? []).map(gairmetToBand),
    ...(turbLoRes ?? []).map(gairmetToBand),
    ...(sigRes ?? []).filter(s => s.hazard === 'TURB').map(sigmetToBand),
  ]
  const pireps = (pirepRes ?? [])
    .filter(p => p.icgBas1 != null || p.tbBas1 != null)
    .map(p => ({
      lat: p.lat, lon: p.lon,
      icgBaseFt: p.icgBas1 != null ? p.icgBas1 * 100 : null,
      icgTopFt: p.icgTop1 != null ? p.icgTop1 * 100 : null,
      icgIntensity: mapSeverity(p.icgInt1),
      tbBaseFt: p.tbBas1 != null ? p.tbBas1 * 100 : null,
      tbTopFt: p.tbTop1 != null ? p.tbTop1 * 100 : null,
      tbIntensity: mapSeverity(p.tbInt1),
    }))

  return { status: 'ok', icing, turbulence, pireps }
}

// 'unknown' ranks above 'none' on purpose — it means a hazard area was
// actually detected but its printed severity code didn't parse, which is
// meaningfully different from "checked and found nothing" and shouldn't
// silently collapse into it.
const SEVERITY_RANK = { none: 0, unknown: 1, light: 2, moderate: 3, severe: 4 }
const RANK_TO_SEVERITY = ['none', 'unknown', 'light', 'moderate', 'severe']

// Reduces a fetchIcingTurbulence() result down to the single worst risk
// applicable to one candidate altitude along this route — the shape
// altitudeOptimizer.js's `hazardByAlt` expects. Polygons need BOTH a lateral
// hit (routeCrossesPoly, same primitive airspace.js/RouteAltitude.jsx
// already use for Class B/C/D and TFRs) AND the candidate altitude inside
// their base/top band; PIREPs (points, not polygons) use a proximity test
// against the route's own waypoints instead of a full corridor sample,
// since a PIREP is a single spot report, not an area.
export function hazardRiskAt(hazardData, waypoints, altFt, { pirepRangeNm = 15 } = {}) {
  if (!hazardData || hazardData.status !== 'ok') return null
  let worst = 'none'
  const sources = []

  const bump = (severity, label) => {
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[worst]) worst = severity
    sources.push(label)
  }

  for (const band of [...hazardData.icing, ...hazardData.turbulence]) {
    if (!band.polygon?.length) continue
    const inBand = (band.baseFt == null || altFt >= band.baseFt) && (band.topFt == null || altFt <= band.topFt)
    if (inBand && routeCrossesPoly(waypoints, band.polygon)) bump(band.severity, band.source)
  }

  for (const p of hazardData.pireps) {
    const nearRoute = waypoints.slice(0, -1).some((w, i) => {
      const next = waypoints[i + 1]
      // Cheap proximity check against the two endpoints of each leg rather
      // than a full cross-track computation — a PIREP is a single point in
      // time and space, so this doesn't need corridor-grade precision.
      return haversineNm(p.lat, p.lon, w.lat, w.lon) <= pirepRangeNm ||
             haversineNm(p.lat, p.lon, next.lat, next.lon) <= pirepRangeNm
    })
    if (!nearRoute) continue
    if (p.icgBaseFt != null && altFt >= p.icgBaseFt && (p.icgTopFt == null || altFt <= p.icgTopFt)) bump(p.icgIntensity, 'pirep-icing')
    if (p.tbBaseFt != null && altFt >= p.tbBaseFt && (p.tbTopFt == null || altFt <= p.tbTopFt)) bump(p.tbIntensity, 'pirep-turbulence')
  }

  return { risk: RANK_TO_SEVERITY[SEVERITY_RANK[worst]], sources: [...new Set(sources)] }
}
