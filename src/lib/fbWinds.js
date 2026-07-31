// Winds aloft from the FAA's FB bulletin, as a fallback wind column.
//
// Open-Meteo is the primary source and gives far more. Cloud, humidity,
// geopotential heights, worldwide. But it is a free tier with a daily
// allowance, and when that runs out the altitude advice loses the wind, the
// cross-section stops drawing, and the pilot is left with terrain and rules.
//
// The FB product costs nothing and has no quota. It is the official FAA
// forecast, it goes out four times a day, and the app already proxies the
// service it comes from. What it cannot give is cloud and humidity, so this
// is a fallback and not a replacement: the sky layers stay missing and the
// card says so.
//
// Shape matches loadAtmosphere exactly, so nothing downstream needs to know
// which source answered.

import STATIONS from '../data/geo/fb_stations.json'
import { haversineNm } from './corridor'

const AWC = '/api/awc'

// The FB levels, in order of the bulletin's columns. These are pressure
// altitudes; treating them as MSL is the same approximation the paper product
// invites, and well inside the error of a 6-hour wind forecast.
const LEVELS_FT = [3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000]

// Column start positions and widths in the fixed-width bulletin, measured
// against a live one rather than assumed:
//
//   ABR 9900 9900+21 2605+13 3012+07 3125-07 3126-19 296031 296439 295749
//       ^4   ^9      ^17     ^25     ^33     ^41     ^49    ^56    ^63
//
// Parsing by offset rather than by splitting on whitespace, because an omitted
// level is blank space, not a placeholder. ABI reports nothing at 3,000 ft,
// and split() would shift every later level down one, handing the pilot the
// 6,000 ft wind labelled 3,000.
//
// The first field is four wide because the bulletin carries no temperature at
// 3,000 ft, and the top three are six because above 24,000 ft the sign is
// dropped and the temperature is understood to be negative.
const COL_AT = [4, 9, 17, 25, 33, 41, 49, 56, 63]
const COL_W  = [4, 7, 7, 7, 7, 7, 6, 6, 6]

// Which bulletin to ask for. The FAA issues three forecast windows; picking by
// how far out the flight is keeps the wind roughly valid for the time flown
// rather than for the moment the card was opened.
function fcstFor(departAtISO) {
  const hrs = departAtISO ? (new Date(departAtISO) - Date.now()) / 3600000 : 0
  if (hrs > 18) return '24'
  if (hrs > 9) return '12'
  return '06'
}

// "3127+05" -> { dirDeg: 310, kt: 27, tempC: 5 }
//
// Three encodings hide in this format and all of them matter:
//   9900      light and variable, not a north wind at zero knots
//   dd > 36   speed is 100 kt or more, with 50 added to the direction code
//   blank     the level is below the station, or the bulletin omitted it
export function parseToken(tok) {
  const t = (tok || '').trim()
  if (t.length < 4 || t.startsWith('/') || t.startsWith('-')) return null

  const code = parseInt(t.slice(0, 2), 10)
  let spd = parseInt(t.slice(2, 4), 10)
  if (!Number.isFinite(code) || !Number.isFinite(spd)) return null

  let dir = code * 10
  if (code > 36 && code <= 86) { dir = (code - 50) * 10; spd += 100 }
  const lightVariable = code === 99
  if (lightVariable) { dir = null; spd = 0 }

  // Temperature is signed above 24,000 ft the sign is implicit (always
  // negative), which the bulletin states in its own header.
  let tempC = null
  const rest = t.slice(4)
  if (rest) {
    const n = parseInt(rest.replace('+', ''), 10)
    if (Number.isFinite(n)) tempC = rest.startsWith('-') ? n : Math.abs(n) * (rest.startsWith('+') ? 1 : -1)
  }
  return { dirDeg: dir, kt: spd, tempC, lightVariable }
}

// Every station in the bulletin that we have a position for.
function parseBulletin(text) {
  const lines = text.split('\n')
  const head = lines.findIndex(l => l.startsWith('FT '))
  if (head === -1) return []

  const out = []
  for (const line of lines.slice(head + 1)) {
    const m = /^([A-Z0-9]{3})\s/.exec(line)
    if (!m) continue
    const pos = STATIONS[m[1]]
    if (!pos) continue                       // oceanic grid point, or a station NASR no longer lists

    const levels = []
    for (let i = 0; i < LEVELS_FT.length; i++) {
      const cell = parseToken(line.slice(COL_AT[i], COL_AT[i] + COL_W[i]))
      if (cell) levels.push({ altFt: LEVELS_FT[i], ...cell })
    }
    if (levels.length) out.push({ ident: m[1], lat: pos[0], lon: pos[1], levels })
  }
  return out
}

// Inverse-distance weighting over the three nearest stations.
//
// Wind is averaged as u/v components. Averaging directions across the 360/0
// boundary turns a north wind and a slightly-west-of-north wind into a
// southerly, which is the sort of error that looks plausible on a chart and
// is wrong by 180 degrees.
function interpolate(pt, stations, altFt) {
  const near = stations
    .map(s => ({ s, d: haversineNm(pt.lat, pt.lon, s.lat, s.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
  if (!near.length) return null

  let u = 0, v = 0, t = 0, wSum = 0, tWeight = 0, calm = 0
  for (const { s, d } of near) {
    const lv = levelAt(s.levels, altFt)
    if (!lv) continue
    const w = 1 / Math.max(1, d * d)
    if (lv.dirDeg == null) { calm += w } else {
      const rad = (lv.dirDeg * Math.PI) / 180
      u += -lv.kt * Math.sin(rad) * w
      v += -lv.kt * Math.cos(rad) * w
    }
    if (lv.tempC != null) { t += lv.tempC * w; tWeight += w }
    wSum += w
  }
  if (!wSum) return null

  // Light and variable contributes calm air, not a direction.
  const uu = u / wSum, vv = v / wSum
  const kt = Math.round(Math.sqrt(uu * uu + vv * vv))
  const dir = kt < 1 || calm / wSum > 0.5 ? null : (Math.round((Math.atan2(-uu, -vv) * 180) / Math.PI) + 360) % 360
  return {
    windKt: kt,
    windDirDeg: dir,
    tempC: tWeight ? Math.round((t / tWeight) * 10) / 10 : null,
  }
}

// The bulletin reports fixed levels; a cruise altitude between them is
// interpolated linearly, and one outside them is clamped rather than
// extrapolated: a wind invented above 39,000 ft helps nobody.
function levelAt(levels, altFt) {
  if (!levels.length) return null
  if (altFt <= levels[0].altFt) return levels[0]
  if (altFt >= levels[levels.length - 1].altFt) return levels[levels.length - 1]
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i], b = levels[i + 1]
    if (altFt >= a.altFt && altFt <= b.altFt) {
      const f = (altFt - a.altFt) / (b.altFt - a.altFt)
      const lerp = (x, y) => (x == null || y == null ? (x ?? y) : x + (y - x) * f)
      if (a.dirDeg == null || b.dirDeg == null) {
        return { altFt, dirDeg: a.dirDeg ?? b.dirDeg, kt: lerp(a.kt, b.kt), tempC: lerp(a.tempC, b.tempC) }
      }
      const ar = (a.dirDeg * Math.PI) / 180, br = (b.dirDeg * Math.PI) / 180
      const u = lerp(-a.kt * Math.sin(ar), -b.kt * Math.sin(br))
      const v = lerp(-a.kt * Math.cos(ar), -b.kt * Math.cos(br))
      return {
        altFt,
        kt: Math.sqrt(u * u + v * v),
        dirDeg: (Math.round((Math.atan2(-u, -v) * 180) / Math.PI) + 360) % 360,
        tempC: lerp(a.tempC, b.tempC),
      }
    }
  }
  return levels[levels.length - 1]
}

// Where 0 °C falls, from the reported temperatures. The bulletin omits the
// temperature at 3,000 ft, so a freezing level below the lowest reported
// temperature cannot be found this way and is returned as null rather than
// guessed at.
function freezingFrom(column) {
  const withT = column.filter(c => c.tempC != null).sort((a, b) => a.altFt - b.altFt)
  for (let i = 0; i < withT.length - 1; i++) {
    const a = withT[i], b = withT[i + 1]
    if ((a.tempC >= 0 && b.tempC <= 0) || (a.tempC <= 0 && b.tempC >= 0)) {
      if (a.tempC === b.tempC) return a.altFt
      const f = a.tempC / (a.tempC - b.tempC)
      return Math.round(a.altFt + f * (b.altFt - a.altFt))
    }
  }
  return null
}

// Position of an FB station, by its own ident or by an ICAO code (KABQ, CYYZ).
// Null when we hold no position for it, which the caller must handle rather
// than fall back to some other station's wind.
export function stationPos(id) {
  const s = (id || '').trim().toUpperCase()
  if (!s) return null
  const key = s.length === 4 && /^[KC]/.test(s) ? s.slice(1) : s
  const p = STATIONS[key]
  return p ? { lat: p[0], lon: p[1], ident: key } : null
}

// The wind at one point and one altitude. What the performance card needs.
//
// Interpolated from the three nearest stations, at the actual altitude rather
// than snapped to the nearest published level, and it reports which stations
// it used and how far away the closest one was. A wind borrowed from 300 NM
// away is not the wind at your departure, and the pilot is entitled to know
// which it is.
//
// Returns null rather than a substitute when nothing is close enough.
export async function fbWindAt(lat, lon, altFt, { departAtISO = null, timeoutMs = 8000, maxStationNm = 250 } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(altFt)) return null

  let stations
  try {
    const res = await fetch(`${AWC}?path=windtemp&region=us&fcst=${fcstFor(departAtISO)}`,
      { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    stations = parseBulletin(await res.text())
  } catch {
    return null
  }
  if (!stations.length) return null

  const near = stations
    .map(s => ({ s, d: haversineNm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.d - b.d)
  if (!near.length || near[0].d > maxStationNm) return null

  // Clamped, not extrapolated: the product starts at 3,000 ft and stops at
  // 39,000, and the label reports the altitude actually used.
  const usedFt = Math.min(39000, Math.max(3000, altFt))
  const got = interpolate({ lat, lon }, stations, usedFt)
  if (!got || got.windKt == null) return null

  return {
    dirDeg: got.windDirDeg,
    kt: got.windKt,
    tempC: got.tempC,
    levelFt: Math.round(usedFt),
    clamped: usedFt !== altFt,
    nearestIdent: near[0].s.ident,
    nearestNm: Math.round(near[0].d),
    usedStations: near.slice(0, 3).map(n => n.s.ident),
  }
}

// samples: [{lat, lon, distNm}]. The same points loadAtmosphere would use.
//
// Returns the loadAtmosphere shape with the sky layers empty, or
// { status:'unavailable' }.
export async function loadFbWinds(samples, { departAtISO = null, maxAltFt = 18000, lengthNm = 0, timeoutMs = 10000 } = {}) {
  if (!samples?.length) return { status: 'unavailable' }

  let stations
  try {
    const url = `${AWC}?path=windtemp&region=us&fcst=${fcstFor(departAtISO)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { status: 'unavailable' }
    stations = parseBulletin(await res.text())
  } catch {
    return { status: 'unavailable' }
  }
  if (stations.length < 2) return { status: 'unavailable' }

  // Off the edge of the product. The FB bulletin is US only, and the nearest
  // station being 400 NM away means the answer would be fiction.
  const nearest = Math.min(...samples.map(p =>
    Math.min(...stations.map(s => haversineNm(p.lat, p.lon, s.lat, s.lon)))))
  if (nearest > 250) return { status: 'unavailable' }

  const levels = LEVELS_FT.filter(a => a <= Math.max(maxAltFt + 3000, 12000))
  const columns = samples.map(pt =>
    levels.map(altFt => {
      const got = interpolate(pt, stations, altFt)
      return {
        hPa: null, altFt,
        tempC: got?.tempC ?? null,
        rhPct: null,          // not in the product
        cloudPct: null,       // not in the product
        windKt: got?.windKt ?? null,
        windDirDeg: got?.windDirDeg ?? null,
      }
    }).sort((a, b) => a.altFt - b.altFt))

  return {
    status: 'ok',
    samples: samples.map(s => ({ lat: s.lat, lon: s.lon, distNm: s.distNm })),
    lengthNm,
    levels,
    hourISO: new Date().toISOString(),
    model: 'FAA winds aloft (FB)',
    columns,
    surface: columns.map(col => ({
      freezingFt: freezingFrom(col),
      capeJkg: null, visibilityM: null,
      cloudLowPct: null, cloudMidPct: null, cloudHighPct: null,
    })),
    // Cloud and humidity are absent from this product, so the modelled icing
    // and the cloud shading must not be attempted from it. Flagged rather than
    // inferred from null-checks scattered downstream.
    source: 'fb',
    cloudMissing: true,
  }
}
