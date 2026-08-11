// A typed route, turned into points on the map.
//
// Lifted out of FlightPlanBar so the nav bar at the top of the map and the
// planner resolve a route the same way. Two parsers would have meant a route
// that works in one box and fails in the other, which is worse than no parser
// in the second box at all.
//
// What a token can be, in the order they are tried:
//
//   an airport      ICAO, or a 3-letter US ident with or without its K
//   a VOR or NDB    by identifier
//   a GPS fix       the five-letter names on the charts
//   a user waypoint anything the pilot saved themselves
//   coordinates     handled by the waypoint resolver
//
// Airports go first because a great many airports share an identifier with a
// navaid on the same field, and a pilot typing CYTZ means the aerodrome.

import { getAirports } from './aerodromes'
import { resolveWaypoint } from './waypoints'

export async function resolveToken(raw, nearPos) {
  const ident = (raw ?? '').trim().toUpperCase()
  if (!ident) return null

  // May be null when the airport table could not be loaded. Falling through to
  // the waypoint resolver is the right answer then: it reaches fixes, navaids
  // and coordinates, none of which live in this table, so a typed route still
  // resolves what it can instead of failing on the first leg.
  const airports = (await getAirports()) ?? []
  const tryIdents = [ident]
  if (ident.length === 3) tryIdents.push('K' + ident)
  if (ident.length === 4 && ident[0] === 'K') tryIdents.push(ident.slice(1))
  for (const cand of tryIdents) {
    const hit = airports.find(a => a[0] === cand)
    if (hit) {
      const [id, lat, lon, , name] = hit
      return { kind: 'APT', name: id, label: name, lat, lon }
    }
  }

  const wp = await resolveWaypoint(ident, nearPos)
  if (wp) return { kind: wp.kind, name: wp.name, label: wp.vorName || null, lat: wp.lat, lon: wp.lon }

  return null
}

// The whole string. Returns what resolved and what did not, rather than
// throwing on the first bad token: a pilot who mistyped one fix in a five-point
// route should see which one, with the rest of the route still drawn.
//
// Each token is resolved relative to the one before it, which is what makes a
// duplicated fix identifier resolve to the one actually on the route rather
// than to whichever the database happens to list first.
export async function resolveRouteText(text) {
  const tokens = (text ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean)
  const points = []
  const bad = []
  let nearPos = null
  for (const t of tokens) {
    const hit = await resolveToken(t, nearPos)
    if (hit) {
      points.push(hit)
      nearPos = [hit.lat, hit.lon]
    } else {
      bad.push(t)
    }
  }
  return { points, bad }
}

// The route as a pilot would write it, for putting back in the box.
export function routeToText(points) {
  return (points ?? []).map(p => p.name).filter(Boolean).join(' ')
}
