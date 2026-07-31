// Waypoint resolution: Garmin/ForeFlight-style named waypoints.
//
// Three kinds:
//   GPS: 5-letter RNAV/intersection fixes (FAA NASR, US coverage)
//   VOR: 2-3 letter navaid identifiers (NASR + openAIP, worldwide)
//   USER: user-defined names, stored locally (settings key 'user_waypoints',
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

// Airway IDs are 1-2 letters + digits (V25, J501, Q822, T254), never collides
// with VOR idents (pure letters) or 5-letter fixes.
// Pull every pack the route resolver needs, at once.
//
// Resolving a route string touches three of them. Airways, fixes/navaids and
// procedures, and each is triggered by a different stage of the same
// per-token pipeline: check for an airway, then resolve a fix, then look for a
// procedure. Every token walks those stages in order, so the packs ended up
// loading in three sequential waves rather than together. Measured on a
// KSAN–KSEA routing: airways done at 942 ms, fixes at 1,581 ms, procedures at
// 1,983 ms, two seconds of waiting for work that overlaps completely.
//
// Callers warm this when they know a route string is about to be resolved, so
// the packs are already in memory by the time a finger lands on one.
export function preloadNavdata() {
  return Promise.all([loadNavdata(), loadAirways()])
}

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
// variants: the one containing both endpoints wins. Direction follows the
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
    // fromPos anchors the chain to the right continent. The entry fix the
    // pilot typed is already resolved, so duplicates downstream follow it.
    let near = fromPos
    for (const pt of idents) {
      const hit = await resolveWaypoint(pt, near)
      if (!hit) continue // not in our navdata (rare). The leg just spans it
      fixes.push({ kind: hit.kind, name: hit.name, lat: hit.lat, lon: hit.lon, via: id })
      near = [hit.lat, hit.lon]
    }
    return { fixes, maxMEA }
  }
  return { error: `${fromName} and ${toName} are not both on ${id}` }
}

// ── Airway geometry for map rendering ───────────────────────────
// Resolves every airway's fix chain to coordinates once (memoized) so the
// map can draw the network like SkyVector's World Lo/Hi. Essential where
// no raster chart exists (Central America). Unresolvable points split the
// line rather than rubber-banding across the gap.
let _geometry = null
export async function getAirwayGeometry() {
  if (_geometry) return _geometry
  const [{ fixes, navaids }, airways] = await Promise.all([
    (async () => {
      const [f, n] = await Promise.all([
        import('../data/navdata/fixes.json'),
        import('../data/navdata/navaids.json'),
      ])
      return { fixes: f.default, navaids: n.default }
    })(),
    loadAirways(),
  ])

  const coordsOf = (name, near) => {
    let cands = null
    const fx = fixes[name]
    if (fx) cands = Array.isArray(fx[0]) ? fx : [fx]
    else if (navaids[name]) cands = navaids[name].map(e => [e[0], e[1]])
    if (!cands) return null
    if (!near || cands.length === 1) return cands[0]
    let best = cands[0], bd = Infinity
    for (const c of cands) {
      const d = (c[0] - near[0]) ** 2 + ((c[1] - near[1]) * 0.97) ** 2
      if (d < bd) { bd = d; best = c }
    }
    return best
  }

  const lines = []
  const pointsByKey = new Map() // name@lat,lon -> {name,lat,lon,vor,freq,lo,hi}
  for (const [id, variants] of Object.entries(airways)) {
    const cls = /^(U|J|Q)/.test(id) ? 'hi' : 'lo'
    for (const v of variants) {
      // Anchor pass: unambiguous points define where this airway lives, so a
      // duplicated ident at the START of the chain (CAT, MGA, CTM… exist on
      // several continents) resolves to the right one instead of whichever
      // came first in the file.
      let aLat = 0, aLon = 0, aN = 0
      for (const name of v.pts) {
        const fxc = fixes[name]
        const one = fxc && !Array.isArray(fxc[0]) ? fxc
          : (navaids[name] && navaids[name].length === 1 ? navaids[name][0] : null)
        if (one) { aLat += one[0]; aLon += one[1]; aN++ }
      }
      const anchor = aN ? [aLat / aN, aLon / aN] : null

      let seg = []
      let segTrk = []
      let segMea = []
      let near = anchor
      for (let pi = 0; pi < v.pts.length; pi++) {
        const name = v.pts[pi]
        const c = coordsOf(name, near)
        if (!c) {
          if (seg.length >= 2) lines.push({ id, cls, latlngs: seg, trk: segTrk, mea: segMea })
          seg = []; segTrk = []; segMea = []
          continue
        }
        // Antimeridian: Alaska/Pacific airways cross 180°, where a raw
        // longitude jump (174E → -177W) would draw the line the long way
        // around the world. Unwrap into a continuous frame instead.
        let cLon = c[1]
        if (seg.length) {
          const prevLon = seg[seg.length - 1][1]
          while (cLon - prevLon > 180) cLon -= 360
          while (cLon - prevLon < -180) cLon += 360
        }
        // A leg this long is either a genuine oceanic route or a fix that
        // resolved to the wrong continent. 600 NM caught the second and
        // severed the first: routes across the Gulf and the eastern Pacific
        // are drawn between fixes hundreds of miles apart, and cutting them
        // left the map full of lines that stop over open water. The anchor
        // pass above is what guards against a bad resolve now, so this only
        // has to catch what survives it, and nothing legitimate reaches
        // 1,000 NM between adjacent points.
        if (seg.length) {
          const p = seg[seg.length - 1]
          const dLat = (c[0] - p[0]) * 60
          const dLon = (cLon - p[1]) * 60 * Math.cos(((c[0] + p[0]) / 2) * Math.PI / 180)
          if (Math.hypot(dLat, dLon) > 1000) {
            if (seg.length >= 2) lines.push({ id, cls, latlngs: seg, trk: segTrk, mea: segMea })
            seg = []; segTrk = []; segMea = []
            near = c
            seg.push([c[0], c[1]])
            continue
          }
        }
        near = c
        if (seg.length) {
          segTrk.push(v.trk?.[pi - 1] ?? null)
          segMea.push(v.mea?.[pi - 1] ?? null)
        }
        // unwrapped longitude keeps the line continuous across 180°
        seg.push([c[0], cLon])
        const key = `${name}@${c[0].toFixed(3)},${c[1].toFixed(3)}`
        let p = pointsByKey.get(key)
        if (!p) {
          const nv = navaids[name]
          const match = nv && nv.find(e => Math.abs(e[0] - c[0]) < 0.01 && Math.abs(e[1] - c[1]) < 0.01)
          p = { name, lat: c[0], lon: c[1], vor: !!match,
                vorName: match ? match[2] : null, freq: match ? match[3] : null,
                lo: false, hi: false }
          pointsByKey.set(key, p)
        }
        p[cls] = true
      }
      if (seg.length >= 2) lines.push({ id, cls, latlngs: seg, trk: segTrk, mea: segMea })
    }
  }
  _geometry = { lines, points: [...pointsByKey.values()] }
  return _geometry
}

// ── World reference layer (TIER 2) ──────────────────────────────
// Global airway geometry for regions with no authoritative pack. GPL v3
// X-Plane/Robin Peel data, cycle 2012.08. REFERENCE ONLY, deliberately
// isolated from resolveWaypoint/expandAirway so a stale airway can never
// end up in a filed route. Bounding boxes are precomputed for viewport
// culling: there are ~40k polylines.
let _worldRef = null
export async function getWorldRef() {
  if (_worldRef) return _worldRef
  const d = (await import('../data/navdata/world_ref.json')).default
  const items = d.lines.map((latlngs, i) => {
    let minLat = latlngs[0][0], maxLat = latlngs[0][0]
    let minLon = latlngs[0][1], maxLon = latlngs[0][1]
    for (const [la, lo] of latlngs) {
      if (la < minLat) minLat = la
      if (la > maxLat) maxLat = la
      if (lo < minLon) minLon = lo
      if (lo > maxLon) maxLon = lo
    }
    return { latlngs, hi: d.hi[i], bbox: [minLat, maxLat, minLon, maxLon] }
  })
  _worldRef = items
  return items
}

// Main entry: resolve a typed identifier to a waypoint.
// nearPos ([lat, lon], optional) disambiguates duplicate idents by proximity. 
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
