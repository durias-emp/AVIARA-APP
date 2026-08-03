// Multi-level FAA winds-aloft (windtemp) fetch + parse, plus interpolation
// between the 9 fixed report levels. Refactored out of Performance.jsx's
// CruiseItem, which used to fetch this same text and then discard 8 of the
// 9 parsed levels — this fetches once and keeps every level, so comparing
// several candidate cruise altitudes (the altitude optimizer) never needs
// more than one network round-trip.
import { awcUrl, proxyFetch } from '../pages/Checklists/shared/awc'

export const WIND_LEVELS_FT = [3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000]

// AWC windtemp returns plain text — decodes the FAA winds aloft format, e.g.
// "MIA 1105 0305+16 3505+11 9900+06 3607-07 3506-18 301633 291844 332153"
// Tokens: "DDSS", "DDSS+TT", "DDSS-TT", "9900" (light & var), "////+TT", "------"
function parseToken(token) {
  if (!token || token.trim() === '') return null
  token = token.trim()
  if (token.startsWith('/') || token.startsWith('-') || token.length < 4) return null
  const dirCode = parseInt(token.substring(0, 2))
  let spd = parseInt(token.substring(2, 4))
  let dir = dirCode * 10
  // Speed ≥100kt: dir encoded as dir/10 + 50
  if (dirCode > 36 && dirCode <= 86) { dir = (dirCode - 50) * 10; spd += 100 }
  if (dirCode === 99) { dir = 0; spd = 0 } // light & variable
  if (isNaN(dir) || isNaN(spd)) return null
  const tempMatch = token.match(/([+-]\d+)$/)
  const temp = tempMatch ? parseInt(tempMatch[1]) : null
  return { dir, spd, temp }
}

// Parses the whole windtemp text into { station, levels: {[ft]: {dir,spd,temp}|null} }
// for the line matching depIcao's 3-letter station id (falls back to the
// first valid line), across ALL reported levels rather than just one.
function parseText(text, depIcao) {
  const lines = text.split('\n')
  const ftLine = lines.find(l => l.match(/^\s*FT\s+3000/))
  let colStarts = null
  if (ftLine) {
    const matches = [...ftLine.matchAll(/\b(\d{4,5})\b/g)]
    colStarts = matches.map(m => ({ lvl: parseInt(m[1]), idx: m.index }))
  }

  const stationId = depIcao.replace(/^[KC]/, '').toUpperCase()
  let bestLine = null, fallbackLine = null
  for (const line of lines) {
    const m = line.match(/^([A-Z]{3})\s+(.+)/)
    if (!m) continue
    if (m[1] === stationId) { bestLine = line; break }
    if (!fallbackLine) fallbackLine = line
  }
  const dataLine = bestLine || fallbackLine
  if (!dataLine) return null
  const station = dataLine.trim().split(/\s+/)[0]

  const levels = {}
  if (colStarts) {
    for (const { lvl, idx } of colStarts) {
      const token = dataLine.substring(idx, idx + 9).trim().split(/\s/)[0]
      levels[lvl] = parseToken(token)
    }
  } else {
    // No FT header to anchor column positions — fall back to strict
    // positional mapping (parts[1]=3000, parts[2]=6000, ...). Rarer path;
    // a level simply stays null if its slot doesn't parse, never guessed.
    const parts = dataLine.trim().split(/\s+/)
    WIND_LEVELS_FT.forEach((lvl, i) => { levels[lvl] = parseToken(parts[i + 1]) })
  }
  for (const lvl of WIND_LEVELS_FT) if (!(lvl in levels)) levels[lvl] = null
  return { station, levels }
}

// Fetches the FAA windtemp text once (same 06/12/24 fcst fallback chain,
// then a CORS-proxy fallback, as the original single-level version) and
// returns every reported level instead of just the nearest one.
export async function fetchWindsAloft(depIcao, { region = 'us' } = {}) {
  let text = null
  for (const fcst of ['06', '12', '24']) {
    const url = awcUrl('windtemp', { region, fcst })
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (res.ok) { text = await res.text(); break }
    } catch { /* ignore */ }
    try { text = await proxyFetch(url, 8000); break } catch { /* ignore */ }
  }
  if (!text || text.length < 50) return { status: 'unavailable' }
  const parsed = parseText(text, depIcao)
  if (!parsed) return { status: 'unavailable' }
  return { status: 'ok', station: parsed.station, levels: parsed.levels }
}

// Interpolates wind at an arbitrary altFt between the two nearest reported
// levels (skipping null gaps). Circular-aware on direction (shortest
// angular path), linear on speed/temp. Returns null if altFt falls outside
// the lowest/highest *reported* level — never extrapolates, matching
// interpolateChart's convention in lib/aircraftPerf.js.
export function windAt(levels, altFt) {
  const reported = WIND_LEVELS_FT
    .map(lvl => ({ lvl, data: levels[lvl] }))
    .filter(l => l.data != null)
  if (!reported.length || altFt == null || isNaN(altFt)) return null
  if (altFt < reported[0].lvl || altFt > reported[reported.length - 1].lvl) return null

  let lo = reported[0], hi = reported[reported.length - 1]
  for (let i = 0; i < reported.length - 1; i++) {
    if (altFt >= reported[i].lvl && altFt <= reported[i + 1].lvl) {
      lo = reported[i]; hi = reported[i + 1]; break
    }
  }
  if (lo.lvl === hi.lvl) return { ...lo.data, level: lo.lvl }
  const frac = (altFt - lo.lvl) / (hi.lvl - lo.lvl)

  // Circular interpolation on direction (shortest angular path)
  const diff = ((hi.data.dir - lo.data.dir + 540) % 360) - 180
  const dir = ((lo.data.dir + diff * frac) + 360) % 360
  const spd = lo.data.spd + (hi.data.spd - lo.data.spd) * frac
  const temp = (lo.data.temp != null && hi.data.temp != null)
    ? lo.data.temp + (hi.data.temp - lo.data.temp) * frac
    : (lo.data.temp ?? hi.data.temp ?? null)

  return { dir: Math.round(dir), spd: Math.round(spd), temp: temp != null ? Math.round(temp) : null, level: altFt }
}

// Nearest-reported-level lookup — matches CruiseItem's original behavior of
// always showing an actually-reported level's data verbatim (not a blended
// interpolation) for its single-altitude display.
export function nearestWind(levels, altFt) {
  const reported = WIND_LEVELS_FT
    .map(lvl => ({ lvl, data: levels[lvl] }))
    .filter(l => l.data != null)
  if (!reported.length) return null
  const nearest = reported.reduce((a, b) => Math.abs(b.lvl - altFt) < Math.abs(a.lvl - altFt) ? b : a)
  return { ...nearest.data, level: nearest.lvl }
}
