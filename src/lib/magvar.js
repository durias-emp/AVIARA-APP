// Magnetic variation at a point, from NOAA.
//
// Extracted so the direct-route panel and the route board ask the same source
// the same way. A magnetic course is the difference between a legal cruising
// altitude and an illegal one, so the two must not disagree about it.
//
// On failure the answer is zero, which makes magnetic equal true. That is what
// the planner already shows in the same circumstance, and it is the honest
// fallback: a variation this app could not fetch is not a variation it should
// invent.

const cache = new Map()

export async function magneticVariation(lat, lon, timeoutMs = 4000) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 0
  // Rounded to a degree for the key. Variation changes by well under a degree
  // across that, and a route re-planned a few miles along should not refetch.
  const key = `${lat.toFixed(0)},${lon.toFixed(0)}`
  if (cache.has(key)) return cache.get(key)
  try {
    const r = await fetch(
      `https://www.ngdc.noaa.gov/geomag-web/calculators/calculateDeclination?lat1=${lat.toFixed(4)}&lon1=${lon.toFixed(4)}&key=zNEw7&resultFormat=json`,
      { signal: AbortSignal.timeout(timeoutMs) },
    )
    const d = await r.json()
    const v = d.result?.[0]?.declination ?? 0
    cache.set(key, v)
    return v
  } catch {
    return 0
  }
}

// True course to magnetic. Variation east means magnetic reads less than true,
// which is the "east is least" every pilot is taught.
export function toMagnetic(trueDeg, variation) {
  return ((trueDeg - (variation ?? 0)) % 360 + 360) % 360
}
