// Aerodromes along the route.
//
// The previous version queried an FAA ArcGIS service, which covers the United
// States only, so a Central or South American route silently reported no
// aerodromes at all, which reads as "none there" rather than "not looked".
// This uses the bundled OurAirports set instead: worldwide, offline, and the
// same public-domain source the navaid pack already draws on.
//
// The corridor is per size, not one number for everything.
//
// A single 10 NM radius treats a private grass strip and an international hub
// identically, and gets both wrong: the strip is noise at 10 NM, while
// Guatemala City sat 39 NM off a track that flew straight past it and was
// never mentioned. What makes a field worth knowing about en route is whether
// you could use it and whether its airspace reaches you, and both scale with
// the field.
//
// So: a large field is worth a look from 40 NM. That is roughly where its
// terminal airspace begins and well inside gliding-plus-diversion range at
// altitude. A medium field from 20. A small one only if it is genuinely
// underneath, which is what 10 NM means.

import { bboxOf, crossTrackNm, haversineNm, sampleRoute } from './corridor'

// Indexed by the OurAirports class: 0 small, 1 medium, 2 large.
export const CORRIDOR_BY_CLASS = [10, 20, 40]
// The widest of them, for the bounding box and for anything that still wants
// a single number to describe the search.
export const CORRIDOR_NM = Math.max(...CORRIDOR_BY_CLASS)

let _airports = null
// Downloaded on first use rather than precached (see vite.config.js), so this
// can fail while offline before that first fetch.
export async function getAirports() {
  if (_airports) return _airports
  try {
    _airports = (await import('../data/geo/airports.json')).default.airports
    return _airports
  } catch {
    return null
  }
}

// Does this ident name a real aerodrome? Deliberately separate from "does it
// report weather", because the two got conflated: several screens validated a
// typed ident against AWC alone. AWC's station list is good but not complete,
// and it thins out exactly where this app claims to be strongest — the small
// fields. CYLS (Barrie-Lake Simcoe) is the case that surfaced it: no AWC
// record, no METAR, yet it sits in this list with coordinates, a 5,000 ft
// runway and a UNICOM, and the app called it "Airport not found". Nearby
// CYQA and CYYZ both answer from AWC, so this is a per-field gap rather than
// a regional one. Anything validating an ident should fall back to here.
//
// Shaped like an AWC record (icaoId/name/lat/lon) so callers can use either
// answer without caring which one they got.
export async function findAirport(ident) {
  const id = (ident ?? '').trim().toUpperCase()
  if (!id) return null
  const hit = (await getAirports())?.find(a => a[0] === id)
  return hit ? { icaoId: hit[0], name: hit[4], lat: hit[1], lon: hit[2] } : null
}

// Just the idents, as a Set, for "is this thing an airport?" questions.
//
// Weather stations and aerodromes share an identifier space but are not the
// same population: CXBI reports Barrie's weather and is not an airport,
// CYQA is both. Telling them apart is what lets the airport page offer a
// full airport METAR/TAF separately from whatever station happens to sit
// closest. Memoised because the alternative is a linear scan of 34k rows
// per candidate station.
let _identSet = null
export async function getAirportIdents() {
  if (_identSet) return _identSet
  const list = await getAirports()
  if (!list) return null
  _identSet = new Set(list.map(a => a[0]))
  return _identSet
}

// Frequencies/runways, keyed by ident — no lat/lon of its own, always used
// alongside getAirports(). Dynamic import so the map's airport layer (and
// anything else that doesn't need this) never pays for the ~2MB chunk.
let _details = null
export async function getAirportDetails() {
  if (_details) return _details
  const d = (await import('../data/geo/airport_details.json')).default
  _details = d
  return _details
}

// Heliports and seaplane bases — kept out of getAirports() entirely (they
// aren't a size tier of airport, see scripts/build_geo_pack.py), so this is
// its own dynamic-import cache with the same lazy-load-once shape.
let _aux = null
export async function getAuxAerodromes() {
  if (_aux) return _aux
  const d = (await import('../data/geo/aux_aerodromes.json')).default
  _aux = d
  return _aux
}

const CLASS_LABEL = ['Small', 'Medium', 'Large']

// waypoints: [{lat, lon}, ...]
//
// Returns { status:'ok', fields:[{ident,name,cls,distNm,alongNm}], count }
// sorted by cross-track distance, or { status:'empty' }.
//
// Departure and destination are excluded. The pilot knows about those, and
// listing them pushes the fields they don't know about off the end.
export async function analyzeAerodromes(waypoints, { withinNm = null, limit = 20 } = {}) {
  const wps = (waypoints || []).filter(w => Number.isFinite(w?.lat) && Number.isFinite(w?.lon))
  if (wps.length < 2) return { status: 'empty' }

  const airports = await getAirports()
  if (!airports) return { status: 'unavailable' }
  const { samples, lengthNm } = sampleRoute(wps, { spacingNm: 25 })
  // withinNm overrides every class when given; otherwise each class brings
  // its own radius and the box has to cover the widest of them.
  const limitFor = cls => withinNm ?? (CORRIDOR_BY_CLASS[cls] ?? CORRIDOR_BY_CLASS[0])
  const box = bboxOf(samples, (withinNm ?? CORRIDOR_NM) + 5)

  const ends = [wps[0], wps[wps.length - 1]]
  const hits = []
  for (const a of airports) {
    const [ident, lat, lon, cls, name] = a
    if (lat < box.minLat || lat > box.maxLat || lon < box.minLon || lon > box.maxLon) continue
    // nearest approach across every leg
    let best = Infinity
    for (let i = 0; i < wps.length - 1; i++) {
      const d = crossTrackNm(lat, lon, [wps[i].lat, wps[i].lon], [wps[i + 1].lat, wps[i + 1].lon])
      if (d < best) best = d
    }
    if (best > limitFor(cls)) continue
    // the field you departed from or are landing at is not en-route traffic
    if (ends.some(e => haversineNm(lat, lon, e.lat, e.lon) < 2)) continue
    // distance along route, for ordering the list the way it will be flown
    let alongNm = 0, bestAlong = Infinity
    for (const s of samples) {
      const d = haversineNm(lat, lon, s.lat, s.lon)
      if (d < bestAlong) { bestAlong = d; alongNm = s.distNm }
    }
    // lat/lon ride along: the list is also what the map flies to and marks,
    // and re-deriving a field's position from its ident later means a second
    // lookup for something already in hand here.
    hits.push({ ident, name: name || null, cls, clsLabel: CLASS_LABEL[cls], lat, lon,
                distNm: Math.round(best * 10) / 10, alongNm: Math.round(alongNm) })
  }

  // Bigger fields first at equal distance. A Class C field 8 NM off track
  // matters more than a private strip 2 NM off it.
  hits.sort((a, b) => (b.cls - a.cls) || (a.distNm - b.distNm))

  return {
    status: 'ok',
    fields: hits.slice(0, limit),
    count: hits.length,
    withinNm: withinNm ?? null,
    corridorByClass: withinNm ? null : CORRIDOR_BY_CLASS,
    lengthNm: Math.round(lengthNm),
  }
}

// Airports carry a size tier in column 3: 0 small (private strips, farm
// airparks), 1 medium, 2 large. "Major" here means tier 1 or better —
// somewhere a light aircraft could actually depart from, with the ~29k
// private strips excluded. Tier 2 alone would be too strict: it would send
// a pilot sitting at a perfectly good regional field to an international
// one a hundred miles away.
export const MAJOR_TIER = 1

export async function nearestMajorAirport(lat, lon) {
  const list = await getAirports()
  if (!list) return null
  let best = null
  let bestD = Infinity
  for (const [ident, alat, alon, tier, name] of list) {
    if ((tier ?? 0) < MAJOR_TIER) continue
    // Cheap squared distance for the scan — only the winner is measured
    // properly by the caller if it needs a real number.
    const dLat = alat - lat
    const dLon = (alon - lon) * Math.cos((lat * Math.PI) / 180)
    const d = dLat * dLat + dLon * dLon
    if (d < bestD) { bestD = d; best = { icao: ident, lat: alat, lon: alon, tier, name } }
  }
  return best
}
