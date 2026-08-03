import { get, put } from './db'

function awcUrl(endpoint, params = {}) {
  const qs = new URLSearchParams({ path: endpoint, ...params }).toString()
  return `/api/awc?${qs}`
}

async function awcFetch(endpoint, params) {
  const res = await fetch(awcUrl(endpoint, params), { signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchMetar(icao) {
  const id = icao.toUpperCase()
  const data = await awcFetch('metar', { ids: id, format: 'json', hours: '3' })
  if (!Array.isArray(data) || !data.length) throw new Error('No METAR data for ' + id)
  return data[0]
}

export async function fetchTaf(icao) {
  const id = icao.toUpperCase()
  try {
    const data = await awcFetch('taf', { ids: id, format: 'json' })
    if (!Array.isArray(data) || !data.length) return null
    return data[0]
  } catch {
    return null
  }
}

// The weather at a field that does not report it.
//
// Most of the aerodromes along a route are small fields with no observation of
// their own: 166 of them on a Miami–New York routing, and only a fraction
// publish a METAR. The nearest station is genuinely useful for the decision
// this feature exists to support ("could I put it down there?"), but only
// while it is close enough to describe the same weather, and only if it is
// labelled as somewhere else. Beyond the radius the honest answer is nothing.
//
// Returns { metar, station, distNm } or null. One request, and only when the
// field itself has no report.
export async function nearestMetar(lat, lon, { withinNm = 20 } = {}) {
  // A degree of latitude is 60 NM; longitude shrinks with the cosine. The box
  // is a prefilter: the haversine below is what decides.
  const dLat = withinNm / 60
  const dLon = withinNm / (60 * Math.max(0.05, Math.cos(lat * Math.PI / 180)))
  try {
    const data = await awcFetch('metar', {
      bbox: `${(lat - dLat).toFixed(3)},${(lon - dLon).toFixed(3)},${(lat + dLat).toFixed(3)},${(lon + dLon).toFixed(3)}`,
      format: 'json',
    })
    if (!Array.isArray(data) || !data.length) return null
    let best = null
    for (const m of data) {
      if (!Number.isFinite(m?.lat) || !Number.isFinite(m?.lon) || !m.rawOb) continue
      const d = haversineNm(lat, lon, m.lat, m.lon)
      if (d <= withinNm && (!best || d < best.distNm)) best = { metar: m, station: m.icaoId, distNm: d }
    }
    return best
  } catch {
    return null
  }
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export async function loadWeather(icao) {
  const id = icao.toUpperCase()
  try {
    const [metar, taf] = await Promise.all([fetchMetar(id), fetchTaf(id)])
    const result = { icao: id, metar, taf, fetchedAt: Date.now(), error: null }
    await put('weather', result)
    return result
  } catch (err) {
    const cached = await get('weather', id)
    if (cached) return { ...cached, error: err.message }
    throw err
  }
}

// ── Parsers ──────────────────────────────────────────────────

export const FLTCAT = {
  VFR:  { label: 'VFR',  color: '#34C759', bg: 'rgba(52,199,89,0.15)' },
  MVFR: { label: 'MVFR', color: '#007AFF', bg: 'rgba(0,122,255,0.15)' },
  IFR:  { label: 'IFR',  color: '#FF3B30', bg: 'rgba(255,59,48,0.15)' },
  LIFR: { label: 'LIFR', color: '#AF52DE', bg: 'rgba(175,82,222,0.15)' },
}

export function parseFltCat(metar) {
  return FLTCAT[metar?.fltCat] ?? FLTCAT.VFR
}

// Ceiling/visibility -> flight category. Shared by TAF-period classification
// (WeatherDetailOverlay's deriveTafCat) and the raw-TAF-text colorizer below,
// so both always agree with the chip's own color grading.
export function catFromCeilingVis(ceilFt, visSm) {
  if ((ceilFt != null && ceilFt < 500) || visSm < 1)  return FLTCAT.LIFR
  if ((ceilFt != null && ceilFt < 1000) || visSm < 3) return FLTCAT.IFR
  if ((ceilFt != null && ceilFt < 3000) || visSm < 5) return FLTCAT.MVFR
  return FLTCAT.VFR
}

// ── Raw TAF text colorizing ───────────────────────────────────
// Splits a raw TAF string into its forecast groups (issuance header, then
// each FM/BECMG/TEMPO/PROB change group) and classifies each group's flight
// category from its own visibility/ceiling tokens, same color grading as
// the flight-category chip. A group with no visibility/cloud tokens of its
// own (e.g. a wind-only BECMG) carries forward the previous group's color,
// since it doesn't change the flying conditions.
const TAF_GROUP_RE = /(?=\bFM\d{6}\b|\bBECMG\b|\bTEMPO\b|\bPROB\d{2}\b)/

function tafVisSm(text) {
  if (/\bP6SM\b/.test(text)) return 10
  const frac = text.match(/\bM?(\d+)\/(\d+)SM\b/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  const whole = text.match(/\b(\d{1,2})SM\b/)
  if (whole) return Number(whole[1])
  return null
}

function tafCeilingFt(text) {
  const matches = [...text.matchAll(/\b(?:BKN|OVC|VV)(\d{3})\b/g)]
  if (!matches.length) return null
  return Math.min(...matches.map(m => Number(m[1]) * 100))
}

export function colorizeTaf(rawText) {
  if (!rawText) return []
  const normalized = rawText.replace(/\s*\n\s*/g, ' ').trim()
  const groups = normalized.split(TAF_GROUP_RE).map(g => g.trim()).filter(Boolean)
  let lastCat = FLTCAT.VFR
  return groups.map(text => {
    const vis = tafVisSm(text)
    const ceil = tafCeilingFt(text)
    const cat = (vis == null && ceil == null) ? lastCat : catFromCeilingVis(ceil, vis ?? 10)
    lastCat = cat
    return { text, color: cat.color }
  })
}

// ── Unit conversion ──────────────────────────────────────────
// `units` mirrors the shape of the pilot profile (unitSpeed, unitVisibility,
// unitAltitude, unitTemperature, unitPressure) so callers can just pass the
// profile straight through. Falls back to the values the app used before
// unit preferences existed.

function speedFromKt(kt, unit) {
  if (unit === 'MPH') return Math.round(kt * 1.15078)
  if (unit === 'KM/H') return Math.round(kt * 1.852)
  return Math.round(kt)
}

// Direction and speed as separate strings — for layouts (like the airport
// diagram card) that stack them on their own lines instead of one run of
// text. parseWind() below is just this joined back into the original
// single-string format every other call site already expects.
export function parseWindParts(metar, units = {}) {
  if (!metar) return { dir: null, speed: '—' }
  const { wdir, wspd, wgst } = metar
  const unit = units.unitSpeed ?? 'KT'
  const unitLabel = unit === 'KM/H' ? 'km/h' : unit === 'MPH' ? 'mph' : 'kt'
  const spd = speedFromKt(wspd, unit)
  const gst = wgst ? speedFromKt(wgst, unit) : null
  if (!wspd || wspd === 0) return { dir: null, speed: 'Calm' }
  const speed = `${spd}${gst ? `G${gst}` : ''} ${unitLabel}`
  // wdir can be a number or the string "VRB"
  if (!wdir || wdir === 'VRB') return { dir: 'VRB', speed }
  return { dir: `${String(Math.round(Number(wdir))).padStart(3, '0')}°`, speed }
}

export function parseWind(metar, units = {}) {
  if (!metar) return '—'
  const { dir, speed } = parseWindParts(metar, units)
  return dir ? `${dir} ${speed}` : speed
}

export function parseVisib(metar, units = {}) {
  const v = metar?.visib
  if (v == null) return '—'
  const unit = units.unitDistance ?? 'SM'
  const n = parseFloat(v)
  if (unit === 'SM') return (v === '10+' || n >= 10) ? '10+ SM' : `${v} SM`
  const km = n * 1.60934
  const nm = n * 0.868976
  if (unit === 'KM') return n >= 10 ? '16+ KM' : `${km.toFixed(1)} KM`
  return n >= 10 ? '8.6+ NM' : `${nm.toFixed(1)} NM`
}

export function parseCeiling(metar, units = {}) {
  const unit = units.unitAltitude ?? 'FT'
  const fmt = ft => unit === 'M' ? `${Math.round(ft * 0.3048).toLocaleString()} m` : `${ft.toLocaleString()} ft`
  // CAVOK = ceiling and visibility OK (>10km, no cloud below 5000ft)
  if (metar?.cover === 'CAVOK') return 'CAVOK'
  const clouds = metar?.clouds
  if (!clouds?.length) return 'CLR'
  const ceiling = clouds.find(c => c.cover === 'BKN' || c.cover === 'OVC')
  if (!ceiling) {
    const top = clouds[clouds.length - 1]
    return top ? `${top.cover} ${top.base != null ? fmt(top.base) : ''}` : 'CLR'
  }
  return `${ceiling.cover} ${ceiling.base != null ? fmt(ceiling.base) : ''}`
}

// Every reported cloud layer (not just the ceiling-forming one), lowest
// first: e.g. [{ cover: 'SCT', label: '6,000 ft' }, { cover: 'SCT', label: '14,000 ft' }].
// CLR/SKC/CAVOK reports have no layers at all (returns []).
export function parseCloudLayers(metar, units = {}) {
  const unit = units.unitAltitude ?? 'FT'
  const fmt = ft => unit === 'M' ? `${Math.round(ft * 0.3048).toLocaleString()} m` : `${ft.toLocaleString()} ft`
  if (metar?.cover === 'CAVOK') return []
  const clouds = metar?.clouds ?? []
  return clouds
    .filter(c => c.base != null && !['CLR', 'SKC', 'NSC', 'NCD'].includes(c.cover))
    .sort((a, b) => a.base - b.base)
    .map(c => ({ cover: c.cover, label: fmt(c.base) }))
}

function tempFromC(c, unit) {
  return unit === '°F' ? Math.round(c * 9 / 5 + 32) : Math.round(c)
}

export function parseTemp(metar, units = {}) {
  if (metar?.temp == null) return '—'
  const unit = units.unitTemperature ?? '°C'
  return `${tempFromC(metar.temp, unit)}${unit}`
}

export function parseDewp(metar, units = {}) {
  if (metar?.dewp == null) return '—'
  const unit = units.unitTemperature ?? '°C'
  return `${tempFromC(metar.dewp, unit)}${unit}`
}

export function parseAltim(metar, units = {}) {
  if (metar?.altim == null) return '—'
  const unit = units.unitPressure ?? 'inHg'
  // API returns mb (hPa)
  if (unit === 'hPa') return `${Math.round(metar.altim)} hPa`
  const inhg = (metar.altim / 33.8639).toFixed(2)
  return `${inhg} inHg`
}

export function parseAirportName(metar) {
  return metar?.name ?? null
}

export function parseWx(metar) {
  return metar?.wxString ?? metar?.presentWx ?? null
}

// ForeFlight-style compact relative age — "9m ago" under an hour, "3h 24m
// ago" (not just "3h ago") once it isn't, so a report doesn't visibly jump
// by up to 59 minutes at a time once it crosses the hour mark.
function formatAge(thenMs) {
  if (thenMs == null || Number.isNaN(thenMs)) return null
  const mins = Math.max(0, Math.round((Date.now() - thenMs) / 60000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h ago` : `${h}h ${m}m ago`
}

export function parseObsAge(metar) {
  if (!metar?.obsTime) return null
  return formatAge(metar.obsTime * 1000)
}

// TAF's own issue time (when it was ISSUED, not when it becomes valid from —
// validTimeFrom is the forecast period's start, a different thing) — an ISO
// string from AWC, unlike METAR's obsTime (Unix seconds), hence the
// separate Date.parse here rather than reusing parseObsAge's math directly.
export function parseTafAge(taf) {
  if (!taf?.issueTime) return null
  return formatAge(Date.parse(taf.issueTime))
}

export function parseFetchAge(fetchedAt) {
  if (!fetchedAt) return null
  return formatAge(fetchedAt)
}
