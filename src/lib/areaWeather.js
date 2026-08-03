// Surface weather for a field that publishes no aviation observation.
//
// A large share of small aerodromes have no METAR at all — CYLS (Barrie-Lake
// Simcoe) is the case that surfaced it. Until now the airport page said "No
// weather available" and stopped, which is accurate about the *aviation*
// network and misleading about the sky: Open-Meteo carries a surface analysis
// for every coordinate on earth, and this app already leans on it for terrain
// elevation and the winds-aloft column, so this reuses a dependency rather
// than taking on a new one. Free, keyless, worldwide, CORS-enabled.
//
// This is emphatically NOT a METAR, and the difference is the whole reason
// the labelling in AirportInfo.jsx is as loud as it is:
//
//   * it is a numerical model's read of a point, not an observation. Nobody
//     looked outside, and no instrument on that field produced it
//   * there is no flight category, and none is derived here. Cloud cover is
//     a total-column percentage, not a ceiling, so it cannot answer the
//     question VFR/MVFR/IFR answers. Presenting a computed category from
//     this data would be the single most dangerous thing this file could do
//   * it is never a substitute for a briefing
//
// It is fetched only where the aviation network is silent — see the noReport
// gate in weather.js. A field that reports gets its own observation and
// nothing else.

import { get, put } from './db'
import { isDailyLimit, DailyLimitError } from './openMeteoLimit'

const API = 'https://api.open-meteo.com/v1/forecast'

const CURRENT = [
  'temperature_2m', 'dew_point_2m', 'relative_humidity_2m', 'apparent_temperature',
  'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
]

// Stored in the existing `weather` store (keyPath 'icao') under a prefixed
// key rather than in a store of its own. Adding a store means a DB_VERSION
// bump, and db.js is emphatic — with a real incident logged in its header —
// about how those go wrong. This is a disposable fetch cache; it does not
// warrant the risk.
const keyFor = icao => `AREA:${icao}`

// Model analyses update every 15 minutes upstream. Half an hour keeps the
// page from re-fetching on every visit without ever showing something a
// pilot would call stale, and the observed time travels with the record so
// the card can state its own age rather than implying freshness.
const MAX_AGE_MS = 30 * 60 * 1000

// WMO 4677 present-weather codes, in the subset Open-Meteo actually emits.
// Deliberately plain English rather than METAR contractions: this data did
// not come from a METAR, and dressing it up as `-RA BR` would invite exactly
// the confusion the whole feature is trying to avoid.
const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Light freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light rain showers', 81: 'Rain showers', 82: 'Heavy rain showers',
  85: 'Light snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
}

// Open-Meteo publishes visibility hourly, not in the `current` block, so it
// has to be picked out of the hourly series by matching the hour the current
// analysis is valid for. Returns metres, or null.
function visibilityAt(hourly, currentTime) {
  const times = hourly?.time
  const vis = hourly?.visibility
  if (!Array.isArray(times) || !Array.isArray(vis) || !currentTime) return null
  const hour = currentTime.slice(0, 13) // 'YYYY-MM-DDTHH'
  const i = times.findIndex(t => typeof t === 'string' && t.slice(0, 13) === hour)
  return i >= 0 && Number.isFinite(vis[i]) ? vis[i] : null
}

// Returns a normalised record, or null if the model has nothing for this
// point. Never throws for an ordinary network failure — the airport page
// treats missing area weather as "one less thing to show", not an error.
export async function loadAreaWeather(icao, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const key = keyFor(icao)

  const cached = await get('weather', key).catch(() => null)
  if (cached && Date.now() - (cached.fetchedAt ?? 0) < MAX_AGE_MS) return cached

  const qs = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: CURRENT.join(','),
    hourly: 'visibility',
    wind_speed_unit: 'kn',       // so the app's own kt→mph/km-h conversion applies unchanged
    timezone: 'UTC',
    forecast_days: '1',
  })

  let data
  try {
    const res = await fetch(`${API}?${qs}`, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) throw (await isDailyLimit(res)) ? new DailyLimitError() : new Error(`open-meteo ${res.status}`)
    data = await res.json()
  } catch {
    // A stale record still describes the area better than nothing, and this
    // is exactly the situation — no signal — where a pilot most wants
    // whatever the phone already has.
    return cached ?? null
  }

  const c = data?.current
  if (!c || !Number.isFinite(c.temperature_2m)) return cached ?? null

  const record = {
    icao: key,
    lat, lon,
    // The model's valid time, parsed as UTC — the request asked for UTC, and
    // Open-Meteo returns zone-less ISO strings.
    observedAt: c.time ? new Date(c.time + 'Z').getTime() : Date.now(),
    tempC: c.temperature_2m,
    dewpC: Number.isFinite(c.dew_point_2m) ? c.dew_point_2m : null,
    apparentC: Number.isFinite(c.apparent_temperature) ? c.apparent_temperature : null,
    humidityPct: Number.isFinite(c.relative_humidity_2m) ? c.relative_humidity_2m : null,
    windDirDeg: Number.isFinite(c.wind_direction_10m) ? c.wind_direction_10m : null,
    windKt: Number.isFinite(c.wind_speed_10m) ? c.wind_speed_10m : null,
    gustKt: Number.isFinite(c.wind_gusts_10m) ? c.wind_gusts_10m : null,
    cloudPct: Number.isFinite(c.cloud_cover) ? c.cloud_cover : null,
    pressureHpa: Number.isFinite(c.pressure_msl) ? c.pressure_msl : null,
    precipMm: Number.isFinite(c.precipitation) ? c.precipitation : null,
    visM: visibilityAt(data.hourly, c.time),
    condition: WMO[c.weather_code] ?? null,
    elevM: Number.isFinite(data.elevation) ? data.elevation : null,
    fetchedAt: Date.now(),
  }

  put('weather', record).catch(() => {})
  return record
}

// ── Formatters ───────────────────────────────────────────────
//
// Same `units` profile and the same output shapes as weather.js's parse*
// family, so the two kinds of card read identically even though the numbers
// reach them by very different routes.

const tempFromC = (c, unit) => (unit === '°F' ? Math.round(c * 9 / 5 + 32) : Math.round(c))

export function areaTemp(a, units = {}) {
  if (a?.tempC == null) return '—'
  const unit = units.unitTemperature ?? '°C'
  return `${tempFromC(a.tempC, unit)}${unit}`
}

export function areaDewp(a, units = {}) {
  if (a?.dewpC == null) return '—'
  const unit = units.unitTemperature ?? '°C'
  return `${tempFromC(a.dewpC, unit)}${unit}`
}

export function areaWindParts(a, units = {}) {
  if (a?.windKt == null) return { dir: null, speed: '—' }
  const unit = units.unitSpeed ?? 'KT'
  const label = unit === 'KM/H' ? 'km/h' : unit === 'MPH' ? 'mph' : 'kt'
  const conv = kt => (unit === 'MPH' ? Math.round(kt * 1.15078)
                    : unit === 'KM/H' ? Math.round(kt * 1.852)
                    : Math.round(kt))
  const spd = conv(a.windKt)
  if (spd === 0) return { dir: null, speed: 'Calm' }
  // Gusts are only worth showing when they are meaningfully above the mean;
  // a model's 1-knot spread is noise, not a gust.
  const gst = a.gustKt != null && a.gustKt - a.windKt >= 3 ? conv(a.gustKt) : null
  const speed = `${spd}${gst ? `G${gst}` : ''} ${label}`
  const dir = a.windDirDeg == null ? null : `${String(Math.round(a.windDirDeg)).padStart(3, '0')}°`
  return { dir, speed }
}

export function areaWind(a, units = {}) {
  const { dir, speed } = areaWindParts(a, units)
  return dir ? `${dir} ${speed}` : speed
}

export function areaVis(a, units = {}) {
  if (a?.visM == null) return '—'
  const unit = units.unitDistance ?? 'SM'
  const sm = a.visM / 1609.34
  // The model tops out around 24 km; anything past 10 SM is "unlimited" as
  // far as a VFR decision goes, and reporting 15.0 SM implies a precision
  // this source does not have.
  if (sm >= 10) return unit === 'KM' ? '16+ KM' : unit === 'NM' ? '8.6+ NM' : '10+ SM'
  if (unit === 'KM') return `${(a.visM / 1000).toFixed(1)} KM`
  if (unit === 'NM') return `${(a.visM / 1852).toFixed(1)} NM`
  return `${sm.toFixed(1)} SM`
}

export function areaPressure(a, units = {}) {
  if (a?.pressureHpa == null) return '—'
  const unit = units.unitPressure ?? 'inHg'
  if (unit === 'hPa') return `${Math.round(a.pressureHpa)} hPa`
  return `${(a.pressureHpa / 33.8639).toFixed(2)} inHg`
}

// Total cloud cover as a bare percentage, on purpose. The okta contractions
// a pilot reads on a METAR (FEW/SCT/BKN/OVC) describe *layers at a height*,
// and this number is a single column total with no height attached — writing
// "BKN" here would read as a ceiling the model never reported.
export function areaCloud(a) {
  return a?.cloudPct == null ? '—' : `${Math.round(a.cloudPct)}%`
}

export function areaCondition(a) {
  return a?.condition ?? null
}
