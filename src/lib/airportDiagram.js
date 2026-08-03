// Real runway/taxiway/apron/building geometry for the Airports section's
// diagram, from OpenStreetMap — free, keyless, and far more detailed than
// the app's own bundled runway list (which only carries centerline
// endpoints + heading, no taxiways/aprons/buildings at all).
//
// Cached in IndexedDB once fetched: airport ground layouts change on the
// order of years, not sessions, so there's no need to re-query on every
// visit — same "disposable but stable" cache pattern as the bundled
// airport_details.json snapshot itself.
//
// The cache is versioned rather than permanent, though. A cached record was
// previously kept forever, so widening what we ask OSM for improved nothing
// for any field a pilot had already opened. GEO_SCHEMA is bumped whenever
// the query or the parsed shape changes, and a record written by an older
// one is served immediately and refreshed in the background — the pilot
// keeps a diagram either way, including offline, and the better one lands on
// the next visit rather than blocking this one.

import { get, put } from './db'
import { isUSIdent, fetchFaaDiagramLayers, fetchFaaRunwaysBbox } from './faaAirportGeometry'

// 2: added taxilanes, building=hangar/terminal, and area-mapped helipads.
const GEO_SCHEMA = 2

// A stale record refreshes at most once per session per field, no matter how
// often the pilot reopens it.
const refreshing = new Set()

// Records older than this are refreshed even at the current schema. Ground
// layouts move slowly; this is about eventually picking up OSM edits, not
// about freshness in any urgent sense.
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000

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
  // Three statements rather than one per tag: Overpass is a shared public
  // service and statement count is what it charges for. The set is wider
  // than the tags alone suggest — taxilanes (the service paths across a GA
  // ramp) and hangars mapped as building=hangar rather than aeroway=hangar
  // are both common and were previously invisible. At CYLS specifically OSM
  // has 7 taxilanes and 3 building=hangar, and zero aeroway=hangar, so the
  // old query asked for the tag the field doesn't use and missed the one it
  // does. Helipads are also mapped as areas about as often as nodes.
  const query = `[out:json][timeout:20];
    (
      way["aeroway"~"^(runway|taxiway|taxilane|apron|hangar|terminal|helipad)$"](${bbox});
      way["building"~"^(hangar|terminal)$"](${bbox});
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
    const building = el.tags?.building
    if (el.type === 'node' && aeroway === 'helipad') {
      geo.helipads.push({ tags: el.tags, points: [{ lat: el.lat, lon: el.lon }] })
      continue
    }
    const points = wayToPoints(el)
    if (points.length < 2) continue
    if (aeroway === 'runway') geo.runways.push({ tags: el.tags, points })
    // Taxilanes are marked rather than merged: a taxilane is a service path
    // across a ramp, not a movement-area taxiway, and drawing it at the same
    // weight makes a GA apron read as a taxiway complex.
    else if (aeroway === 'taxiway') geo.taxiways.push({ tags: el.tags, points })
    else if (aeroway === 'taxilane') geo.taxiways.push({ tags: el.tags, points, kind: 'taxilane' })
    else if (aeroway === 'apron') geo.aprons.push({ tags: el.tags, points })
    // An area-mapped helipad is reduced to its centre so it feeds the same
    // single-point render path as the node form.
    else if (aeroway === 'helipad') {
      const lat = points.reduce((s, p) => s + p.lat, 0) / points.length
      const lon = points.reduce((s, p) => s + p.lon, 0) / points.length
      geo.helipads.push({ tags: el.tags, points: [{ lat, lon }] })
    }
    else if (aeroway === 'hangar' || aeroway === 'terminal') geo.buildings.push({ tags: el.tags, points })
    // Same structures, older tagging convention — no reason to draw them
    // differently from their aeroway-tagged equivalents.
    else if (building === 'hangar' || building === 'terminal') geo.buildings.push({ tags: el.tags, points })
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
  if (cached) {
    const fresh = (cached.v ?? 1) >= GEO_SCHEMA
      && Date.now() - (cached.fetchedAt ?? 0) < MAX_AGE_MS
    if (fresh) return cached.geo ?? null
    // Stale, but still the best answer available right now. Hand it back
    // untouched and improve it out of band — a pilot who opened this field
    // to look at it should never be made to wait on Overpass, and one who
    // is offline should not lose the diagram they already had.
    if (!refreshing.has(icao)) {
      refreshing.add(icao)
      fetchAndStore(icao, lat, lon, timeoutMs).catch(() => {}).finally(() => refreshing.delete(icao))
    }
    return cached.geo ?? null
  }

  return fetchAndStore(icao, lat, lon, timeoutMs)
}

async function fetchAndStore(icao, lat, lon, timeoutMs) {
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

  // Remember the misses too. A field neither source covers used to store
  // nothing at all, so every single visit paid for two Overpass mirrors and
  // a 12s timeout to learn the same thing again.
  put('airportDiagram', { icao, geo, v: GEO_SCHEMA, fetchedAt: Date.now() }).catch(() => {})
  return geo
}
