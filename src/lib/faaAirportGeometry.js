// FAA's own Airport-Diagram-grade GIS data — the same ArcGIS Online org
// this app already queries for airspace class (src/lib/airspace.js). Two
// tiers, both free/open (same posture as the NASR runway list and airspace
// data already used elsewhere in this app):
//
//   Tier 1 — AM_Runway / AM_Taxiway / AM_Apron / AM_Building: the FAA's
//   production data behind their real published Airport Diagrams. Rich and
//   authoritative, but only populated for airports that HAVE an official
//   diagram (towered / certificated fields) — queried by exact ICAO match,
//   so unlike a bounding-box query there's no risk of sweeping in a
//   neighboring airport's data.
//
//   Tier 2 — the plain "Runways" layer: comprehensive nationwide coverage
//   (confirmed populated even for small non-towered fields with no AM_*
//   data), giving a real runway pavement shape instead of an abstract
//   line. No ICAO field on this layer, so it's a bounding-box query like
//   OSM — callers should cross-validate the result the same way OSM
//   runways are validated (see AirportDiagram.jsx's validateRunways).
//
// Both are US-only (it's the FAA's own system) — gated by isUSIdent().

const BASE = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services'

export function isUSIdent(icao) {
  return /^(K|PA|PH)/i.test(icao ?? '')
}

function esriRingToPoints(ring) {
  return (ring || []).map(([lon, lat]) => ({ lat, lon })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
}

function geometryToPoints(geometry) {
  if (!geometry) return []
  if (geometry.rings) return esriRingToPoints(geometry.rings[0])
  if (geometry.paths) return esriRingToPoints(geometry.paths[0])
  if (geometry.x != null && geometry.y != null) return [{ lat: geometry.y, lon: geometry.x }]
  return []
}

async function queryLayer(layer, where, { timeoutMs = 10000, outFields = '*' } = {}) {
  const url = `${BASE}/${layer}/FeatureServer/0/query?where=${encodeURIComponent(where)}&outFields=${outFields}&f=json`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    const data = await res.json()
    return data.features || []
  } catch {
    return []
  }
}

// Approximates a runway's two physical ends from its full pavement outline
// (a detailed polygon, not a simple rectangle) by projecting every vertex
// onto the runway's own known heading (from its RWY_ID, e.g. "13L/31R" ->
// 130°) and taking the extremes — robust regardless of how many points the
// outline has. Falls back to the two farthest-apart vertices if the id
// doesn't parse into a heading.
export function runwayEnds(points, rwyId) {
  const [id1] = (rwyId || '').split('/')
  const hdg = id1 ? parseInt(id1, 10) * 10 : NaN
  if (points.length >= 2 && Number.isFinite(hdg)) {
    const rad = hdg * Math.PI / 180
    const latRef = points.reduce((s, p) => s + p.lat, 0) / points.length
    const cos = Math.cos(latRef * Math.PI / 180)
    const dir = { x: Math.sin(rad), y: -Math.cos(rad) }
    let minP = points[0], maxP = points[0], minV = Infinity, maxV = -Infinity
    for (const p of points) {
      const v = (p.lon * cos) * dir.x + (-p.lat) * dir.y
      if (v < minV) { minV = v; minP = p }
      if (v > maxV) { maxV = v; maxP = p }
    }
    return [minP, maxP]
  }
  // Fallback: farthest pair of vertices (fine for the small point counts
  // these outlines actually have).
  let best = [points[0], points[1] ?? points[0]], bestD = -1
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].lat - points[j].lat, points[i].lon - points[j].lon)
      if (d > bestD) { bestD = d; best = [points[i], points[j]] }
    }
  }
  return best
}

// Tier 1 — exact-ICAO FAA Airport Diagram data. Returns null if the field
// has none (small/non-towered — no official diagram exists to source from).
export async function fetchFaaDiagramLayers(icao, timeoutMs = 10000) {
  const where = `ICAO_ID='${icao.replace(/[^A-Z0-9]/gi, '')}'`
  const [rwyFeats, twyFeats, apronFeats, bldgFeats] = await Promise.all([
    queryLayer('AM_Runway', where, { timeoutMs }),
    queryLayer('AM_Taxiway', where, { timeoutMs }),
    queryLayer('AM_Apron', where, { timeoutMs }),
    queryLayer('AM_Building', where, { timeoutMs }),
  ])

  if (!rwyFeats.length && !twyFeats.length && !apronFeats.length && !bldgFeats.length) return null

  const runways = rwyFeats.map(f => {
    const pavement = geometryToPoints(f.geometry)
    const rwyId = f.attributes?.RWY_ID
    return { tags: { ref: rwyId }, points: runwayEnds(pavement, rwyId), pavement }
  })
  const taxiways = twyFeats.map(f => ({
    tags: { name: f.attributes?.DESIGNATOR }, points: geometryToPoints(f.geometry), shape: 'polygon',
  }))
  const aprons = apronFeats.map(f => ({ tags: { name: f.attributes?.DESIGNATOR }, points: geometryToPoints(f.geometry) }))
  const buildings = bldgFeats.map(f => ({ tags: { name: f.attributes?.DESIGNATOR }, points: geometryToPoints(f.geometry) }))

  return { runways, taxiways, aprons, buildings, helipads: [] }
}

// Tier 2 — the FAA's broader nationwide Runways layer, for small/non-towered
// fields with no AM_* data. Bounding-box query (this layer has no ICAO
// field), so callers should cross-validate refs the same way OSM runways
// are validated.
export async function fetchFaaRunwaysBbox(lat, lon, radiusDeg = 0.02, timeoutMs = 10000) {
  const s = lat - radiusDeg, n = lat + radiusDeg, w = lon - radiusDeg, e = lon + radiusDeg
  const url = `${BASE}/Runways/FeatureServer/0/query?where=1%3D1&outFields=DESIGNATOR&geometry=${w},${s},${e},${n}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&f=json`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    const data = await res.json()
    const feats = data.features || []
    return feats.map(f => {
      const pavement = geometryToPoints(f.geometry)
      const rwyId = f.attributes?.DESIGNATOR
      return { tags: { ref: rwyId }, points: runwayEnds(pavement, rwyId), pavement }
    })
  } catch {
    return []
  }
}
