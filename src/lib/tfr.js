// Temporary flight restrictions, normalised for drawing.
//
// The planner has carried this logic inline since before there was a second
// map. It lives here so the map home can draw the same restrictions from the
// same proxy rather than growing a second, subtly different idea of what a TFR
// is. The planner still has its own copy plus a GeoRSS fallback path; this is
// the GeoJSON half, which is what /api/tfr actually serves.

// Colour by what the restriction is for, because a pilot reacts differently to
// a presidential movement than to a wildfire. Same mapping the planner uses.
export function tfrColor(type) {
  const t = (type || '').toUpperCase()
  if (t.includes('VIP') || t.includes('SECURITY') || t.includes('MILITARY')) return '#FF3B30'
  if (t.includes('HAZARD') || t.includes('WILDFIRE') || t.includes('DISASTER')) return '#FF9500'
  if (t.includes('AIR SHOW') || t.includes('SPORT')) return '#5AC8FA'
  if (t.includes('SPACE')) return '#AF52DE'
  if (t.includes('UAS') || t.includes('DRONE') || t.includes('GATHERING')) return '#FFD60A'
  return '#FF3B30'
}

// GeoJSON coordinates are [lon, lat]; Leaflet wants [lat, lon]. Getting this
// backwards puts every restriction in the wrong hemisphere, which is the kind
// of wrong that looks like a broken feed rather than a swapped pair.
const flip = (ring) => ring.map(([lo, la]) => [la, lo])

export function parseTfrFeatures(geo) {
  return (geo?.features ?? []).map(f => {
    const p = f.properties ?? {}
    let polygon = null, lat = null, lon = null

    if (f.geometry?.type === 'Polygon') {
      polygon = flip(f.geometry.coordinates[0])
      ;[lat, lon] = polygon[0]
    } else if (f.geometry?.type === 'MultiPolygon') {
      polygon = flip(f.geometry.coordinates[0][0])
      ;[lat, lon] = polygon[0]
    } else if (f.geometry?.type === 'Point') {
      ;[lon, lat] = f.geometry.coordinates
    }

    return {
      id: p.NOTAM_KEY ?? f.id ?? '?',
      type: p.LEGAL ?? 'TFR',
      desc: p.TITLE ?? '',
      state: p.STATE ?? '',
      lat, lon, polygon,
    }
  }).filter(t => t.lat != null)
}

export async function loadTfrs() {
  const res = await fetch('/api/tfr', { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`tfr proxy ${res.status}`)
  return parseTfrFeatures(await res.json())
}
