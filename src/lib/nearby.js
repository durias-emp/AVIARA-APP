// What is near a point you just dropped on the map.
//
// Dropping a finger on a chart and getting a bare latitude/longitude is rarely
// what a pilot wants. Almost always there is a fix, a navaid or a field within
// a few miles, and routing via a named point is what gets filed, read back and
// found on the chart. So a drop offers what is actually there first, and the
// raw coordinate as the fallback it should be.
//
// The data: fixes, navaids, airports. Ships with the app but downloads on
// first use rather than at install (see vite.config.js), so the picker opens
// instantly and works with no signal once a route has been planned once.

import { haversineNm } from './corridor'
import { getAirports } from './aerodromes'

let _nav = null
async function loadNav() {
  if (_nav) return _nav
  try {
    const [f, n] = await Promise.all([
      import('../data/navdata/fixes.json'),
      import('../data/navdata/navaids.json'),
    ])
    _nav = { fixes: f.default, navaids: n.default }
    return _nav
  } catch {
    return { fixes: {}, navaids: {} }   // offline before first download
  }
}

const CLASS_LABEL = ['Small', 'Medium', 'Large']

// lat/lon: where the finger landed
// withinNm: how far to look. 10 NM keeps the list to what is genuinely "here". 
//   widen it and a drop in the north-east corridor returns forty airports.
//
// Returns [{kind:'AIRPORT'|'VOR'|'FIX', ident, name, lat, lon, distNm, bearing}]
// sorted by distance, biggest airports first among equals.
export async function nearbyPoints(lat, lon, { withinNm = 10, limit = 12 } = {}) {
  const [{ fixes, navaids }, airports] = await Promise.all([loadNav(), getAirports()])
  if (!airports) return []

  // A degree of latitude is 60 NM; longitude shrinks with the cosine. This box
  // is only a prefilter. The real test is the haversine below.
  const dLat = withinNm / 60
  const dLon = withinNm / (60 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))
  const inBox = (la, lo) => Math.abs(la - lat) <= dLat && Math.abs(lo - lon) <= dLon

  const out = []

  for (const [ident, la, lo, cls, name] of airports) {
    if (!inBox(la, lo)) continue
    const d = haversineNm(lat, lon, la, lo)
    if (d > withinNm) continue
    out.push({ kind: 'AIRPORT', ident, name: name || null, sub: `${CLASS_LABEL[cls]} airport`, lat: la, lon: lo, distNm: d, rank: 3 - cls })
  }

  for (const [ident, entries] of Object.entries(navaids)) {
    for (const [la, lo, name, freq] of entries) {
      if (!inBox(la, lo)) continue
      const d = haversineNm(lat, lon, la, lo)
      if (d > withinNm) continue
      out.push({ kind: 'VOR', ident, name: name || null, sub: freq ? `VOR ${freq}` : 'VOR', lat: la, lon: lo, distNm: d, rank: 4 })
    }
  }

  for (const [ident, coord] of Object.entries(fixes)) {
    const coords = Array.isArray(coord[0]) ? coord : [coord]
    for (const [la, lo] of coords) {
      if (!inBox(la, lo)) continue
      const d = haversineNm(lat, lon, la, lo)
      if (d > withinNm) continue
      out.push({ kind: 'FIX', ident, name: null, sub: 'Waypoint', lat: la, lon: lo, distNm: d, rank: 5 })
    }
  }

  out.sort((a, b) => a.distNm - b.distNm || a.rank - b.rank)
  return out.slice(0, limit)
}

export const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'airports', label: 'Airports', match: p => p.kind === 'AIRPORT' },
  { id: 'nav', label: 'Waypoints', match: p => p.kind === 'VOR' || p.kind === 'FIX' },
]
