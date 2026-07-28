// Routes that ATC actually issues between two airports.
//
// A straight line between two ICAO codes is almost never the clearance. The
// FAA publishes what it will actually give you: TEC routes for the short
// low-altitude hops between adjacent terminal areas, Preferred IFR Routes for
// the en-route structure, NAR for the oceanic ones. File one of those and the
// clearance usually matches what was filed; file the great circle and it gets
// amended on the ground.
//
// The pack is built by scripts/build_preferred_routes.py from the NASR PFR
// subset and downloads on first use rather than at install (see
// vite.config.js), so it is there offline once a route has been planned.

import { looksLikeAirway, lookupAirway, resolveWaypoint } from './waypoints'

let _routes = null
async function load() {
  if (_routes) return _routes
  try {
    _routes = (await import('../data/geo/preferred_routes.json')).default
    return _routes
  } catch {
    return null                       // offline before the first download
  }
}

export const TYPE_LABEL = {
  TEC: 'Tower en route',
  L: 'Preferred, low',
  LDD: 'Preferred, low',
  H: 'Preferred, high',
  HDD: 'Preferred, high',
  HPD: 'High, pref. departure',
  SHD: 'High, single direction',
  SLD: 'Low, single direction',
  NAR: 'North American Route',
}

// NASR keys airports by their FAA identifier — SAN, not KSAN. A pilot types
// the ICAO code, so both spellings have to be tried; outside the US the ICAO
// code is the only one there is, and simply misses, which is correct.
function idents(code) {
  const id = (code || '').trim().toUpperCase()
  if (!id) return []
  const out = [id]
  if (id.length === 4 && id[0] === 'K') out.push(id.slice(1))
  return out
}

// Returns [{d, t, r, a, h, ac, dir, typeLabel}] ordered as published — the
// routings a light aircraft is actually given first — or [] when there is
// nothing published for the pair (which is the common case: 7,661 pairs out
// of every possible one).
export async function preferredRoutes(dep, dest) {
  const data = await load()
  if (!data) return []
  for (const a of idents(dep)) {
    for (const b of idents(dest)) {
      const hit = data[`${a}>${b}`]
      if (hit) return hit.map(r => ({
        ...r,
        typeLabel: TYPE_LABEL[r.t] || r.t,
        // TEC routes are named (SANQ3A); preferred routes are only numbered
        // within the pair, and a bare "2" on a button says nothing.
        label: /^\d+$/.test(r.d || '') ? `Route ${r.d}` : (r.d || r.t),
      }))
    }
  }
  return []
}

// Split a published route string into tokens the route card can act on.
//
// Three kinds come back, and the difference matters:
//   AWY   an airway — the app expands it into its fix chain
//   FIX   a fix, navaid or intersection the resolver knows
//   PROC  everything else, which in practice means a SID or STAR name
//         (CWARD2, PHLBO4). Those are procedures, not points; expanding them
//         needs the FAA CIFP, which this app does not carry. They are shown
//         as published and left out of the waypoint rows rather than being
//         guessed at.
export async function classifyRoute(routeString, nearPos) {
  const tokens = (routeString || '').trim().split(/\s+/).filter(Boolean)
  return Promise.all(tokens.map(async text => {
    if (looksLikeAirway(text) && await lookupAirway(text)) {
      return { text, kind: 'AWY', resolved: { kind: 'AWY', name: text } }
    }
    const hit = await resolveWaypoint(text, nearPos)
    if (hit) return { text, kind: 'FIX', resolved: hit }
    return { text, kind: 'PROC', resolved: null }
  }))
}
