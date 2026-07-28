// Terrain analysis along a route corridor.
//
// Answers the question the mountain checklist actually asks — "1,000 ft above
// the highest terrain within 5 NM" — with a number instead of a chip. That
// needs three things the previous version didn't have: samples at a fixed
// spacing, samples either side of track, and an elevation source that can be
// asked about hundreds of points.
//
// Source: Open-Meteo's elevation API (Copernicus DEM GLO-90, ~90 m posts).
// Free, keyless, CORS-enabled, and it takes 100 coordinates per GET. If it is
// unreachable, Open-Elevation (SRTM) is tried as a fallback; if both fail the
// result says so, because a silent empty result reads as "no mountains" and
// that is the one wrong answer this must never give.

import { sampleRoute, widenCorridor, crossTrackNm, haversineNm } from './corridor'

const M_TO_FT = 3.28084
const BATCH = 100

// Cheap memo — waypoint drags re-run detection on every commit, and the same
// corridor should not be re-queried each time.
const _cache = new Map()
const keyOf = (wps, spacing, corridor) =>
  wps.map(w => `${w.lat.toFixed(3)},${w.lon.toFixed(3)}`).join(';') + `@${spacing}/${corridor}`

async function openMeteo(pts, signal) {
  const lat = pts.map(p => p.lat.toFixed(4)).join(',')
  const lon = pts.map(p => p.lon.toFixed(4)).join(',')
  const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, { signal })
  if (!res.ok) throw new Error(`open-meteo ${res.status}`)
  const d = await res.json()
  if (!Array.isArray(d.elevation) || d.elevation.length !== pts.length) throw new Error('open-meteo shape')
  return d.elevation
}

async function openElevation(pts, signal) {
  const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ locations: pts.map(p => ({ latitude: +p.lat.toFixed(4), longitude: +p.lon.toFixed(4) })) }),
    signal,
  })
  if (!res.ok) throw new Error(`open-elevation ${res.status}`)
  const d = await res.json()
  const out = (d.results || []).map(r => r.elevation)
  if (out.length !== pts.length) throw new Error('open-elevation shape')
  return out
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Elevations in metres for every point, or null if no source answered.
//
// Batches go out sequentially, not in parallel: Open-Meteo's free tier meters
// by the minute and a burst of six 100-point requests trips it, which is
// exactly what long routes would produce. One retry absorbs a transient limit;
// a batch that still fails fails the whole request rather than leaving a hole,
// since a missing batch would silently lower the reported maximum.
async function fetchElevations(pts, timeoutMs) {
  const batches = []
  for (let i = 0; i < pts.length; i += BATCH) batches.push(pts.slice(i, i + BATCH))
  for (const source of [openMeteo, openElevation]) {
    try {
      const out = []
      for (const b of batches) {
        let got
        try {
          got = await source(b, AbortSignal.timeout(timeoutMs))
        } catch {
          await sleep(1200)
          got = await source(b, AbortSignal.timeout(timeoutMs))
        }
        out.push(...got)
      }
      return out
    } catch { /* try the next source */ }
  }
  return null
}

// waypoints: [{lat, lon}, ...]
// altFt: planned cruise altitude, for the clearance figure (optional)
//
// Returns:
//   { status: 'ok', maxFt, atDistNm, atLat, atLon, clearanceFt, meetsMin,
//     centerlineFt, spacingNm, corridorNm, lengthNm, pointCount }
//   { status: 'unavailable' }  — no elevation source answered
//   { status: 'empty' }        — fewer than two waypoints
export async function analyzeTerrain(waypoints, { altFt = null, spacingNm = 5, corridorNm = 5, maxPoints = 300, timeoutMs = 12000 } = {}) {
  const wps = (waypoints || []).filter(w => Number.isFinite(w?.lat) && Number.isFinite(w?.lon))
  if (wps.length < 2) return { status: 'empty' }

  // The measurement depends only on the corridor, so it is what gets cached;
  // clearance is derived per call, since the pilot changes cruise altitude far
  // more often than the route.
  const key = keyOf(wps, spacingNm, corridorNm)
  if (_cache.has(key)) return withClearance(_cache.get(key), altFt)

  // Three points per station (left / track / right), so the station budget is
  // a third of the point budget. On a long route this widens the spacing
  // rather than firing more requests — the effective value is reported.
  const { samples, spacingNm: step, lengthNm } = sampleRoute(wps, {
    spacingNm, maxSamples: Math.floor(maxPoints / 3),
  })
  const pts = widenCorridor(samples, { offsetsNm: [-corridorNm, 0, corridorNm] })

  const metres = await fetchElevations(pts, timeoutMs)
  if (!metres) {
    // Not cached: a failure is usually transient, and caching it would make
    // the route look permanently unanalysable.
    return { status: 'unavailable' }
  }

  let maxFt = -Infinity, at = null
  const centerlineFt = []
  const scored = []
  for (let i = 0; i < pts.length; i++) {
    const ft = (metres[i] ?? 0) * M_TO_FT
    scored.push({ pt: pts[i], ft })
    if (ft > maxFt) { maxFt = ft; at = pts[i] }
    if (pts[i].offsetNm === 0) centerlineFt.push(ft)
  }

  // Second and third passes: close in on the high ground.
  //
  // The lattice above is 5 NM in both directions, and calling the highest of
  // those samples "the highest within 5 NM" was wrong by a margin that
  // matters. On a Sierra crossing it reported 7,618 ft; a 1 NM grid over the
  // same ground finds 8,765 ft less than two miles away. Terrain clearance is
  // computed off this figure, so an aircraft planned 1,000 ft above it would
  // have been 150 ft BELOW the ridge it was clearing.
  //
  // Sampling the whole corridor finely would cost dozens of requests. The
  // maximum only ever hides near ground that is already high, so the coarse
  // pass picks the candidates and two refinements walk in: 1 NM around the
  // best few, then 0.25 NM around whatever that finds.
  const refined = await refinePeak(scored, wps, corridorNm, timeoutMs)
  let finestNm = step
  let pointCount = pts.length
  if (refined) {
    pointCount += refined.pointCount
    finestNm = refined.finestNm
    if (refined.ft > maxFt) {
      maxFt = refined.ft
      at = { ...refined.pt, distNm: nearestAlongNm(refined.pt, samples) }
    }
  }

  const out = {
    status: 'ok',
    maxFt: Math.round(maxFt),
    atDistNm: at ? Math.round(at.distNm) : null,
    atLat: at?.lat ?? null,
    atLon: at?.lon ?? null,
    centerlineFt,
    spacingNm: Math.round(step * 10) / 10,
    finestNm: Math.round(finestNm * 100) / 100,
    corridorNm,
    lengthNm: Math.round(lengthNm),
    pointCount,
  }
  _cache.set(key, out)
  return withClearance(out, altFt)
}

// A square of sample points around a centre, at the given spacing, keeping
// only those still inside the corridor — terrain 6 NM off track is not what
// "highest within 5 NM" is promising, however tall it is.
function boxWithin(centre, radiusNm, stepNm, wps, corridorNm) {
  const out = []
  const n = Math.round(radiusNm / stepNm)
  const cosLat = Math.max(0.05, Math.cos((centre.lat * Math.PI) / 180))
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const lat = centre.lat + (i * stepNm) / 60
      const lon = centre.lon + (j * stepNm) / (60 * cosLat)
      let best = Infinity
      for (let k = 0; k < wps.length - 1; k++) {
        const d = crossTrackNm(lat, lon, [wps[k].lat, wps[k].lon], [wps[k + 1].lat, wps[k + 1].lon])
        if (d < best) best = d
      }
      if (best <= corridorNm) out.push({ lat, lon })
    }
  }
  return out
}

// Nearest along-route distance, for labelling where the peak is.
function nearestAlongNm(pt, samples) {
  let best = Infinity, at = 0
  for (const s of samples) {
    const d = haversineNm(pt.lat, pt.lon, s.lat, s.lon)
    if (d < best) { best = d; at = s.distNm }
  }
  return at
}

// Two candidates, not three. Every request here goes to the same host and the
// same free-tier quota as the winds-aloft call on the same screen, and losing
// the wind column costs the altitude advice and the whole cross-section. The
// second candidate is cheap insurance against the highest coarse sample
// sitting on a shoulder; a third almost never changes the answer and is not
// worth spending another slice of the budget on.
const TOP_CANDIDATES = 2

async function refinePeak(scored, wps, corridorNm, timeoutMs) {
  const top = [...scored].sort((a, b) => b.ft - a.ft).slice(0, TOP_CANDIDATES)
  if (!top.length) return null

  let pointCount = 0
  let best = { ft: top[0].ft, pt: top[0].pt }
  let finestNm = 1

  // Pass 2 — 1 NM around each candidate, all in one batch.
  const coarseBox = top.flatMap(c => boxWithin(c.pt, 3, 1, wps, corridorNm))
  if (coarseBox.length) {
    const m = await fetchElevations(coarseBox, timeoutMs)
    if (m) {
      pointCount += coarseBox.length
      for (let i = 0; i < coarseBox.length; i++) {
        const ft = (m[i] ?? 0) * M_TO_FT
        if (ft > best.ft) best = { ft, pt: coarseBox[i] }
      }
    }
  }

  // Pass 3 — 0.25 NM around whatever that found. A summit is a point, and at
  // 90 m the DEM can resolve one; the sampling is what has to catch up.
  const fineBox = boxWithin(best.pt, 1, 0.25, wps, corridorNm)
  if (fineBox.length) {
    const m = await fetchElevations(fineBox, timeoutMs)
    if (m) {
      pointCount += fineBox.length
      finestNm = 0.25
      for (let i = 0; i < fineBox.length; i++) {
        const ft = (m[i] ?? 0) * M_TO_FT
        if (ft > best.ft) best = { ft, pt: fineBox[i] }
      }
    }
  }

  return { ...best, pointCount, finestNm }
}

// §91.177-style margin: 1,000 ft over the highest obstacle within the corridor
// (2,000 ft in designated mountainous terrain — not modelled here, so this is
// the floor of the rule, not the whole of it).
function withClearance(base, altFt) {
  if (!altFt) return { ...base, clearanceFt: null, meetsMin: null }
  return {
    ...base,
    clearanceFt: Math.round(altFt - base.maxFt),
    meetsMin: altFt - base.maxFt >= 1000,
  }
}

// Terrain over 5,000 ft is the conventional threshold for treating a route as
// mountainous for planning purposes. Kept here so the caller states intent
// rather than repeating a magic number.
export const MOUNTAIN_FT = 5000
