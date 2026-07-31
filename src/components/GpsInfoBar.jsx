import { useEffect, useRef, useState } from 'react'
import { useLiveLocation } from '../hooks/useLiveLocation'
import { useInfoBarFields, MAX_FIELDS } from '../hooks/useInfoBarFields'
import { getAirports } from '../lib/aerodromes'
import { findNearestNavaid } from '../lib/waypoints'
import { getGroundElevationFt } from '../lib/terrain'
import { bearingDeg, haversineNm, crossTrackNm, fmtAvCoord, horizonNm } from '../lib/geo'

// Field catalog — grouped and ordered to match the picker sheet. `need`
// marks what has to exist for a value to compute: 'live' (GPS alone),
// 'route' (an active flight plan from FlightPlanBar), or 'none' (no data
// source wired up yet — shown greyed out with an honest "No data" rather
// than a made-up number, since several of these need real aircraft
// instruments — a static port, an accelerometer — a phone doesn't have).
export const FIELD_CATALOG = [
  { cat: 'Standard', key: 'gs',           label: 'Groundspeed',   sub: 'Speed relative to the earth',                 need: 'live' },
  { cat: 'Standard', key: 'gpsAlt',       label: 'GPS Altitude',  sub: 'Geometric altitude above sea level',          need: 'live' },
  { cat: 'Standard', key: 'agl',          label: 'Height AGL',    sub: 'Geometric altitude above terrain',            need: 'live' },
  { cat: 'Standard', key: 'mef',          label: 'Height MEF',    sub: 'Dynamic Maximum Elevation Figure',            need: 'none' },
  { cat: 'Standard', key: 'mora',         label: 'Grid MORA',     sub: 'Minimum off route altitude in a 1x1 degree grid', need: 'none' },
  { cat: 'Standard', key: 'pressAlt',     label: 'Pressure Altitude', sub: 'Pressure altitude',                       need: 'none' },
  { cat: 'Standard', key: 'cabinPress',   label: 'Cabin Pressure', sub: 'Pressure altitude in cabin, uncorrected',    need: 'none' },
  { cat: 'Standard', key: 'baroAlt',      label: 'Baro Altitude', sub: 'Baro-corrected Pressure Altitude',            need: 'none' },
  { cat: 'Standard', key: 'gMeter',       label: 'G-Meter',       sub: "Vertical acceleration, in g's",               need: 'none' },
  { cat: 'Standard', key: 'track',        label: 'Track',         sub: 'GPS track along ground',                      need: 'live' },
  { cat: 'Standard', key: 'accuracy',     label: 'Accuracy',      sub: 'GPS fix accuracy, in meters',                 need: 'live' },
  { cat: 'Standard', key: 'rot',          label: 'Rate of Turn',  sub: 'Rate of turn in degrees per second',          need: 'live' },
  { cat: 'Standard', key: 'vs',           label: 'Vertical Speed', sub: 'Shows vertical speed in fpm',                need: 'live' },
  { cat: 'Standard', key: 'climbGrad',    label: 'Climb Gradient', sub: 'Shows climb gradient in ft/nm',              need: 'live' },
  { cat: 'Standard', key: 'nearestBaro',  label: 'Nearest Baro',  sub: 'Nearest Altimeter Baro Setting',              need: 'live' },

  { cat: 'Next Waypoint', key: 'eteNext',   label: 'ETE Next',    sub: 'Time to next waypoint',                       need: 'route' },
  { cat: 'Next Waypoint', key: 'etaNext',   label: 'ETA Next',    sub: 'Time of arrival at next waypoint',            need: 'route' },
  { cat: 'Next Waypoint', key: 'distNext',  label: 'Distance Next', sub: 'Distance to next waypoint',                 need: 'route' },
  { cat: 'Next Waypoint', key: 'brgNext',   label: 'Bearing Next', sub: 'Bearing to next waypoint',                   need: 'route' },
  { cat: 'Next Waypoint', key: 'courseNext', label: 'Course Next', sub: 'Desired course to next waypoint',            need: 'route' },
  { cat: 'Next Waypoint', key: 'xtk',       label: 'Cross Track Error', sub: 'Side distance from current leg, in nm', need: 'route' },
  { cat: 'Next Waypoint', key: 'nearestApt', label: 'Nearest Airport', sub: 'Relative position from nearest airport', need: 'live' },
  { cat: 'Next Waypoint', key: 'nearestNavaid', label: 'Nearest Navaid', sub: 'Navaid Name, Frequency, Radial/Distance', need: 'live' },

  { cat: 'Destination', key: 'eteDest',  label: 'ETE Dest',   sub: 'Time to destination',                             need: 'route' },
  { cat: 'Destination', key: 'etaDest',  label: 'ETA Dest',   sub: 'Time of arrival at destination',                  need: 'route' },
  { cat: 'Destination', key: 'distDest', label: 'Distance Dest', sub: 'Distance to destination',                      need: 'route' },
  { cat: 'Destination', key: 'brgDest',  label: 'Bearing Dest', sub: 'Bearing to destination',                        need: 'route' },
  { cat: 'Destination', key: 'descDest', label: 'Descent to Dest', sub: "Req'd fpm to reach dest elevation at arrival", need: 'route' },

  { cat: 'Other', key: 'currCoords', label: 'Curr Coords', sub: "Coordinate of aircraft's current position",         need: 'live' },
  { cat: 'Other', key: 'zulu',       label: 'Zulu Time',   sub: 'Current zulu time',                                 need: 'live' },
  { cat: 'Other', key: 'horizon',    label: 'Horizon Distance', sub: 'Distance to horizon, ignoring terrain',        need: 'live' },
  { cat: 'Other', key: 'blank',      label: 'Blank',       sub: 'Empty space',                                       need: 'always' },
  { cat: 'Other', key: 'flightTime', label: 'Flight Time', sub: 'Current Flight Time',                               need: 'live' },
]
const CATALOG_BY_KEY = Object.fromEntries(FIELD_CATALOG.map(f => [f.key, f]))
const CATEGORIES = ['Standard', 'Next Waypoint', 'Destination', 'Other']

const fmt = (v, digits = 0) => v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits)
const fmtDur = (mins) => {
  if (mins == null || !Number.isFinite(mins) || mins < 0) return '—'
  const h = Math.floor(mins / 60), m = Math.round(mins % 60)
  return `${h}:${String(m).padStart(2, '0')}`
}
const fmtClock = (d) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

function relBearing(fromLat, fromLon, toLat, toLon) {
  const brg = bearingDeg(fromLat, fromLon, toLat, toLon)
  const dist = haversineNm(fromLat, fromLon, toLat, toLon)
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const dir = dirs[Math.round(brg / 45) % 8]
  return `${Math.round(dist)}NM ${dir}`
}

export default function GpsInfoBar({ route }) {
  const { coords, derived, status } = useLiveLocation()
  const { fields, toggleField } = useInfoBarFields()
  const [picking, setPicking] = useState(false)
  const [groundElevFt, setGroundElevFt] = useState(null)
  const [nearestBaro, setNearestBaro] = useState(null)   // { icao, inHg }
  const [nearestApt, setNearestApt] = useState(null)     // { ident, lat, lon }
  const [nearestNavaid, setNearestNavaid] = useState(null)
  const sessionStart = useRef(Date.now())
  const [, forceTick] = useState(0)
  const lastLookupPos = useRef(null)

  // Zulu clock + flight timer live-tick every second regardless of GPS updates
  useEffect(() => {
    const t = setInterval(() => forceTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Elevation-under-you, nearest baro station, nearest navaid — all network
  // lookups, so they're refreshed only when the aircraft has actually moved
  // a couple of NM, not on every GPS tick.
  useEffect(() => {
    if (!coords) return
    const last = lastLookupPos.current
    const moved = !last || haversineNm(coords.lat, coords.lon, last[0], last[1]) > 2
    if (!moved) return
    lastLookupPos.current = [coords.lat, coords.lon]

    getGroundElevationFt(coords.lat, coords.lon).then(setGroundElevFt).catch(() => {})

    const pad = 0.6
    fetch(`/api/awc?path=metar&format=json&bbox=${coords.lat - pad},${coords.lon - pad},${coords.lat + pad},${coords.lon + pad}`)
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        if (!Array.isArray(list) || !list.length) return
        let best = null, bestD = Infinity
        for (const m of list) {
          if (m.altim == null) continue
          const d = haversineNm(coords.lat, coords.lon, m.lat, m.lon)
          if (d < bestD) { bestD = d; best = { icao: m.icaoId, inHg: m.altim / 33.8639 } }
        }
        if (best) setNearestBaro(best)
      }).catch(() => {})

    getAirports().then(list => {
      let best = null, bestD = Infinity
      for (const [ident, lat, lon] of list) {
        const d = haversineNm(coords.lat, coords.lon, lat, lon)
        if (d < bestD) { bestD = d; best = { ident, lat, lon } }
      }
      if (best) setNearestApt(best)
    }).catch(() => {})

    findNearestNavaid(coords.lat, coords.lon).then(hit => { if (hit) setNearestNavaid(hit) }).catch(() => {})
  }, [coords?.lat, coords?.lon])

  const dest = route && route.length >= 2 ? route[route.length - 1] : null
  const next = route && route.length >= 2 ? route[1] : null
  const prevForNext = route && route.length >= 2 ? route[0] : null

  function computeValue(key) {
    switch (key) {
      case 'blank': return { v: '', u: '' }
      case 'zulu': return { v: fmtClock(new Date()) + 'Z', u: '' }
      case 'flightTime': return { v: fmtDur((Date.now() - sessionStart.current) / 60000), u: '' }
      default: break
    }
    if (!coords) return { v: '—', u: '' }
    switch (key) {
      case 'gs': return { v: fmt(coords.speedKt, 0), u: 'kt' }
      case 'gpsAlt': return { v: fmt(coords.altFt, 0), u: 'ft' }
      case 'agl': return coords.altFt != null && groundElevFt != null
        ? { v: fmt(coords.altFt - groundElevFt, 0), u: 'ft' } : { v: '—', u: '' }
      case 'track': return { v: fmt(coords.headingDeg, 0), u: '°' }
      case 'accuracy': return { v: fmt(coords.accuracyM, 0), u: 'm' }
      case 'rot': return { v: fmt(derived.rotDegSec, 1), u: '°/s' }
      case 'vs': return { v: fmt(derived.vsFpm, 0), u: 'fpm' }
      case 'climbGrad': return derived.vsFpm != null && coords.speedKt
        ? { v: fmt(derived.vsFpm / (coords.speedKt / 60), 0), u: 'ft/nm' } : { v: '—', u: '' }
      case 'nearestBaro': return nearestBaro ? { v: nearestBaro.inHg.toFixed(2), u: `"  ${nearestBaro.icao}` } : { v: '—', u: '' }
      case 'nearestApt': return nearestApt ? { v: nearestApt.ident, u: relBearing(coords.lat, coords.lon, nearestApt.lat, nearestApt.lon) } : { v: '—', u: '' }
      case 'nearestNavaid': return nearestNavaid
        ? { v: nearestNavaid.ident, u: `${nearestNavaid.freq ?? ''} ${relBearing(coords.lat, coords.lon, nearestNavaid.lat, nearestNavaid.lon)}`.trim() }
        : { v: '—', u: '' }
      case 'currCoords': return { v: fmtAvCoord(coords.lat, coords.lon), u: '' }
      case 'horizon': return { v: fmt(horizonNm(coords.altFt), 0), u: 'NM' }
      default: break
    }
    // Next-waypoint / destination fields need an active route
    if (key.endsWith('Next') || key === 'xtk') {
      if (!next) return { v: '—', u: '' }
      const dist = haversineNm(coords.lat, coords.lon, next.lat, next.lon)
      const brg = bearingDeg(coords.lat, coords.lon, next.lat, next.lon)
      switch (key) {
        case 'distNext': return { v: fmt(dist, 1), u: 'NM' }
        case 'brgNext': return { v: fmt(brg, 0), u: '°' }
        case 'courseNext': return prevForNext ? { v: fmt(bearingDeg(prevForNext.lat, prevForNext.lon, next.lat, next.lon), 0), u: '°' } : { v: '—', u: '' }
        case 'eteNext': return coords.speedKt > 5 ? { v: fmtDur(dist / coords.speedKt * 60), u: '' } : { v: '—', u: '' }
        case 'etaNext': return coords.speedKt > 5 ? { v: fmtClock(new Date(Date.now() + dist / coords.speedKt * 3600000)) + 'Z', u: '' } : { v: '—', u: '' }
        case 'xtk': return route.length >= 2 ? { v: fmt(crossTrackNm(coords.lat, coords.lon, [route[0].lat, route[0].lon], [next.lat, next.lon]), 1), u: 'NM' } : { v: '—', u: '' }
        default: return { v: '—', u: '' }
      }
    }
    if (key.endsWith('Dest') || key === 'descDest') {
      if (!dest) return { v: '—', u: '' }
      const dist = haversineNm(coords.lat, coords.lon, dest.lat, dest.lon)
      const brg = bearingDeg(coords.lat, coords.lon, dest.lat, dest.lon)
      switch (key) {
        case 'distDest': return { v: fmt(dist, 1), u: 'NM' }
        case 'brgDest': return { v: fmt(brg, 0), u: '°' }
        case 'eteDest': return coords.speedKt > 5 ? { v: fmtDur(dist / coords.speedKt * 60), u: '' } : { v: '—', u: '' }
        case 'etaDest': return coords.speedKt > 5 ? { v: fmtClock(new Date(Date.now() + dist / coords.speedKt * 3600000)) + 'Z', u: '' } : { v: '—', u: '' }
        case 'descDest': {
          if (dest.kind !== 'APT' || coords.speedKt <= 5) return { v: '—', u: '' }
          const eteMin = dist / coords.speedKt * 60
          const need = coords.altFt != null ? coords.altFt : null
          return need != null ? { v: fmt(need / eteMin, 0), u: 'fpm' } : { v: '—', u: '' }
        }
        default: return { v: '—', u: '' }
      }
    }
    return { v: '—', u: '' }
  }

  const shown = fields.filter(k => k !== 'blank' || true)

  return (
    <>
      <div
        onClick={() => setPicking(true)}
        style={{
          position: 'absolute', bottom: 72, left: 12, right: 12, zIndex: 500,
          background: 'var(--bg-card)', borderRadius: 14, boxShadow: 'var(--shadow-sm)',
          display: 'flex', overflowX: 'auto', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}>
        {shown.map((key, i) => {
          if (key === 'blank') return <div key={i} style={{ width: 24, flexShrink: 0 }} />
          const def = CATALOG_BY_KEY[key]
          if (!def) return null
          const { v, u } = computeValue(key)
          return (
            <div key={i} style={{
              flexShrink: 0, minWidth: 64, padding: '7px 10px',
              borderLeft: i === 0 ? 'none' : '0.5px solid var(--border)',
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                {def.label}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                {v}{u && <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 3, color: 'var(--text-secondary)' }}>{u}</span>}
              </div>
            </div>
          )
        })}
        {status !== 'success' && (
          <div style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text-tertiary)', alignSelf: 'center' }}>
            {status === 'pending' ? 'Finding GPS…' : 'No GPS'}
          </div>
        )}
      </div>

      {picking && (
        <div
          onClick={() => setPicking(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end' }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxHeight: '80vh', overflowY: 'auto', background: 'var(--bg)', borderRadius: '20px 20px 0 0', padding: '10px 18px 28px' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '4px auto 6px' }} />
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>
              Choose up to {MAX_FIELDS} — {fields.filter(k => k !== 'blank').length}/{MAX_FIELDS} selected
            </div>
            {CATEGORIES.map(cat => (
              <div key={cat}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '16px 4px 6px' }}>
                  {cat}
                </div>
                <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: '0 14px', boxShadow: 'var(--shadow-sm)' }}>
                  {FIELD_CATALOG.filter(f => f.cat === cat).map((f, i) => {
                    const active = fields.includes(f.key)
                    const disabled = f.need === 'none'
                    return (
                      <div key={f.key}
                        onClick={disabled ? undefined : () => toggleField(f.key)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '12px 0', borderTop: i === 0 ? 'none' : '0.5px solid var(--border)',
                          cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
                          WebkitTapHighlightColor: 'transparent',
                        }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                            {f.label}{f.need === 'route' && !route ? ' (needs a route)' : ''}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                            {disabled ? 'No data source yet' : f.sub}
                          </div>
                        </div>
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginLeft: 12,
                          border: active ? 'none' : '1.5px solid var(--border)',
                          background: active ? 'var(--accent)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, color: 'var(--accent-fg)', fontWeight: 900,
                        }}>
                          {active && '✓'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
