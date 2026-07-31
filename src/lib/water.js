// Overwater analysis against bundled coastline polygons.
//
// Replaces two heuristics that were wrong in opposite directions: terrain at
// or below 15 ft was called water (so any sea-level airport or coastal plain
// flagged "overwater"), and three hardcoded lat/lon boxes for the Caribbean,
// Gulf and Pacific fired even when the route was over land inside them.
//
// What a pilot actually needs before an overwater leg is not a yes/no chip. 
// it is how far from shore they get and for how long, because that is what
// decides life jackets vs. a raft, and whether the glide range ever reaches
// land. So this reports distances, not a boolean.
//
// Data: src/data/geo/land.json (Natural Earth 10m, public domain, bundled. 
// see scripts/build_geo_pack.py). Bundled rather than queried because this is
// a preflight equipment decision that must resolve with no signal.

import { sampleRoute, haversineNm } from './corridor'

let _land = null
// The coastline is no longer precached. It downloads the first time a route
// is analysed and stays cached after that. Before that first fetch it needs a
// connection, so a failure here is a real state the caller has to report
// rather than quietly read as "no water on this route".
export async function getLand() {
  if (_land) return _land
  try {
    _land = (await import('../data/geo/land.json')).default
    return _land
  } catch {
    return null
  }
}

// Ray casting against one ring (array of [lat,lon] taken from the flat store).
function inRing(lat, lon, polys, start, count) {
  let inside = false
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const a = polys[start + i], b = polys[start + j]
    if ((a[0] > lat) !== (b[0] > lat) &&
        lon < (b[1] - a[1]) * (lat - a[0]) / (b[0] - a[0]) + a[1]) {
      inside = !inside
    }
  }
  return inside
}

// Inside any polygon of a set (outer ring, minus its holes).
function inSet(lat, lon, polys, rings, bbox) {
  for (let p = 0; p < rings.length; p++) {
    const bb = bbox[p]
    if (lat < bb[0] || lat > bb[1] || lon < bb[2] || lon > bb[3]) continue
    const idx = rings[p]
    if (!inRing(lat, lon, polys, idx[0][0], idx[0][1])) continue
    let hole = false
    for (let h = 1; h < idx.length; h++) {
      if (inRing(lat, lon, polys, idx[h][0], idx[h][1])) { hole = true; break }
    }
    if (!hole) return true
  }
  return false
}

// Land = inside a land polygon and not inside a lake. Natural Earth's land
// layer does not cut lakes out, so without the second test the Great Lakes
// read as solid ground, and a Chicago–Muskegon crossing is precisely the leg
// this is here to flag.
export function isLand(lat, lon, land) {
  if (!inSet(lat, lon, land.polys, land.rings, land.bbox)) return false
  return !inSet(lat, lon, land.lakePolys, land.lakeRings, land.lakeBbox)
}

// Distance to the nearest coastline vertex, searched outward in rings of
// increasing radius so a mid-ocean point does not scan all 94k vertices.
// Vertex distance slightly overstates the true distance to the shoreline
// (the nearest point may lie along an edge between vertices); at the pack's
// ~1.2 NM simplification that error is well under the granularity of any
// decision taken from it.
function nmToShore(lat, lon, land, capNm = 600) {
  const cosLat = Math.max(0.05, Math.cos(lat * Math.PI / 180))
  // Lake shorelines count: over Lake Superior the nearest land is the lake's
  // own edge, not the Atlantic coast.
  const sets = [
    [land.polys, land.rings, land.bbox],
    [land.lakePolys, land.lakeRings, land.lakeBbox],
  ]
  let best = Infinity
  for (const deg of [1, 3, 8, 20, 999]) {
    const dLat = deg, dLon = deg / cosLat
    for (const [polys, rings, bbox] of sets) {
      for (let p = 0; p < rings.length; p++) {
        const bb = bbox[p]
        // Reject polygons whose bbox cannot hold anything within this radius
        if (bb[0] - dLat > lat || bb[1] + dLat < lat ||
            bb[2] - dLon > lon || bb[3] + dLon < lon) continue
        for (const [start, count] of rings[p]) {
          for (let i = 0; i < count; i++) {
            const v = polys[start + i]
            // cheap degree prefilter before the haversine
            if (Math.abs(v[0] - lat) > dLat || Math.abs(v[1] - lon) * cosLat > dLat) continue
            const d = haversineNm(lat, lon, v[0], v[1])
            if (d < best) best = d
          }
        }
      }
    }
    if (best < Infinity) return best
  }
  return Math.min(best, capNm)
}

// waypoints: [{lat, lon}, ...]
//
// Returns:
//   { status: 'ok', overwater: bool, overwaterNm, longestLegNm,
//     maxFromShoreNm, atDistNm, pctOverwater, spacingNm, lengthNm }
//   { status: 'empty' }: fewer than two waypoints
//
// Distances are quantised to the sample spacing: a sample is credited with
// the half-interval either side of it, so a crossing shorter than the spacing
// can be missed. Spacing is reported so the caller can say so.
export async function analyzeWater(waypoints, { spacingNm = 5 } = {}) {
  const wps = (waypoints || []).filter(w => Number.isFinite(w?.lat) && Number.isFinite(w?.lon))
  if (wps.length < 2) return { status: 'empty' }

  const land = await getLand()
  if (!land) return { status: 'unavailable' }
  const { samples, spacingNm: step, lengthNm } = sampleRoute(wps, { spacingNm, maxSamples: 400 })

  const wet = samples.map(s => !isLand(s.lat, s.lon, land))

  let overwaterNm = 0, longestLegNm = 0, run = 0
  for (let i = 0; i < samples.length; i++) {
    if (wet[i]) {
      // credit each wet sample with half an interval either side, clipped at
      // the route ends
      const prev = i > 0 ? (samples[i].distNm - samples[i - 1].distNm) / 2 : 0
      const next = i < samples.length - 1 ? (samples[i + 1].distNm - samples[i].distNm) / 2 : 0
      overwaterNm += prev + next
      run += prev + next
      if (run > longestLegNm) longestLegNm = run
    } else {
      run = 0
    }
  }

  // Only the wet samples need a shore distance, and only the farthest matters.
  let maxFromShoreNm = 0, atDistNm = null
  for (let i = 0; i < samples.length; i++) {
    if (!wet[i]) continue
    const d = nmToShore(samples[i].lat, samples[i].lon, land)
    if (d > maxFromShoreNm) { maxFromShoreNm = d; atDistNm = samples[i].distNm }
  }

  return {
    status: 'ok',
    overwater: overwaterNm > 0,
    overwaterNm: Math.round(overwaterNm),
    longestLegNm: Math.round(longestLegNm),
    maxFromShoreNm: Math.round(maxFromShoreNm),
    atDistNm: atDistNm == null ? null : Math.round(atDistNm),
    pctOverwater: lengthNm ? Math.round((overwaterNm / lengthNm) * 100) : 0,
    spacingNm: Math.round(step * 10) / 10,
    lengthNm: Math.round(lengthNm),
  }
}
