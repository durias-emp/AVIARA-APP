// Controlled airspace along the route — Class B, C and D.
//
// This is a different question from the Special Use Airspace check, which
// looks for Prohibited/Restricted/Warning/Alert areas and MOAs. Nothing in
// the app used to tell a pilot that their route clips the Miami Class B or a
// Class D at pattern altitude, in the US or anywhere else.
//
// Source: the FAA's Class_Airspace feature service (same publisher as the SUA
// and airport layers already in use). Live rather than bundled because
// airspace changes on the 56-day cycle and a stale Class B is worse than none.
//
// Class E is deliberately excluded: it blankets most of the country above
// 1,200 ft AGL, so reporting it would flag every route in the US and mean
// nothing. B/C/D are the classes that require two-way communication or a
// clearance before entry.
//
// Coverage is US-only, and the caller is told so rather than shown an empty
// list — see the not-covered handling in the overflight row.

import { bboxOf, sampleRoute } from './corridor'

const URL = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query'

function pointInPoly(pt, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ay, ax] = poly[i], [by, bx] = poly[j]
    if ((ay > pt[0]) !== (by > pt[0]) &&
        pt[1] < (bx - ax) * (pt[0] - ay) / (by - ay) + ax) inside = !inside
  }
  return inside
}

function segsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

// Does the route's ground track enter or cross this polygon?
export function routeCrossesPoly(waypoints, poly) {
  for (let s = 0; s < waypoints.length - 1; s++) {
    const a = [waypoints[s].lat, waypoints[s].lon]
    const b = [waypoints[s + 1].lat, waypoints[s + 1].lon]
    if (pointInPoly(a, poly) || pointInPoly(b, poly)) return true
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (segsCross(a, b, poly[j], poly[i])) return true
    }
  }
  return false
}

// FAA publishes limits as value + unit + code; SFC means surface regardless
// of the value. Everything B/C/D is feet MSL otherwise.
function limitFt(val, code) {
  if (code === 'SFC' || code === 'GND') return 0
  const n = Number(val)
  return Number.isFinite(n) ? n : null
}

// waypoints: [{lat,lon}, ...]
// altFt: planned cruise altitude — used to mark which airspaces the cruise
//   itself sits inside, NOT to filter. A Class B whose ceiling is below the
//   cruise altitude is still entered on the climb and the descent, and
//   dropping it would be a false negative on the part of the flight where it
//   matters most.
//
// Returns { status:'ok', areas:[{name,cls,lowerFt,upperFt,atCruise}], count }
//   or { status:'unavailable' } / { status:'empty' }
export async function analyzeAirspace(waypoints, { altFt = null, timeoutMs = 10000 } = {}) {
  const wps = (waypoints || []).filter(w => Number.isFinite(w?.lat) && Number.isFinite(w?.lon))
  if (wps.length < 2) return { status: 'empty' }

  const { samples } = sampleRoute(wps, { spacingNm: 25 })
  const b = bboxOf(samples, 3)
  const geom = `${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}`
  const params = new URLSearchParams({
    where: "CLASS IN ('B','C','D')",
    geometry: geom,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'NAME,CLASS,LOCAL_TYPE,LOWER_VAL,LOWER_CODE,UPPER_VAL',
    returnGeometry: 'true',
    // the raw boundaries carry ~6,000 points each; generalised they are still
    // far finer than a route-crossing test needs
    maxAllowableOffset: '0.002',
    f: 'json',
  })

  let features
  try {
    const res = await fetch(`${URL}?${params}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(String(res.status))
    const d = await res.json()
    if (d.error) throw new Error(d.error.message || 'service error')
    features = d.features || []
  } catch {
    return { status: 'unavailable' }
  }

  const byKey = new Map()
  for (const f of features) {
    const a = f.attributes || {}
    const rings = f.geometry?.rings || []
    const hit = rings.some(r => routeCrossesPoly(wps, r.map(([x, y]) => [y, x])))
    if (!hit) continue

    const lowerFt = limitFt(a.LOWER_VAL, a.LOWER_CODE)
    const upperFt = limitFt(a.UPPER_VAL, null)
    // One airspace arrives as several shelves (Miami Class B is eight rings
    // with different floors). Merge them into the envelope actually crossed.
    const key = `${a.CLASS}|${a.NAME}`
    const prev = byKey.get(key)
    if (prev) {
      prev.lowerFt = Math.min(prev.lowerFt ?? Infinity, lowerFt ?? Infinity)
      prev.upperFt = Math.max(prev.upperFt ?? -Infinity, upperFt ?? -Infinity)
    } else {
      byKey.set(key, { name: a.NAME || 'Class airspace', cls: a.CLASS, lowerFt, upperFt })
    }
  }

  const areas = [...byKey.values()].map(x => ({
    ...x,
    atCruise: altFt != null && x.lowerFt != null && x.upperFt != null
      ? altFt >= x.lowerFt && altFt <= x.upperFt
      : null,
  }))
  // Most restrictive first, then the ones the cruise sits inside
  const rank = { B: 0, C: 1, D: 2 }
  areas.sort((x, y) => (y.atCruise === true) - (x.atCruise === true) ||
                       (rank[x.cls] ?? 9) - (rank[y.cls] ?? 9) ||
                       x.name.localeCompare(y.name))

  return { status: 'ok', areas, count: areas.length }
}
