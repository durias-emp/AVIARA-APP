// The base airport's conditions, on the map, at a glance.
//
// The menu-style home put a full weather card at the top of the screen, so
// conditions were the first thing a pilot saw. A map home that only links to
// weather buries the one number they open the app for, so it comes back here
// in the form a map can carry: a single strip, category first, tappable into
// the detail overlay that already exists.
//
// This deliberately reuses loadWeather and the same parsers the weather card
// uses. A second weather path would drift, and two answers to "is it VFR" is
// worse than none.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  loadWeather, parseFltCat, parseWind, parseVisib, parseCeiling, parseTemp,
} from '../lib/weather'
import WeatherDetailOverlay from './WeatherDetailOverlay'

// Conditions age. A METAR is issued hourly and a pilot reading a two-hour-old
// observation as current is exactly the failure this app exists to prevent, so
// staleness is shown rather than hidden.
const STALE_MS = 75 * 60 * 1000

export default function WeatherRibbon({ icao, units = {}, style }) {
  const [wx, setWx] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async (id) => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      setWx(await loadWeather(id))
    } catch (e) {
      setError(e.message ?? 'Weather unavailable')
    } finally {
      setLoading(false)
    }
  }, [])

  // Deferred by a microtask rather than called straight from the effect body:
  // load() flips the loading flag immediately, and a setState synchronous with
  // the effect makes React render twice before paint for no benefit.
  useEffect(() => {
    if (!icao) return
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) load(icao) })
    return () => { cancelled = true }
  }, [icao, load])

  // Coming back to the app after a while is exactly when the observation on
  // screen is most likely to be out of date.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(icao)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [icao, load])

  if (!icao) return null

  const metar = wx?.metar
  const cat = parseFltCat(metar)
  // Ticked from state rather than read during render: a clock read while
  // rendering makes the same props produce different output. Ticking also
  // means the badge appears on its own as the observation ages, without
  // waiting for a refetch that may never come.
  const stale = wx?.fetchedAt != null && now - wx.fetchedAt > STALE_MS

  const wind = parseWind(metar, units)
  const vis = parseVisib(metar, units)
  const ceil = parseCeiling(metar, units)
  const temp = parseTemp(metar, units)

  // Ceiling is the number that decides the category, so when there is one it
  // earns the slot ahead of visibility.
  const second = ceil ?? vis

  return (<>
    <button onClick={() => setOpen(true)} style={{
      display: 'flex', alignItems: 'center', gap: 9,
      padding: '8px 13px 8px 9px', borderRadius: 14, border: 'none',
      background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(14px)',
      boxShadow: '0 2px 10px rgba(0,0,0,0.18)', cursor: 'pointer',
      maxWidth: 'calc(100vw - 130px)', ...style,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 800, letterSpacing: '0.3px',
        color: cat.color, background: cat.bg, padding: '4px 7px', borderRadius: 7,
        flexShrink: 0,
      }}>{metar ? cat.label : loading ? '···' : '--'}</span>

      <span style={{
        fontSize: 12.5, fontWeight: 700, color: '#1c1c1e',
        letterSpacing: '0.4px', flexShrink: 0,
      }}>{icao}</span>

      {metar && (
        <span style={{
          fontSize: 12, color: 'rgba(60,60,67,0.62)', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
        }}>
          {[temp, wind, second].filter(Boolean).join(' · ')}
        </span>
      )}

      {!metar && !loading && (
        <span style={{ fontSize: 12, color: 'rgba(60,60,67,0.5)' }}>
          {error ? 'No weather' : 'Tap for weather'}
        </span>
      )}

      {stale && (
        <span title="Observation is over an hour old" style={{
          fontSize: 9.5, fontWeight: 800, color: '#FF9500',
          background: 'rgba(255,149,0,0.16)', padding: '3px 5px',
          borderRadius: 5, flexShrink: 0,
        }}>OLD</span>
      )}
    </button>

    {/* The same overlay the weather card opens, portaled so the map's stacking
        context cannot trap it. */}
    {open && createPortal(
      <WeatherDetailOverlay
        wx={wx} icao={icao} loading={loading} error={error} isStale={stale}
        onClose={() => setOpen(false)}
        onRefresh={() => load(icao)} />,
      document.body,
    )}
  </>)
}
