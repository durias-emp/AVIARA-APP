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

export function parseWind(metar, units = {}) {
  if (!metar) return '—'
  const { wdir, wspd, wgst } = metar
  const unit = units.unitSpeed ?? 'KT'
  const unitLabel = unit === 'KM/H' ? 'km/h' : unit === 'MPH' ? 'mph' : 'kt'
  const spd = speedFromKt(wspd, unit)
  const gst = wgst ? speedFromKt(wgst, unit) : null
  if (!wspd || wspd === 0) return 'Calm'
  // wdir can be a number or the string "VRB"
  if (!wdir || wdir === 'VRB') return `VRB ${spd}${gst ? `G${gst}` : ''} ${unitLabel}`
  const dir = String(Math.round(Number(wdir))).padStart(3, '0')
  return `${dir}° ${spd}${gst ? `G${gst}` : ''} ${unitLabel}`
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

export function parseObsAge(metar) {
  if (!metar?.obsTime) return null
  const mins = Math.round((Date.now() / 1000 - metar.obsTime) / 60)
  if (mins < 60) return `${mins} min ago`
  return `${Math.round(mins / 60)}h ago`
}

export function parseFetchAge(fetchedAt) {
  if (!fetchedAt) return null
  const mins = Math.round((Date.now() - fetchedAt) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  return `${Math.round(mins / 60)}h ago`
}
