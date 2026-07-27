// Route corridor sampling — the geometric foundation for overflight analysis.
//
// Everything that asks "what is under this route?" (terrain, water, urban
// areas, airports) needs the same thing first: points along the actual track,
// spaced closely enough that nothing hides between them.
//
// Two things the previous inline version got wrong and this fixes:
//
//   1. Linear lat/lon interpolation is not a flight path. Over 1,000 NM at
//      mid latitudes it drifts tens of NM from the great circle the aircraft
//      (and the app's own distance/course numbers) actually follow. Points are
//      interpolated on the sphere instead.
//   2. A fixed number of samples means the spacing grows with the route. 15
//      points over 1,000 NM is one sample every ~70 NM — a mountain range fits
//      comfortably between two of them. Spacing is fixed in distance instead,
//      so resolution does not degrade as the route gets longer.
//
// A corridor also has width: "highest terrain within 5 NM" cannot be answered
// by a zero-width centerline, so samples can be offset perpendicular to track.

const R_NM = 3440.065 // Earth radius in nautical miles
const D2R = Math.PI / 180
const R2D = 180 / Math.PI

function toVec(lat, lon) {
  const la = lat * D2R, lo = lon * D2R
  const cl = Math.cos(la)
  return [cl * Math.cos(lo), cl * Math.sin(lo), Math.sin(la)]
}

function toLatLon(v) {
  const [x, y, z] = v
  return [Math.atan2(z, Math.hypot(x, y)) * R2D, Math.atan2(y, x) * R2D]
}

export function haversineNm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R
  const dLon = (lon2 - lon1) * D2R
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)))
}

// Point at fraction t along the great circle from a to b (slerp).
export function interpGC(a, b, t) {
  const va = toVec(a[0], a[1]), vb = toVec(b[0], b[1])
  const dot = Math.max(-1, Math.min(1, va[0]*vb[0] + va[1]*vb[1] + va[2]*vb[2]))
  const ang = Math.acos(dot)
  // Coincident or antipodal-ish: slerp is undefined/unstable, fall back to a
  // linear blend — at these separations the difference is meaningless anyway.
  if (ang < 1e-9) return [a[0], a[1]]
  const s = Math.sin(ang)
  const k1 = Math.sin((1 - t) * ang) / s
  const k2 = Math.sin(t * ang) / s
  return toLatLon([
    k1 * va[0] + k2 * vb[0],
    k1 * va[1] + k2 * vb[1],
    k1 * va[2] + k2 * vb[2],
  ])
}

// Initial great-circle bearing a → b, degrees true.
export function bearing(a, b) {
  const la1 = a[0] * D2R, la2 = b[0] * D2R, dLon = (b[1] - a[1]) * D2R
  const y = Math.sin(dLon) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon)
  return (Math.atan2(y, x) * R2D + 360) % 360
}

// Point distNm from [lat,lon] on bearing brg (degrees true).
export function destination(lat, lon, brg, distNm) {
  const d = distNm / R_NM, b = brg * D2R
  const la1 = lat * D2R, lo1 = lon * D2R
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b))
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1),
                               Math.cos(d) - Math.sin(la1) * Math.sin(la2))
  return [la2 * R2D, ((lo2 * R2D + 540) % 360) - 180]
}

export function routeLengthNm(waypoints) {
  let d = 0
  for (let i = 0; i < waypoints.length - 1; i++) {
    d += haversineNm(waypoints[i].lat, waypoints[i].lon, waypoints[i + 1].lat, waypoints[i + 1].lon)
  }
  return d
}

// Sample the centerline at a fixed distance interval.
//
// waypoints: [{lat, lon}, ...]  (2 or more)
// spacingNm: target distance between samples (default 5 NM)
// maxSamples: hard ceiling; spacing widens rather than exceed it, so a
//   transcontinental route stays bounded. The effective spacing is reported
//   on the result so callers can say how fine the analysis actually was.
//
// Returns { samples: [{lat, lon, distNm, legIndex}], spacingNm, lengthNm }
// where distNm is distance from the departure point along the route. Both
// endpoints and every waypoint are always included.
export function sampleRoute(waypoints, { spacingNm = 5, maxSamples = 400 } = {}) {
  const pts = (waypoints || []).filter(w => Number.isFinite(w?.lat) && Number.isFinite(w?.lon))
  if (pts.length < 2) return { samples: [], spacingNm: 0, lengthNm: 0 }

  const legLen = []
  for (let i = 0; i < pts.length - 1; i++) {
    legLen.push(haversineNm(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon))
  }
  const lengthNm = legLen.reduce((s, d) => s + d, 0)
  if (lengthNm < 0.1) {
    return { samples: [{ lat: pts[0].lat, lon: pts[0].lon, distNm: 0, legIndex: 0 }], spacingNm: 0, lengthNm }
  }

  const step = Math.max(spacingNm, lengthNm / maxSamples)
  const samples = []
  let travelled = 0

  for (let i = 0; i < pts.length - 1; i++) {
    const a = [pts[i].lat, pts[i].lon], b = [pts[i + 1].lat, pts[i + 1].lon]
    const len = legLen[i]
    samples.push({ lat: a[0], lon: a[1], distNm: travelled, legIndex: i })
    // Intermediate points, excluding the leg's own endpoints — the next leg
    // contributes its start point, and the final destination is added below.
    const n = Math.max(1, Math.round(len / step))
    for (let k = 1; k < n; k++) {
      const t = k / n
      const [la, lo] = interpGC(a, b, t)
      samples.push({ lat: la, lon: lo, distNm: travelled + len * t, legIndex: i })
    }
    travelled += len
  }
  const last = pts[pts.length - 1]
  samples.push({ lat: last.lat, lon: last.lon, distNm: lengthNm, legIndex: pts.length - 2 })

  return { samples, spacingNm: step, lengthNm }
}

// Widen a centerline into a corridor: for each sample, add points offset
// perpendicular to the local track. Used for "highest terrain within N NM",
// which a centerline cannot answer.
//
// offsets are in NM, signed — negative is left of track, positive is right.
// Returns a flat array of {lat, lon, distNm, legIndex, offsetNm}; the
// centerline itself is included when 0 is among the offsets.
export function widenCorridor(samples, { offsetsNm = [-5, 0, 5] } = {}) {
  if (!samples?.length) return []
  const out = []
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    // Local track from the neighbouring samples; at the ends, use the only
    // neighbour available.
    const a = samples[Math.max(0, i - 1)]
    const b = samples[Math.min(samples.length - 1, i + 1)]
    const trk = (a === b) ? 0 : bearing([a.lat, a.lon], [b.lat, b.lon])
    for (const off of offsetsNm) {
      if (off === 0) { out.push({ ...s, offsetNm: 0 }); continue }
      const [la, lo] = destination(s.lat, s.lon, (trk + (off > 0 ? 90 : 270) + 360) % 360, Math.abs(off))
      out.push({ lat: la, lon: lo, distNm: s.distNm, legIndex: s.legIndex, offsetNm: off })
    }
  }
  return out
}

// Bounding box of a sample set, padded in NM — for area queries (airports,
// SUA, parks) that take an envelope.
export function bboxOf(samples, padNm = 0) {
  if (!samples?.length) return null
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180
  for (const s of samples) {
    if (s.lat < minLat) minLat = s.lat
    if (s.lat > maxLat) maxLat = s.lat
    if (s.lon < minLon) minLon = s.lon
    if (s.lon > maxLon) maxLon = s.lon
  }
  if (padNm) {
    const dLat = padNm / 60
    const midLat = (minLat + maxLat) / 2
    const dLon = padNm / (60 * Math.max(0.05, Math.cos(midLat * D2R)))
    minLat -= dLat; maxLat += dLat; minLon -= dLon; maxLon += dLon
  }
  return { minLat, maxLat, minLon, maxLon }
}

// Perpendicular (cross-track) distance from a point to the great circle
// through a→b, in NM. Signed distance is not needed here, so it comes back
// absolute. Points beyond either end of the segment are measured to that end,
// so a field 200 NM past the destination isn't reported as "on track".
export function crossTrackNm(lat, lon, a, b) {
  const d13 = haversineNm(a[0], a[1], lat, lon)
  if (d13 < 1e-6) return 0
  const brg13 = bearing(a, [lat, lon]) * D2R
  const brg12 = bearing(a, b) * D2R
  const legNm = haversineNm(a[0], a[1], b[0], b[1])
  const xt = Math.asin(Math.sin(d13 / R_NM) * Math.sin(brg13 - brg12)) * R_NM
  // along-track distance decides whether the perpendicular actually lands on
  // the segment
  const at = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13 / R_NM) / Math.cos(xt / R_NM)))) * R_NM
  const ahead = Math.cos(brg13 - brg12) >= 0
  if (!ahead) return d13
  if (at > legNm) return haversineNm(b[0], b[1], lat, lon)
  return Math.abs(xt)
}
