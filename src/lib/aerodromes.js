// Aerodromes along the route.
//
// The previous version queried an FAA ArcGIS service, which covers the United
// States only — so a Central or South American route silently reported no
// aerodromes at all, which reads as "none there" rather than "not looked".
// This uses the bundled OurAirports set instead: worldwide, offline, and the
// same public-domain source the navaid pack already draws on.
//
// It also tightens the corridor from 15 NM to 10. At 15 NM nearly every route
// in the developed world triggers the chip, and a signal that is always on
// carries no information.

import { bboxOf, crossTrackNm, haversineNm, sampleRoute } from './corridor'

export const CORRIDOR_NM = 10

let _airports = null
export async function getAirports() {
  if (_airports) return _airports
  const d = (await import('../data/geo/airports.json')).default
  _airports = d.airports
  return _airports
}

const CLASS_LABEL = ['Small', 'Medium', 'Large']

// waypoints: [{lat, lon}, ...]
//
// Returns { status:'ok', fields:[{ident,name,cls,distNm,alongNm}], count }
// sorted by cross-track distance, or { status:'empty' }.
//
// Departure and destination are excluded — the pilot knows about those, and
// listing them pushes the fields they don't know about off the end.
export async function analyzeAerodromes(waypoints, { withinNm = CORRIDOR_NM, limit = 12 } = {}) {
  const wps = (waypoints || []).filter(w => Number.isFinite(w?.lat) && Number.isFinite(w?.lon))
  if (wps.length < 2) return { status: 'empty' }

  const airports = await getAirports()
  const { samples, lengthNm } = sampleRoute(wps, { spacingNm: 25 })
  const box = bboxOf(samples, withinNm + 5)

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
    if (best > withinNm) continue
    // the field you departed from or are landing at is not en-route traffic
    if (ends.some(e => haversineNm(lat, lon, e.lat, e.lon) < 2)) continue
    // distance along route, for ordering the list the way it will be flown
    let alongNm = 0, bestAlong = Infinity
    for (const s of samples) {
      const d = haversineNm(lat, lon, s.lat, s.lon)
      if (d < bestAlong) { bestAlong = d; alongNm = s.distNm }
    }
    hits.push({ ident, name: name || null, cls, clsLabel: CLASS_LABEL[cls],
                distNm: Math.round(best * 10) / 10, alongNm: Math.round(alongNm) })
  }

  // Bigger fields first at equal distance — a Class C field 8 NM off track
  // matters more than a private strip 2 NM off it.
  hits.sort((a, b) => (b.cls - a.cls) || (a.distNm - b.distNm))

  return {
    status: 'ok',
    fields: hits.slice(0, limit),
    count: hits.length,
    withinNm,
    lengthNm: Math.round(lengthNm),
  }
}
