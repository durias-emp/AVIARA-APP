// Waypoint resolution — Garmin/ForeFlight-style named waypoints.
//
// Three kinds:
//   GPS  — 5-letter RNAV/intersection fixes (FAA NASR, US coverage)
//   VOR  — 2-3 letter navaid identifiers (NASR + openAIP, worldwide)
//   USER — user-defined names, stored locally (settings key 'user_waypoints',
//          synced to cloud backup). A user waypoint name must not shadow an
//          existing GPS fix or VOR identifier.
//
// The navdata JSON is ~2 MB so it is dynamically imported on first use and
// cached; the PWA precache makes it available offline after first load.

import { get, put } from './db'

let _fixes = null
let _navaids = null

async function loadNavdata() {
  if (!_fixes) {
    const [f, n] = await Promise.all([
      import('../data/navdata/fixes.json'),
      import('../data/navdata/navaids.json'),
    ])
    _fixes = f.default
    _navaids = n.default
  }
  return { fixes: _fixes, navaids: _navaids }
}

function sq(x) { return x * x }
// Cheap relative distance for nearest-candidate picks (no need for haversine)
function dist2(lat1, lon1, lat2, lon2) {
  const scale = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180)
  return sq(lat1 - lat2) + sq((lon1 - lon2) * scale)
}

function nearest(candidates, nearPos) {
  if (candidates.length === 1 || !nearPos) return candidates[0]
  let best = candidates[0]
  let bestD = Infinity
  for (const c of candidates) {
    const d = dist2(c.lat, c.lon, nearPos[0], nearPos[1])
    if (d < bestD) { bestD = d; best = c }
  }
  return best
}

export async function getUserWaypoints() {
  const row = await get('settings', 'user_waypoints')
  return row?.list ?? []
}

export async function saveUserWaypoint(name, lat, lon) {
  const ident = name.trim().toUpperCase()
  const reserved = await lookupNamed(ident)
  if (reserved) {
    throw new Error(`"${ident}" already exists as a ${reserved.kind} waypoint`)
  }
  const list = await getUserWaypoints()
  const next = list.filter(w => w.name !== ident)
  next.push({ name: ident, lat, lon, createdAt: Date.now() })
  await put('settings', { key: 'user_waypoints', list: next })
  return { kind: 'USER', name: ident, lat, lon }
}

export async function removeUserWaypoint(name) {
  const ident = name.trim().toUpperCase()
  const list = await getUserWaypoints()
  await put('settings', { key: 'user_waypoints', list: list.filter(w => w.name !== ident) })
}

// Resolve against GPS fixes and VORs only (not user waypoints).
async function lookupNamed(ident, nearPos) {
  const { fixes, navaids } = await loadNavdata()

  if (ident.length === 5) {
    const hit = fixes[ident]
    if (hit) {
      // duplicates are stored as [[lat,lon],[lat,lon]]
      const coords = Array.isArray(hit[0]) ? hit : [hit]
      const cands = coords.map(([lat, lon]) => ({ kind: 'GPS', name: ident, lat, lon }))
      return nearest(cands, nearPos)
    }
  }

  if (ident.length >= 2 && ident.length <= 3) {
    const hits = navaids[ident]
    if (hits) {
      const cands = hits.map(([lat, lon, name, freq]) => ({
        kind: 'VOR', name: ident, lat, lon, vorName: name, freq,
      }))
      return nearest(cands, nearPos)
    }
  }

  return null
}

// ── Airways (V/J/Q/T routes) ────────────────────────────────────
let _airways = null
async function loadAirways() {
  if (!_airways) _airways = (await import('../data/navdata/airways.json')).default
  return _airways
}

// Airway IDs are 1-2 letters + digits (V25, J501, Q822, T254) — never collides
// with VOR idents (pure letters) or 5-letter fixes.
export function looksLikeAirway(ident) {
  return /^[A-Z]{1,2}\d{1,4}$/.test((ident || '').trim().toUpperCase())
}

export async function lookupAirway(ident) {
  const a = await loadAirways()
  return a[(ident || '').trim().toUpperCase()] ?? null
}

// Expand an airway between two named points that must both lie on it.
// Returns { fixes: [{kind,name,lat,lon,via}], maxMEA } or { error }.
// Duplicate-ID airways (e.g. V25 exists in CONUS and Hawaii) are stored as
// variants — the one containing both endpoints wins. Direction follows the
// entry→exit order; endpoints themselves are excluded.
export async function expandAirway(ident, fromName, toName, fromPos) {
  const id = ident.trim().toUpperCase()
  const variants = await lookupAirway(id)
  if (!variants) return { error: `Airway ${id} not found` }

  for (const v of variants) {
    const i1 = v.pts.indexOf(fromName)
    const i2 = v.pts.indexOf(toName)
    if (i1 === -1 || i2 === -1) continue

    const lo = Math.min(i1, i2), hi = Math.max(i1, i2)
    const idents = v.pts.slice(lo + 1, hi)
    if (i1 > i2) idents.reverse()
    const meas = v.mea.slice(lo, hi).filter(m => m != null)
    const maxMEA = meas.length ? Math.max(...meas) : null

    const fixes = []
    let near = fromPos
    for (const pt of idents) {
      const hit = await resolveWaypoint(pt, near)
      if (!hit) continue // not in our navdata (rare) — the leg just spans it
      fixes.push({ kind: hit.kind, name: hit.name, lat: hit.lat, lon: hit.lon, via: id })
      near = [hit.lat, hit.lon]
    }
    return { fixes, maxMEA }
  }
  return { error: `${fromName} and ${toName} are not both on ${id}` }
}

// Main entry: resolve a typed identifier to a waypoint.
// nearPos ([lat, lon], optional) disambiguates duplicate idents by proximity —
// pass the departure airport or route midpoint.
// Returns { kind: 'GPS'|'VOR'|'USER', name, lat, lon, vorName?, freq? } or null.
export async function resolveWaypoint(name, nearPos) {
  const ident = (name || '').trim().toUpperCase()
  if (!ident) return null

  const named = await lookupNamed(ident, nearPos)
  if (named) return named

  const user = (await getUserWaypoints()).find(w => w.name === ident)
  if (user) return { kind: 'USER', name: user.name, lat: user.lat, lon: user.lon }

  return null
}
