// Aerodromes along the route.
//
// The previous version queried an FAA ArcGIS service, which covers the United
// States only — so a Central or South American route silently reported no
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
// So: a large field is worth a look from 40 NM — that is roughly where its
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

const CLASS_LABEL = ['Small', 'Medium', 'Large']

// waypoints: [{lat, lon}, ...]
//
// Returns { status:'ok', fields:[{ident,name,cls,distNm,alongNm}], count }
// sorted by cross-track distance, or { status:'empty' }.
//
// Departure and destination are excluded — the pilot knows about those, and
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

  // Bigger fields first at equal distance — a Class C field 8 NM off track
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
