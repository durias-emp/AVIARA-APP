// Turning a runway's two thresholds into the shape it is on the ground.
//
// Pure arithmetic, no Leaflet, no React, so the drawing code stays about
// drawing and this can be checked against a published aerodrome chart on its
// own. Everything here works in a local flat frame centred on the runway:
// at the scale of one strip, a few thousand feet, the curvature of the earth
// is far below the width of the paint, and a flat frame keeps the maths
// readable where a spherical one would not.

const FT_PER_M = 3.280839895
const M_PER_DEG_LAT = 111320

function metresPerDegLon(lat) {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)
}

// Offset a point by (east, north) metres. The inverse of the frame below.
function offset(lat, lon, east, north) {
  return [lat + north / M_PER_DEG_LAT, lon + east / metresPerDegLon(lat)]
}

// The runway's own axes, in metres, with `a` at the origin.
//
// Returns the along-runway unit vector, the across-runway unit vector, the
// length between the two thresholds and the true bearing a -> b. `across` is
// the along vector turned 90 degrees clockwise, which is the right-hand side
// of the runway seen from the `a` threshold.
export function runwayFrame(a, b) {
  const midLat = (a[0] + b[0]) / 2
  const east = (b[1] - a[1]) * metresPerDegLon(midLat)
  const north = (b[0] - a[0]) * M_PER_DEG_LAT
  const span = Math.hypot(east, north)
  if (!span) return null
  const along = [east / span, north / span]
  return {
    along,
    across: [along[1], -along[0]],
    spanM: span,
    bearing: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360,
  }
}

// The pavement, as four corners in Leaflet's [lat, lon] order.
//
// widthFt may be missing: not every source publishes one, and a runway with an
// unknown width is still in a known place. The fallback is deliberately narrow
// (75 ft, the smallest paved width in common use) so that a guess is never
// drawn wider than the real thing and never overlaps a taxiway that is there.
export function runwayCorners(a, b, widthFt) {
  const f = runwayFrame(a, b)
  if (!f) return null
  const halfM = ((widthFt || 75) / FT_PER_M) / 2
  const [ex, ny] = f.across
  const push = (p, sign) => offset(p[0], p[1], sign * ex * halfM, sign * ny * halfM)
  return [push(a, 1), push(b, 1), push(b, -1), push(a, -1)]
}

// A point some distance along the runway from one threshold towards the other.
// `fromB` measures back from the far end instead.
export function alongRunway(a, b, metres, fromB = false) {
  const f = runwayFrame(a, b)
  if (!f) return null
  const d = Math.min(metres, f.spanM)
  const [ex, ny] = f.along
  return fromB
    ? offset(b[0], b[1], -ex * d, -ny * d)
    : offset(a[0], a[1], ex * d, ny * d)
}

// A line across the runway at a given distance from a threshold: the shape a
// threshold bar takes. It has to be given the runway's width, because `frac`
// is a fraction OF that width, and a bar that does not know how wide the
// pavement is is a bar drawn a foot long.
export function crossBar(a, b, metres, widthFt, { fromB = false, frac = 1 } = {}) {
  const f = runwayFrame(a, b)
  const centre = alongRunway(a, b, metres, fromB)
  if (!f || !centre) return null
  const half = (((widthFt || 75) / FT_PER_M) * frac) / 2
  const [ex, ny] = f.across
  return [
    offset(centre[0], centre[1], ex * half, ny * half),
    offset(centre[0], centre[1], -ex * half, -ny * half),
  ]
}

// How many metres one screen pixel covers, at this latitude and zoom. The Web
// Mercator ground resolution, and the only thing standing between a runway
// measured in feet and a label sized in pixels.
export function metresPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

// The two ends of a runway, ready to label.
//
// `bearing` is the direction a pilot faces when landing on that end, which is
// the direction its number is painted in: the designator's own "up" points
// down the runway, away from the approach. Drawing it any other way puts the
// numbers on the map at an angle no pilot has ever seen them at.
export function runwayEnds(row) {
  const [le, he, leLat, leLon, heLat, heLon, lengthFt, widthFt] = row
  const a = [leLat, leLon]
  const b = [heLat, heLon]
  const f = runwayFrame(a, b)
  if (!f) return []
  // Painted designators sit about 60 m in from the threshold. On a short
  // strip that would be a quarter of the runway, so it is capped.
  const inset = Math.min(60, f.spanM * 0.16)
  return [
    { ident: le, bearing: f.bearing, at: alongRunway(a, b, inset), lengthFt, widthFt },
    { ident: he, bearing: (f.bearing + 180) % 360, at: alongRunway(a, b, inset, true), lengthFt, widthFt },
  ]
}
