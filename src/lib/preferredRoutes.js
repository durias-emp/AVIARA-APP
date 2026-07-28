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
import { getAirports } from './aerodromes'
import { haversineNm } from './corridor'

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
      if (hit) return hit.map(r => decorate(r, { basis: 'exact', from: a, to: b }))
    }
  }
  return []
}

function decorate(r, { basis, from, to, viaField, viaEnd, distNm }) {
  return {
    ...r,
    basis,
    from,
    to,
    viaField: viaField || null,
    viaEnd: viaEnd || null,
    viaDistNm: distNm ?? null,
    typeLabel: TYPE_LABEL[r.t] || r.t,
    // TEC routes are named (SANQ3A); preferred routes are only numbered
    // within the pair, and a bare "2" on a button says nothing.
    label: /^\d+$/.test(r.d || '') ? `Route ${r.d}` : (r.d || r.t),
  }
}

// ── When nothing is published for the pair ────────────────────────────────
//
// Only 7,661 pairs are published, and only 3,741 of those have their reverse
// published too. Two things are usually still worth showing, and both are
// inferences rather than the FAA's own answer for the route being flown — so
// they are kept separate from the exact matches and labelled as what they are.

const NEAR_NM = 30

let _served = null                    // every ident the file has a routing for
function servedIdents(data) {
  if (_served) return _served
  _served = new Set()
  for (const k of Object.keys(data)) {
    if (k === '_meta') continue
    const [a, b] = k.split('>')
    _served.add(a); _served.add(b)
  }
  return _served
}

// Fields within 30 NM that the file does have routings for, biggest first —
// a satellite field's traffic is worked by the same terminal facility, so the
// routings out of the primary field are the ones being issued in that airspace.
async function neighbours(code, data, limit = 3) {
  const airports = await getAirports()
  if (!airports) return []
  const wanted = idents(code)
  const self = airports.find(a => wanted.includes(a[0]) || wanted.includes(a[0].replace(/^K/, '')))
  if (!self) return []
  const [, lat, lon] = self
  const served = servedIdents(data)
  const out = []
  for (const [ident, la, lo, cls] of airports) {
    if (Math.abs(la - lat) > 0.6 || Math.abs(lo - lon) > 0.8) continue
    const key = served.has(ident) ? ident : served.has(ident.replace(/^K/, '')) ? ident.replace(/^K/, '') : null
    if (!key || wanted.includes(ident) || wanted.includes(key)) continue
    const d = haversineNm(lat, lon, la, lo)
    if (d > NEAR_NM) continue
    out.push({ key, ident, cls, distNm: d })
  }
  out.sort((a, b) => (b.cls - a.cls) || (a.distNm - b.distNm))
  return out.slice(0, limit)
}

// Everything the file can offer for this pair, in descending order of how
// directly it answers the question actually asked.
//
//   exact    the FAA's published routing for this pair, flown this way
//   reverse  published for the opposite direction only. Often flyable read
//            backwards, but routings are frequently one-way by design, so this
//            is a starting point to check against the clearance, not an answer.
//   nearby   published for an adjacent field in the same terminal area. The
//            airspace and the facility are the same; the departure or arrival
//            end is not.
export async function lookupRoutes(dep, dest) {
  const data = await load()
  if (!data) return { exact: [], reverse: [], nearby: [] }

  const exact = await preferredRoutes(dep, dest)
  // Only worth showing when the real answer is missing — alternatives
  // alongside an exact match are noise, and noise next to a filed route is
  // how the wrong string gets read to clearance delivery.
  if (exact.length) return { exact, reverse: [], nearby: [] }

  const reverse = []
  for (const a of idents(dep)) {
    for (const b of idents(dest)) {
      const hit = data[`${b}>${a}`]
      if (hit && !reverse.length) {
        reverse.push(...hit.map(r => decorate(r, { basis: 'reverse', from: b, to: a })))
      }
    }
  }

  const nearby = []
  const [depNear, destNear] = await Promise.all([neighbours(dep, data), neighbours(dest, data)])
  const depKeys = [...idents(dep).map(k => ({ key: k, sub: null, distNm: 0 })), ...depNear.map(n => ({ key: n.key, sub: n.ident, distNm: n.distNm }))]
  const destKeys = [...idents(dest).map(k => ({ key: k, sub: null, distNm: 0 })), ...destNear.map(n => ({ key: n.key, sub: n.ident, distNm: n.distNm }))]
  for (const a of depKeys) {
    for (const b of destKeys) {
      // Exactly one end substituted. Neither is the exact pair, already
      // missed; both is two different airports from the one being flown, which
      // is no longer the same route in any useful sense.
      if ((a.sub ? 1 : 0) + (b.sub ? 1 : 0) !== 1) continue
      const hit = data[`${a.key}>${b.key}`]
      if (!hit) continue
      nearby.push(...hit.slice(0, 3).map(r => decorate(r, {
        basis: 'nearby', from: a.key, to: b.key,
        viaField: a.sub || b.sub, viaEnd: a.sub ? 'dep' : 'dest',
        distNm: Math.round(a.sub ? a.distNm : b.distNm),
      })))
      if (nearby.length >= 6) return { exact, reverse, nearby: nearby.slice(0, 6) }
    }
  }

  return { exact, reverse, nearby }
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
