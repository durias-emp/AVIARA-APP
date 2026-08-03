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
  loadWeather, parseFltCat, parseWind, parseVisib, parseCeiling, parseTemp, parseDewp,
  parseAirportName,
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
  const [open, setOpen] = useState(false)      // the inline expansion
  const [detail, setDetail] = useState(false)  // the full overlay
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

  // The four the weather card shows, with the icons it uses, so the two are
  // recognisably the same readout rather than two dialects of it.
  const metrics = metar ? [
    { icon: '/wind.png',       value: parseWind(metar, units) },
    { icon: '/cloud.png',      value: parseCeiling(metar, units) },
    { icon: '/visibility.png', value: parseVisib(metar, units) },
    { icon: '/droplet.png',    value: parseDewp(metar, units) },
  ].filter(m => m.value) : []

  return (<>
    <div style={{
      background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(14px)',
      borderRadius: 14, boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      overflow: 'hidden', maxWidth: 'calc(100vw - 130px)',
      ...style,
    }}>
      {/* Collapsed, this is the whole thing: what the field is doing, and
          which field. That is the glance a pilot takes, and a strip of
          numbers across the top of a chart is furniture the rest of the time. */}
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%',
        padding: '8px 12px 8px 9px', border: 'none', background: 'none',
        cursor: 'pointer',
      }}>
        <span style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.3px',
          color: cat.color, background: cat.bg, padding: '4px 7px', borderRadius: 7,
          flexShrink: 0,
        }}>{metar ? cat.label : loading ? '···' : '--'}</span>

        <span style={{
          fontSize: 13, fontWeight: 700, color: '#1c1c1e',
          letterSpacing: '0.4px', flexShrink: 0,
        }}>{icao}</span>

        {stale && (
          <span title="Observation is over an hour old" style={{
            fontSize: 9.5, fontWeight: 800, color: '#FF9500',
            background: 'rgba(255,149,0,0.16)', padding: '3px 5px',
            borderRadius: 5, flexShrink: 0,
          }}>OLD</span>
        )}

        {!metar && !loading && (
          <span style={{ fontSize: 12, color: 'rgba(60,60,67,0.5)' }}>
            {error ? 'No weather' : 'Tap for weather'}
          </span>
        )}

        {/* The affordance. Without it a strip showing two things looks like a
            label rather than something that opens. */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.45)"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          style={{
            marginLeft: 'auto', flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 240ms cubic-bezier(0.4,0,0.2,1)',
          }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Expands downward. Grid rows rather than max-height so it animates to
          its real height: a guessed max-height either clips the content or
          leaves the easing running against empty space. */}
      <div style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        transition: 'grid-template-rows 260ms cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          <div style={{ padding: '2px 12px 11px' }}>
            <div style={{ height: 1, background: 'rgba(60,60,67,0.1)', margin: '0 0 9px' }} />

            {metar ? (<>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8 }}>
                <span style={{ fontSize: 24, fontWeight: 800, color: '#1c1c1e', letterSpacing: '-0.8px' }}>
                  {parseTemp(metar, units) ?? '--'}
                </span>
                <span style={{ fontSize: 11.5, color: 'rgba(60,60,67,0.55)', minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {parseAirportName(metar) || ''}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 14px' }}>
                {metrics.map(m => (
                  <div key={m.icon} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <img src={m.icon} alt="" width={13} height={13}
                      style={{ filter: 'brightness(0)', opacity: 0.55, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1c1c1e' }}>{m.value}</span>
                  </div>
                ))}
              </div>

              <button onClick={() => setDetail(true)} style={{
                marginTop: 10, width: '100%', border: 'none', cursor: 'pointer',
                background: 'rgba(60,60,67,0.07)', borderRadius: 9, padding: '7px 0',
                fontSize: 11.5, fontWeight: 700, color: '#1c1c1e',
              }}>
                Full report, METAR and TAF
              </button>
            </>) : (
              <div style={{ fontSize: 11.5, color: 'rgba(60,60,67,0.55)', padding: '2px 0 4px' }}>
                {loading ? 'Loading conditions…' : error ? 'Weather unavailable right now' : 'No observation'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* The same overlay the weather card opens, portaled so the map's stacking
        context cannot trap it. */}
    {detail && createPortal(
      <WeatherDetailOverlay
        wx={wx} icao={icao} loading={loading} error={error} isStale={stale}
        onClose={() => setDetail(false)}
        onRefresh={() => load(icao)} />,
      document.body,
    )}
  </>)
}
