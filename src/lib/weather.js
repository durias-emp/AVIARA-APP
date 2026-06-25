import { get, put } from './db'

const AWC = 'https://aviationweather.gov/api/data'
const PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?url=',
]
const TIMEOUT = 15000

async function tryFetch(url) {
  for (const proxy of PROXIES) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
    try {
      const res = await fetch(proxy + encodeURIComponent(url), { signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      clearTimeout(timer)
      return data
    } catch {
      clearTimeout(timer)
      // try next proxy
    }
  }
  throw new Error('All proxies failed')
}

export async function fetchMetar(icao) {
  const id = icao.toUpperCase()
  const data = await tryFetch(`${AWC}/metar?ids=${id}&format=json&hours=3`)
  if (!Array.isArray(data) || !data.length) throw new Error('No METAR data for ' + id)
  return data[0]
}

export async function fetchTaf(icao) {
  const id = icao.toUpperCase()
  try {
    const data = await tryFetch(`${AWC}/taf?ids=${id}&format=json`)
    if (!Array.isArray(data) || !data.length) return null
    return data[0]
  } catch {
    return null // TAF is optional — don't fail the whole load
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

export function parseWind(metar) {
  if (!metar) return '—'
  const { wdir, wspd, wgst } = metar
  if (!wspd || wspd === 0) return 'Calm'
  // wdir can be a number or the string "VRB"
  if (!wdir || wdir === 'VRB') return `VRB ${wspd}${wgst ? `G${wgst}` : ''} kt`
  const dir = bearingToCompass(Number(wdir))
  return `${dir} ${wspd}${wgst ? `G${wgst}` : ''} kt`
}

export function parseVisib(metar) {
  const v = metar?.visib
  if (v == null) return '—'
  const n = parseFloat(v)
  if (v === '10+' || n >= 10) return '10+ SM'
  return `${v} SM`
}

export function parseCeiling(metar) {
  // CAVOK = ceiling and visibility OK (>10km, no cloud below 5000ft)
  if (metar?.cover === 'CAVOK') return 'CAVOK'
  const clouds = metar?.clouds
  if (!clouds?.length) return 'CLR'
  const ceiling = clouds.find(c => c.cover === 'BKN' || c.cover === 'OVC')
  if (!ceiling) {
    const top = clouds[clouds.length - 1]
    return top ? `${top.cover} ${top.base?.toLocaleString() ?? ''}` : 'CLR'
  }
  return `${ceiling.cover} ${ceiling.base?.toLocaleString() ?? ''} ft`
}

export function parseTemp(metar) {
  if (metar?.temp == null) return '—'
  return `${Math.round(metar.temp)}°C`
}

export function parseDewp(metar) {
  if (metar?.dewp == null) return '—'
  return `${Math.round(metar.dewp)}°C`
}

export function parseAltim(metar) {
  if (metar?.altim == null) return '—'
  // API returns mb — convert to inHg
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

function bearingToCompass(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}
