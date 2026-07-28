// The air along the route, as a vertical profile.
//
// One request to Open-Meteo returns pressure-level wind, temperature, humidity
// and cloud for every sample point on the route — the API takes comma-separated
// coordinates and answers with one object per location, so a 300 NM route costs
// exactly one call, not one per point. Free, keyless, worldwide, CORS-enabled.
//
// Everything the altitude engine knows about the sky comes from here, so two
// details matter more than they look:
//
//   * Levels are bracketed by their own geopotential height, not by a standard
//     atmosphere. On a cold day the 700 hPa level can sit 1,000 ft below where
//     ISA would put it, and that is exactly the error that would place a cloud
//     layer at the wrong altitude.
//   * Wind is interpolated as u/v components. Interpolating direction across
//     the 360/0 boundary averages a north wind and a slightly-west-of-north
//     wind into a southerly.

import { sampleRoute } from './corridor'
import { get, put } from './db'
import { isDailyLimit, DailyLimitError, isDailyLimitError } from './openMeteoLimit'

const API = 'https://api.open-meteo.com/v1/forecast'
const M_TO_FT = 3.28084

// Pressure levels Open-Meteo publishes, with their rough altitudes. The set is
// trimmed to what the flight needs: asking for FL390 data on a 6,000 ft VFR
// hop quadruples the payload for nothing.
const LEVELS = [
  { hPa: 1000, approxFt: 360 },
  { hPa: 925, approxFt: 2500 },
  { hPa: 900, approxFt: 3240 },
  { hPa: 850, approxFt: 4780 },
  { hPa: 800, approxFt: 6390 },
  { hPa: 700, approxFt: 9880 },
  { hPa: 600, approxFt: 13800 },
  { hPa: 500, approxFt: 18290 },
  { hPa: 400, approxFt: 23570 },
  { hPa: 300, approxFt: 30070 },
  { hPa: 250, approxFt: 34000 },
  { hPa: 200, approxFt: 38660 },
]

const PER_LEVEL = ['temperature', 'relative_humidity', 'cloud_cover',
                   'wind_speed', 'wind_direction', 'geopotential_height']
const SURFACE = ['freezing_level_height', 'cape', 'visibility',
                 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high']

const _cache = new Map()
const keyOf = (pts, hour, maxAltFt) =>
  pts.map(p => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join(';') + `@${hour}/${maxAltFt}`

// The same corridor, without the hour — what a stored column is filed under,
// so a forecast fetched for 14:00Z is still findable at 15:00Z.
const routeKeyOf = (pts, maxAltFt) =>
  pts.map(p => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join(';') + `/${maxAltFt}`

// How old a stored wind column may be before it stops being worth showing.
// Winds aloft are a forecast product with hours of validity, so three is
// generous without being dishonest — and the age travels with the data so the
// card can say it.
const STALE_LIMIT_MIN = 180

function levelsFor(maxAltFt) {
  // one level above the ceiling of interest, so the top is interpolated rather
  // than extrapolated
  const idx = LEVELS.findIndex(l => l.approxFt > maxAltFt + 2000)
  return LEVELS.slice(0, idx === -1 ? LEVELS.length : idx + 1)
}

// Index of the forecast hour nearest the planned departure.
function hourIndex(times, departAtISO) {
  const want = new Date(departAtISO || Date.now()).getTime()
  let best = 0, bestD = Infinity
  for (let i = 0; i < times.length; i++) {
    // Open-Meteo returns local-to-the-point ISO strings without a zone; the
    // request asks for UTC so they can be parsed as such.
    const d = Math.abs(new Date(times[i] + 'Z').getTime() - want)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

// waypoints: [{lat, lon}, ...]
//
// Returns { status:'ok', samples, levels, hourISO, surface, columns, stale? }
//   columns[i] = [{ hPa, altFt, tempC, rhPct, cloudPct, windDirDeg, windKt }, ...]
//                ascending in altitude, for sample i
// or { status:'unavailable' } / { status:'empty' }
export async function loadAtmosphere(waypoints, {
  departAtISO = null, maxAltFt = 18000, sampleCount = 5, timeoutMs = 12000,
} = {}) {
  const wps = (waypoints || []).filter(w => Number.isFinite(w?.lat) && Number.isFinite(w?.lon))
  if (wps.length < 2) return { status: 'empty' }

  // Evenly spaced points along the actual track. Five is deliberate: the model
  // grid is 9-25 km, so twenty samples over 300 NM return the same air several
  // times over and only inflate the payload.
  const { samples: all, lengthNm } = sampleRoute(wps, { spacingNm: 5, maxSamples: 400 })
  const step = Math.max(1, Math.floor((all.length - 1) / (sampleCount - 1)))
  const samples = []
  for (let i = 0; i < all.length && samples.length < sampleCount; i += step) samples.push(all[i])
  if (samples[samples.length - 1] !== all[all.length - 1]) samples[samples.length - 1] = all[all.length - 1]

  const levels = levelsFor(maxAltFt)
  const hourKey = new Date(departAtISO || Date.now()).toISOString().slice(0, 13)
  const key = keyOf(samples, hourKey, maxAltFt)
  const routeKey = routeKeyOf(samples, maxAltFt)
  if (_cache.has(key)) return _cache.get(key)

  const hourly = [
    ...levels.flatMap(l => PER_LEVEL.map(v => `${v}_${l.hPa}hPa`)),
    ...SURFACE,
  ].join(',')
  const params = new URLSearchParams({
    latitude: samples.map(s => s.lat.toFixed(3)).join(','),
    longitude: samples.map(s => s.lon.toFixed(3)).join(','),
    hourly,
    wind_speed_unit: 'kn',
    timezone: 'UTC',
    forecast_days: '3',
  })

  // One attempt used to be the whole story, and any hiccup — most often a
  // rate-limit 429 from the free tier — took the winds aloft with it. The
  // altitude advice then fell back to terrain, airspace and rules, and the
  // weather cross-section disappeared entirely, because it cannot be drawn
  // without a wind column. That is a lot to lose to a transient failure that
  // clears in a second, especially since the terrain analysis on the same
  // screen queries the same host and can be what tripped the limit.
  //
  // The exception is the daily allowance. That 429 will not clear before
  // tomorrow, so the three attempts and their backoff are 5.8 s of measured
  // delay buying a certainty — and the pilot pays it staring at a card that
  // has not drawn yet. Recognised, it goes straight to the stored column.
  let payload
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API}?${params}`, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) {
        throw (await isDailyLimit(res)) ? new DailyLimitError() : new Error(String(res.status))
      }
      payload = await res.json()
      break
    } catch (e) {
      if (isDailyLimitError(e) || attempt >= 2) return await lastGood(routeKey)
      await new Promise(r => setTimeout(r, 1200 * (attempt + 1)))
    }
  }

  const locs = Array.isArray(payload) ? payload : [payload]
  if (!locs.length || !locs[0]?.hourly?.time) return await lastGood(routeKey)

  const h = hourIndex(locs[0].hourly.time, departAtISO)
  const columns = locs.map(loc => {
    const hr = loc.hourly
    return levels.map(l => {
      const gp = hr[`geopotential_height_${l.hPa}hPa`]?.[h]
      return {
        hPa: l.hPa,
        altFt: gp != null ? Math.round(gp * M_TO_FT) : l.approxFt,
        tempC: hr[`temperature_${l.hPa}hPa`]?.[h] ?? null,
        rhPct: hr[`relative_humidity_${l.hPa}hPa`]?.[h] ?? null,
        cloudPct: hr[`cloud_cover_${l.hPa}hPa`]?.[h] ?? null,
        windKt: hr[`wind_speed_${l.hPa}hPa`]?.[h] ?? null,
        windDirDeg: hr[`wind_direction_${l.hPa}hPa`]?.[h] ?? null,
      }
    }).sort((a, b) => a.altFt - b.altFt)
  })

  const surface = locs.map(loc => {
    const hr = loc.hourly
    const fl = hr.freezing_level_height?.[h]
    return {
      freezingFt: fl != null ? Math.round(fl * M_TO_FT) : null,
      capeJkg: hr.cape?.[h] ?? null,
      visibilityM: hr.visibility?.[h] ?? null,
      cloudLowPct: hr.cloud_cover_low?.[h] ?? null,
      cloudMidPct: hr.cloud_cover_mid?.[h] ?? null,
      cloudHighPct: hr.cloud_cover_high?.[h] ?? null,
    }
  })

  const out = {
    status: 'ok',
    samples: samples.map(s => ({ lat: s.lat, lon: s.lon, distNm: s.distNm })),
    lengthNm,
    levels: levels.map(l => l.hPa),
    hourISO: locs[0].hourly.time[h] + 'Z',
    model: 'Open-Meteo (best match)',
    columns,
    surface,
  }
  _cache.set(key, out)
  // Kept for the next time the network says no. Fire-and-forget: a storage
  // failure must not cost the caller the data it already has.
  put('settings', { key: 'wxAloft', routeKey, savedAt: Date.now(), data: out }).catch(() => {})
  return out
}

// The last wind column fetched for this corridor, if it is recent enough to
// still describe the air. Returned marked stale and with its age, so the card
// can show the profile and say how old it is rather than showing nothing —
// the same bargain the METAR cache already makes.
async function lastGood(routeKey) {
  try {
    const saved = await get('settings', 'wxAloft')
    if (!saved || saved.routeKey !== routeKey || !saved.data) return { status: 'unavailable' }
    const ageMin = Math.round((Date.now() - saved.savedAt) / 60000)
    if (ageMin > STALE_LIMIT_MIN) return { status: 'unavailable' }
    return { ...saved.data, stale: true, ageMin }
  } catch {
    return { status: 'unavailable' }
  }
}

// Linear interpolation of one column to an arbitrary altitude. Below the
// lowest level or above the highest, the nearest level is returned rather than
// extrapolated — an invented value up there would be indistinguishable from a
// real one.
export function atAltitude(column, altFt) {
  if (!column?.length) return null
  if (altFt <= column[0].altFt) return { ...column[0], extrapolated: true }
  const top = column[column.length - 1]
  if (altFt >= top.altFt) return { ...top, extrapolated: true }

  let i = 0
  while (i < column.length - 1 && column[i + 1].altFt < altFt) i++
  const a = column[i], b = column[i + 1]
  const t = (altFt - a.altFt) / Math.max(1, b.altFt - a.altFt)
  const lerp = (x, y) => (x == null || y == null ? (x ?? y) : x + (y - x) * t)

  // u/v so the 360/0 wrap cannot average a north wind into a southerly
  let windKt = null, windDirDeg = null
  if (a.windKt != null && b.windKt != null && a.windDirDeg != null && b.windDirDeg != null) {
    const uv = w => [-w.windKt * Math.sin((w.windDirDeg * Math.PI) / 180),
                     -w.windKt * Math.cos((w.windDirDeg * Math.PI) / 180)]
    const [ua, va] = uv(a), [ub, vb] = uv(b)
    const u = ua + (ub - ua) * t, v = va + (vb - va) * t
    windKt = Math.hypot(u, v)
    windDirDeg = (Math.atan2(-u, -v) * 180) / Math.PI
    if (windDirDeg < 0) windDirDeg += 360
  }

  return {
    altFt,
    tempC: lerp(a.tempC, b.tempC),
    rhPct: lerp(a.rhPct, b.rhPct),
    cloudPct: lerp(a.cloudPct, b.cloudPct),
    windKt,
    windDirDeg,
    extrapolated: false,
  }
}

// Mean conditions at one altitude across the whole route, plus the fraction of
// the route where cloud cover reaches `cloudThreshold` — the along-track
// exposure is what decides whether a layer matters or is just a patch.
export function alongRoute(atmo, altFt, { cloudThreshold = 60 } = {}) {
  if (atmo?.status !== 'ok') return null
  const cells = atmo.columns.map(c => atAltitude(c, altFt)).filter(Boolean)
  if (!cells.length) return null

  const mean = k => {
    const vals = cells.map(c => c[k]).filter(v => v != null)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }
  let u = 0, v = 0, n = 0
  for (const c of cells) {
    if (c.windKt == null || c.windDirDeg == null) continue
    u += -c.windKt * Math.sin((c.windDirDeg * Math.PI) / 180)
    v += -c.windKt * Math.cos((c.windDirDeg * Math.PI) / 180)
    n++
  }
  let windKt = null, windDirDeg = null
  if (n) {
    u /= n; v /= n
    windKt = Math.hypot(u, v)
    windDirDeg = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360
  }

  return {
    altFt,
    tempC: mean('tempC'),
    rhPct: mean('rhPct'),
    cloudPct: mean('cloudPct'),
    windKt,
    windDirDeg,
    cloudFrac: cells.filter(c => (c.cloudPct ?? 0) >= cloudThreshold).length / cells.length,
    freezingFt: atmo.surface?.length
      ? atmo.surface.map(s => s.freezingFt).filter(f => f != null).reduce((s, f, _, arr) => s + f / arr.length, 0) || null
      : null,
  }
}
