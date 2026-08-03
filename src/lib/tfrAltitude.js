// Per-TFR floor/ceiling altitude — a genuinely separate data source from
// the lateral TFR polygons (RouteAltitude.jsx's loadTFRs/tfrConflicts):
// the FAA WFS layer behind those polygons (TFR:V_TFR_LOC) has NO altitude
// field at all (confirmed live via DescribeFeatureType — only SHAPE, GID,
// CNS_LOCATION_ID, NOTAM_KEY, TITLE, LAST_MODIFICATION_DATETIME, STATE,
// LEGAL). Floor/ceiling only exists in the structured NOTAM detail text
// tfr.faa.gov's own detail page renders — fetched here via api/tfr-detail.js
// from the same internal API the site uses (tfrapi/getWebText), confirmed
// live to return real, consistently-phrased altitude text, e.g.:
//   "From the surface up to and including 400 feet AGL"
//   "From and including 9000 feet MSL up to and including 17999 feet MSL"
//
// Only fetched for TFRs the route ALREADY laterally intersects (a handful
// per route at most) — never a bulk fetch across all active TFRs.

// AGL-referenced bands are NOT converted to MSL — doing that correctly
// needs the ground elevation at the TFR's specific location, which isn't
// available in this pipeline. Rather than guess, `ref` is passed through
// untouched so callers can treat AGL bands as informational only (soft
// penalty) and reserve hard disqualification for MSL-referenced bands,
// which compare directly against a candidate cruise altitude.
function parseAltitudeBands(plainText) {
  const bands = []

  const surfaceRe = /From the surface up to and including (\d+) feet (AGL|MSL)/gi
  for (const m of plainText.matchAll(surfaceRe)) {
    bands.push({ floorFt: 0, ceilingFt: parseInt(m[1]), ref: m[2].toUpperCase() })
  }

  const rangeRe = /From and including (\d+) feet (AGL|MSL) up to and including (\d+) feet (AGL|MSL)/gi
  for (const m of plainText.matchAll(rangeRe)) {
    bands.push({ floorFt: parseInt(m[1]), ceilingFt: parseInt(m[3]), ref: m[4].toUpperCase() })
  }

  return bands
}

// notamId: e.g. "6/0650" (the same id already carried on each object in
// RouteAltitude.jsx's tfrData/tfrConflicts arrays).
// Returns [] if the fetch fails or no recognized altitude phrasing is found
// — never a guessed band.
export async function fetchTfrAltitudes(notamId) {
  if (!notamId) return []
  try {
    const res = await fetch(`/api/tfr-detail?notamId=${encodeURIComponent(notamId)}`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    const data = await res.json()
    const html = data?.[0]?.text
    if (!html) return []
    const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    return parseAltitudeBands(plain)
  } catch {
    return []
  }
}
