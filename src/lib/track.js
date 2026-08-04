// What counts as a real position, and the geometry for drawing a set of them.
//
// Three things now build a line out of GPS fixes — the breadcrumb overlay, the
// flight timer's track, and the automatic detector — and they must agree on
// which fixes are real. Three copies of this arithmetic would drift, and the
// drift would show up as a logbook and a shared image disagreeing about the
// same flight.

const R_NM = 3440.065

export function haversineNm(a, b) {
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)))
}

// A phone on the glareshield jitters by tens of metres. Drawn, that jitter is
// a scribble around the parking spot; summed, it is distance the aircraft
// never flew. And a GPS jump — cold fix, tunnel, tower handoff — draws a
// straight line across a county.
export const MAX_ACCURACY_M = 100
export const MIN_STEP_NM = 0.02      // about 37 m
export const MAX_STEP_KT = 600       // faster than any light aircraft

export function isUsableFix(coords) {
  if (!coords || coords.lat == null || coords.lon == null) return false
  return coords.accuracyM == null || coords.accuracyM <= MAX_ACCURACY_M
}

// Whether `next` earns a place after `last`. No previous point means yes:
// the first fix of a track defines where it starts.
export function shouldKeepFix(last, next) {
  if (!last) return true
  const nm = haversineNm(last, next)
  if (nm < MIN_STEP_NM) return false
  const hours = (next.t - last.t) / 3_600_000
  if (hours > 0 && nm / hours > MAX_STEP_KT) return false
  return true
}

// One fix, in the shape everything downstream reads.
//
// The live watch already reports heading, groundspeed and accuracy, and the
// track was throwing all three away — which left the recorder unable to answer
// anything a debrief asks. Recording them costs nothing; recovering them after
// the flight is impossible.
export function fixFrom(coords, t = Date.now()) {
  return {
    lat: coords.lat,
    lon: coords.lon,
    altFt: coords.altFt ?? null,
    speedKt: coords.speedKt ?? null,
    headingDeg: coords.headingDeg ?? null,
    accuracyM: coords.accuracyM ?? null,
    t,
  }
}

export function trackDistanceNm(track) {
  if (!track || track.length < 2) return 0
  let nm = 0
  for (let i = 1; i < track.length; i++) nm += haversineNm(track[i - 1], track[i])
  return nm
}

// Fits a track into a box, in the projection a web map uses, so a shared
// image and the map it was flown on agree about shape.
//
// Web Mercator, not raw lat/lon: plotting degrees directly squashes a track
// horizontally, and the further from the equator the worse it gets. A flight
// in northern Canada would come out visibly wrong.
export function projectTrack(track, { width, height, padding = 0.12 }) {
  const pts = (track ?? []).filter(p => p && p.lat != null && p.lon != null)
  if (pts.length === 0) return { points: [], scale: 0 }

  const merc = pts.map(p => ({
    x: (p.lon + 180) / 360,
    y: (1 - Math.log(Math.tan((p.lat * Math.PI) / 180) + 1 / Math.cos((p.lat * Math.PI) / 180)) / Math.PI) / 2,
  }))

  const xs = merc.map(m => m.x), ys = merc.map(m => m.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = maxX - minX || 1e-9
  const spanY = maxY - minY || 1e-9

  const padPx = Math.min(width, height) * padding
  const boxW = width - padPx * 2
  const boxH = height - padPx * 2
  // One scale for both axes, so the track keeps its shape rather than being
  // stretched to fill the frame.
  const scale = Math.min(boxW / spanX, boxH / spanY)

  const drawnW = spanX * scale
  const drawnH = spanY * scale
  const offsetX = (width - drawnW) / 2
  const offsetY = (height - drawnH) / 2

  return {
    points: merc.map(m => ({ x: offsetX + (m.x - minX) * scale, y: offsetY + (m.y - minY) * scale })),
    scale,
    bounds: { minX, maxX, minY, maxY },
    offset: { x: offsetX, y: offsetY },
  }
}
