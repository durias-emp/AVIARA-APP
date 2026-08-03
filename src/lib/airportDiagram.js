// Real runway/taxiway/apron/building geometry for the Airports section's
// diagram, from OpenStreetMap — free, keyless, and far more detailed than
// the app's own bundled runway list (which only carries centerline
// endpoints + heading, no taxiways/aprons/buildings at all).
//
// Cached indefinitely in IndexedDB once fetched: airport ground layouts
// change on the order of years, not sessions, so there's no need to
// re-query on every visit — same "disposable but stable" cache pattern as
// the bundled airport_details.json snapshot itself.

import { get, put } from './db'
import { isUSIdent, fetchFaaDiagramLayers, fetchFaaRunwaysBbox } from './faaAirportGeometry'

// Two public mirrors — Overpass is a shared community resource that
// occasionally rate-limits or times out a single instance; falling back to
// a second one is the same resilience pattern used for TFRs/METARs
// elsewhere in this app.
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

// Chain/keyword names that show up on general-aviation service buildings —
// there's no dedicated OSM tag for "this is an FBO," so this is a
// best-effort read of the building's own name. Real but imperfect: it will
// miss an FBO it doesn't recognize, never mislabel an unrelated building
// (matches are intentionally strict, on the name only).
const FBO_PATTERN = /signature flight|atlantic aviation|million air|landmark aviation|sheltair|wilson air|tac air|priester aviation|jet ?center|fixed base|\bfbo\b/i

export function isFBO(tags) {
  return !!tags?.name && FBO_PATTERN.test(tags.name)
}

function wayToPoints(el) {
  return (el.geometry || []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
}

async function queryOverpass(lat, lon, radiusDeg, timeoutMs) {
  const s = lat - radiusDeg, n = lat + radiusDeg, w = lon - radiusDeg, e = lon + radiusDeg
  const bbox = `${s},${w},${n},${e}`
  const query = `[out:json][timeout:20];
    (
      way["aeroway"="runway"](${bbox});
      way["aeroway"="taxiway"](${bbox});
      way["aeroway"="apron"](${bbox});
      way["aeroway"="hangar"](${bbox});
      way["aeroway"="terminal"](${bbox});
      node["aeroway"="helipad"](${bbox});
    );
    out tags geom;`

  let lastErr = null
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const text = await res.text()
      const data = JSON.parse(text) // a rate-limited/erroring mirror replies with XML, not JSON — caught below
      return data.elements || []
    } catch (err) {
      lastErr = err // try the next mirror
    }
  }
  throw lastErr ?? new Error('all Overpass mirrors failed')
}

async function fetchOsmGeometry(lat, lon, timeoutMs) {
  let elements
  try {
    elements = await queryOverpass(lat, lon, 0.035, timeoutMs) // ~2.4 NM padding — covers all but the largest hub layouts
  } catch {
    return null
  }

  const geo = { runways: [], taxiways: [], aprons: [], buildings: [], helipads: [] }
  for (const el of elements) {
    const aeroway = el.tags?.aeroway
    if (el.type === 'node' && aeroway === 'helipad') {
      geo.helipads.push({ tags: el.tags, points: [{ lat: el.lat, lon: el.lon }] })
      continue
    }
    const points = wayToPoints(el)
    if (points.length < 2) continue
    if (aeroway === 'runway') geo.runways.push({ tags: el.tags, points })
    else if (aeroway === 'taxiway') geo.taxiways.push({ tags: el.tags, points })
    else if (aeroway === 'apron') geo.aprons.push({ tags: el.tags, points })
    else if (aeroway === 'hangar' || aeroway === 'terminal') geo.buildings.push({ tags: el.tags, points })
  }

  if (geo.runways.length === 0 && geo.taxiways.length === 0 && geo.aprons.length === 0) {
    return null
  }
  return geo
}

// Returns { runways, taxiways, aprons, buildings, helipads } — each way as
// { tags, points:[{lat,lon}] } (nodes as a single-point `points` array) —
// or null if nothing came back (caller falls back to the abstract diagram).
//
// Three tiers, cheapest/most-authoritative first:
//   1. FAA's own Airport-Diagram data (US airports that have one published)
//      — exact-ICAO match, so no risk of pulling in a neighboring airport.
//   2. FAA's broader Runways layer (US fields with no published diagram) —
//      a real runway pavement shape instead of an abstract line — merged
//      with whatever OSM has for the same field's taxiways/aprons/buildings.
//   3. OSM alone, everywhere else (Canada, international, or US fields
//      where even tier 2 comes up empty).
// See src/lib/faaAirportGeometry.js for why tiers 1/2 are US-only.
export async function fetchAirportGeometry(icao, lat, lon, { timeoutMs = 12000 } = {}) {
  const cached = await get('airportDiagram', icao).catch(() => null)
  if (cached?.geo) return cached.geo

  let geo = null

  if (isUSIdent(icao)) {
    geo = await fetchFaaDiagramLayers(icao, timeoutMs).catch(() => null)
  }

  if (!geo) {
    const [faaRunways, osm] = await Promise.all([
      isUSIdent(icao) ? fetchFaaRunwaysBbox(lat, lon, 0.02, timeoutMs).catch(() => []) : [],
      fetchOsmGeometry(lat, lon, timeoutMs),
    ])
    if (faaRunways.length || osm) {
      geo = osm ?? { runways: [], taxiways: [], aprons: [], buildings: [], helipads: [] }
      if (faaRunways.length) geo = { ...geo, runways: faaRunways }
    }
  }

  if (!geo) return null

  put('airportDiagram', { icao, geo, fetchedAt: Date.now() }).catch(() => {})
  return geo
}
