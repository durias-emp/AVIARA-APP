// Controlled airspace along the route. Class B, C and D.
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
// Central America is covered too, from a bundled pack built out of COCESNA's
// eAIP (see scripts/build_cenamer_airspace.py): there is no queryable source
// for that region at all, so the TMAs are parsed from the published prose.
// Anywhere else, the caller is told the route is not covered rather than shown
// an empty list.

import { sampleRoute } from './corridor'

const URL = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query'

// Where each source has anything to say. A route outside both is reported as
// not covered.
const US_BOXES = [
  [24.0, 50.0, -125.0, -66.0],   // CONUS
  [51.0, 72.0, -170.0, -129.0],  // Alaska
  [18.0, 23.0, -161.0, -154.0],  // Hawaii
]
const CENAMER_BOX = [1.0, 21.0, -106.0, -81.0]   // CENAMER FIR

const inBox = (w, [s, n, west, e]) => w.lat >= s && w.lat <= n && w.lon >= west && w.lon <= e
const touchesUS = wps => wps.some(w => US_BOXES.some(b => inBox(w, b)))
const touchesCenamer = wps => wps.some(w => inBox(w, CENAMER_BOX))

let _cenamer = null
async function getCenamer() {
  if (_cenamer) return _cenamer
  try {
    _cenamer = (await import('../data/geo/cenamer_airspace.json')).default.areas
    return _cenamer
  } catch {
    return null    // not downloaded yet and offline. Reported, not assumed empty
  }
}

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

// Thin a sampled path down to at most `max` points, keeping both ends. The
// route travels in the query string, so it has to stay a sensible length; at
// 25 NM spacing only a transoceanic route ever reaches the cap.
function decimate(pts, max) {
  if (pts.length <= max) return pts
  const step = (pts.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => pts[Math.round(i * step)])
}

const round6 = v => Math.round(v * 1e6) / 1e6

// waypoints: [{lat,lon}, ...]
// altFt: planned cruise altitude. Used to mark which airspaces the cruise
//   itself sits inside, NOT to filter. A Class B whose ceiling is below the
//   cruise altitude is still entered on the climb and the descent, and
//   dropping it would be a false negative on the part of the flight where it
//   matters most.
//
// Returns { status:'ok', areas:[{name,cls,lowerFt,upperFt,atCruise}], count }
//   or { status:'unavailable' } / { status:'empty' }
async function faaAreas(wps, timeoutMs) {
  const { samples } = sampleRoute(wps, { spacingNm: 25 })
  // Query only the part of the route actually inside US coverage. A
  // transatlantic route's full envelope spans an ocean, and the service
  // rejects an envelope that large, which surfaced as "unavailable" on a
  // route whose US portion queries perfectly well.
  const inside = samples.filter(s => US_BOXES.some(b => inBox(s, b)))
  const path = inside.length ? inside : samples

  // Ask about the route, not the rectangle around it.
  //
  // This used to send the bounding envelope and every polygon inside it, then
  // run the crossing test here. A rectangle around a 340 NM route covers most
  // of a state, so the service answered with 114 airspaces and 6.2 MB of
  // boundary geometry, over ten seconds on a good connection, of which six
  // were actually crossed and the rest were discarded. The download regularly
  // outran the timeout, and the card reported the airspace as unavailable on
  // routes the service answers perfectly well.
  //
  // Sending the route itself as a polyline moves the intersection test to the
  // server, which is where the geometry already lives. The same query comes
  // back in 1.8 KB and under a second, and the geometry never has to travel at
  // all because the only things kept from it were the name, class and limits.
  const pts = decimate(path, 60).map(s => [round6(s.lon), round6(s.lat)])
  const params = new URLSearchParams({
    where: "CLASS IN ('B','C','D')",
    geometry: JSON.stringify({ paths: [pts], spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolyline',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'NAME,CLASS,LOCAL_TYPE,LOWER_VAL,LOWER_CODE,UPPER_VAL',
    returnGeometry: 'false',
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
    return { status: 'unavailable', areas: [] }
  }

  const byKey = new Map()
  for (const f of features) {
    const a = f.attributes || {}
    // No crossing test here any more: the service was asked which airspaces
    // the route intersects, so everything that came back is one.
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

  return { status: 'ok', areas: [...byKey.values()] }
}

// Bundled CENAMER pack: no network, so it cannot fail; the areas carry their
// own approx flag where the eAIP describes a boundary by naming a national
// border instead of publishing coordinates.
async function cenamerAreas(wps) {
  const all = await getCenamer()
  if (!all) return null
  return all
    .filter(a => routeCrossesPoly(wps, a.poly))
    .map(a => ({
      name: a.name, cls: a.cls, lowerFt: a.lowerFt, upperFt: a.upperFt,
      ref: a.ref, approx: a.approx, source: 'CENAMER',
    }))
}

// waypoints: [{lat,lon}, ...]
// altFt: planned cruise altitude. Marks which areas the cruise sits inside.
//
// Returns { status:'ok', areas, count, sources } | { status:'unavailable' }
//        | { status:'not-covered' } | { status:'empty' }
export async function analyzeAirspace(waypoints, { altFt = null, timeoutMs = 10000 } = {}) {
  const wps = (waypoints || []).filter(w => Number.isFinite(w?.lat) && Number.isFinite(w?.lon))
  if (wps.length < 2) return { status: 'empty' }

  const us = touchesUS(wps), ca = touchesCenamer(wps)
  if (!us && !ca) return { status: 'not-covered' }

  const [faa, cen] = await Promise.all([
    us ? faaAreas(wps, timeoutMs) : Promise.resolve({ status: 'skip', areas: [] }),
    ca ? cenamerAreas(wps) : Promise.resolve([]),
  ])
  // The bundled pack cannot fail, so a live failure only sinks the whole
  // result when it was the only source that applied.
  if (faa.status === 'unavailable' && !ca) return { status: 'unavailable' }
  if (ca && cen === null && !us) return { status: 'unavailable' }

  const areas = [...faa.areas.map(a => ({ ...a, ref: 'AMSL', approx: false, source: 'FAA' })), ...(cen || [])]
    .map(x => ({
      ...x,
      // An AGL floor cannot be compared with a planned MSL altitude without
      // knowing the terrain under it, so it is left unanswered rather than
      // guessed.
      atCruise: altFt != null && x.ref === 'AMSL' && x.lowerFt != null && x.upperFt != null
        ? altFt >= x.lowerFt && altFt <= x.upperFt
        : null,
    }))

  // Most restrictive first, then the ones the cruise sits inside
  const rank = { B: 0, C: 1, D: 2, E: 3 }
  areas.sort((x, y) => (y.atCruise === true) - (x.atCruise === true) ||
                       (rank[x.cls] ?? 9) - (rank[y.cls] ?? 9) ||
                       x.name.localeCompare(y.name))

  return {
    status: 'ok', areas, count: areas.length,
    sources: [us && 'FAA', ca && 'CENAMER'].filter(Boolean),
    partial: faa.status === 'unavailable',
  }
}
