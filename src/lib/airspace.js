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
// Central America is covered too, from a bundled pack built out of COCESNA's
// eAIP (see scripts/build_cenamer_airspace.py) — there is no queryable source
// for that region at all, so the TMAs are parsed from the published prose.
// Anywhere else, the caller is told the route is not covered rather than shown
// an empty list.

import { bboxOf, sampleRoute } from './corridor'
import { get } from './db'

const URL = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query'

// Same default key the Route & Altitude planner's openAIP chart layer
// already ships with (see RouteAltitude.jsx) — reused here for openAIP's
// actual data API (api.core.openaip.net), not just its map tiles. Read from
// settings first so a pilot who's set their own key in that screen gets it
// here too.
const OPENAIP_DEFAULT_KEY = 'b640e75c082134fd6f1524246478f301'
async function openaipKey() {
  const row = await get('settings', 'openaip_key').catch(() => null)
  return row?.value || OPENAIP_DEFAULT_KEY
}

// openAIP's icaoClass is a numeric enum; the letters are all this app cares
// about. 7 (UNCLASSIFIED) and anything else openAIP might add later just
// won't match a key here and get skipped.
const OPENAIP_CLASS_LETTER = { 0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'E', 5: 'F', 6: 'G' }

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
  if (!_cenamer) _cenamer = (await import('../data/geo/cenamer_airspace.json')).default.areas
  return _cenamer
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

// waypoints: [{lat,lon}, ...]
// altFt: planned cruise altitude — used to mark which airspaces the cruise
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
  // rejects an envelope that large — which surfaced as "unavailable" on a
  // route whose US portion queries perfectly well.
  const inside = samples.filter(s => US_BOXES.some(b => inBox(s, b)))
  const b = bboxOf(inside.length ? inside : samples, 3)
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
    return { status: 'unavailable', areas: [] }
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

  return { status: 'ok', areas: [...byKey.values()] }
}

// Bundled CENAMER pack — no network, so it cannot fail; the areas carry their
// own approx flag where the eAIP describes a boundary by naming a national
// border instead of publishing coordinates.
async function cenamerAreas(wps) {
  const all = await getCenamer()
  return all
    .filter(a => routeCrossesPoly(wps, a.poly))
    .map(a => ({
      name: a.name, cls: a.cls, lowerFt: a.lowerFt, upperFt: a.upperFt,
      ref: a.ref, approx: a.approx, source: 'CENAMER',
    }))
}

// Quality-tiered exactly like the airport data pack itself (FAA NASR first,
// eAIP second, community last — see the airport-data commit history): the
// FAA's own service is authoritative for US-administered fields; everywhere
// else falls through to openAIP's community-maintained worldwide airspace
// database (the same one the Route & Altitude planner's airspace chart layer
// already uses, here via its actual data API instead of just map tiles); the
// bundled CENAMER pack is the last-resort fallback if openAIP's request
// itself fails, since that pack is curated specifically for that region.
//
// Unlike the route-crossing check above, Class E and G are included here —
// excluding E made sense for "does this ROUTE cross something" (Class E is
// everywhere and would flag every route), but for "what class is THIS
// AIRPORT in," E and G are exactly the useful answers most fields actually
// have.
//
// Gated by the airport's own ICAO prefix for the FAA branch (K = CONUS,
// PA/PH = Alaska/Hawaii), not a lat/lon box — the FAA's Class_Airspace layer
// turns out to carry a sliver of Canadian airspace too (confirmed live: it
// labels Toronto and Muskoka's Canadian control zones with the FAA's own
// B/C/D CLASS field, which does not correspond to NAV CANADA's actual
// classification — Muskoka is Class E there, not the "Class B" this
// service's attribute implies). A lat/lon box can't tell Ontario from
// upstate New York; the ident prefix can.
export async function classAtPoint(lat, lon, icao, timeoutMs = 8000) {
  const inUS = /^(K|PA|PH)/i.test(icao || '')

  if (inUS) {
    const pad = 0.35 // covers the largest Class B outer shelf radii
    const params = new URLSearchParams({
      where: "CLASS IN ('B','C','D')",
      geometry: `${lon - pad},${lat - pad},${lon + pad},${lat + pad}`,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'NAME,CLASS,LOWER_VAL,LOWER_CODE',
      returnGeometry: 'true',
      // No maxAllowableOffset here, unlike faaAreas above — asking this
      // service to generalize geometry for these particular Class B shelves
      // makes it silently drop the geometry entirely (attributes come back,
      // `geometry` is just missing), which read as "no B/C/D here" for
      // airports that are very much inside one. The bbox for a single point
      // is tiny, so the extra vertices cost nothing.
      f: 'json',
    })
    try {
      const res = await fetch(`${URL}?${params}`, { signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok) {
        const d = await res.json()
        const features = d.features || []
        const rank = { B: 0, C: 1, D: 2 }
        let best = null
        for (const f of features) {
          // What actually has jurisdiction on the ground at this field is
          // whichever shelf reaches the surface here — an airport can sit
          // laterally under a Class B shelf that only starts at 1,500 ft
          // while its own pattern is really controlled by a Class D from the
          // surface (Teterboro, under the NY Class B, is exactly this case).
          // A shelf that starts above the ground says nothing about who
          // controls the airport itself, so only surface-floor shelves count.
          const lowerCode = f.attributes?.LOWER_CODE
          const lowerVal = f.attributes?.LOWER_VAL
          const isSurface = lowerCode === 'SFC' || lowerCode === 'GND' || Number(lowerVal) === 0
          if (!isSurface) continue
          const rings = f.geometry?.rings || []
          const hit = rings.some(r => pointInPoly([lat, lon], r.map(([x, y]) => [y, x])))
          if (!hit) continue
          const cls = f.attributes?.CLASS
          if (!best || (rank[cls] ?? 9) < (rank[best] ?? 9)) best = cls
        }
        if (best) return { cls: best, source: 'FAA' }
      }
    } catch { /* not fatal — fall through to openAIP below */ }
    return null
  }

  // Worldwide: openAIP's Core API (bbox query, needs the same rank/surface
  // handling as the FAA branch above — a field can equally sit under a
  // foreign Class B/C/TMA shelf that starts well above the ground).
  try {
    const key = await openaipKey()
    const pad = 0.15
    const url = `https://api.core.openaip.net/api/airspaces?bbox=${lon - pad},${lat - pad},${lon + pad},${lat + pad}`
    const res = await fetch(url, { headers: { 'x-openaip-api-key': key }, signal: AbortSignal.timeout(timeoutMs) })
    if (res.ok) {
      const d = await res.json()
      const rank = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6 }
      let best = null
      for (const item of d.items || []) {
        const cls = OPENAIP_CLASS_LETTER[item.icaoClass]
        if (!cls) continue
        // Same surface-floor requirement as the FAA branch: a lower limit of
        // 0 means "starts at the ground" (AGL or MSL both use 0 for that),
        // regardless of unit/reference — anything with a floor above the
        // ground doesn't govern the airport itself.
        if (Number(item.lowerLimit?.value) !== 0) continue
        const rings = item.geometry?.type === 'Polygon' ? [item.geometry.coordinates[0]]
          : item.geometry?.type === 'MultiPolygon' ? item.geometry.coordinates.map(p => p[0])
          : []
        const hit = rings.some(r => pointInPoly([lat, lon], r.map(([x, y]) => [y, x])))
        if (!hit) continue
        if (!best || (rank[cls] ?? 9) < (rank[best] ?? 9)) best = cls
      }
      if (best) return { cls: best, source: 'openAIP' }
      return null
    }
  } catch { /* fall through to the bundled CENAMER pack */ }

  if (CENAMER_BOX && inBox({ lat, lon }, CENAMER_BOX)) {
    const areas = await getCenamer()
    for (const a of areas) {
      if (['B', 'C', 'D'].includes(a.cls) && pointInPoly([lat, lon], a.poly)) {
        return { cls: a.cls, source: 'CENAMER' }
      }
    }
  }

  return null
}

// waypoints: [{lat,lon}, ...]
// altFt: planned cruise altitude — marks which areas the cruise sits inside.
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

  const areas = [...faa.areas.map(a => ({ ...a, ref: 'AMSL', approx: false, source: 'FAA' })), ...cen]
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
