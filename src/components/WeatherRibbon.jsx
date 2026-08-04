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
import AirportPickerModal from './AirportPickerModal'

// Conditions age. A METAR is issued hourly and a pilot reading a two-hour-old
// observation as current is exactly the failure this app exists to prevent, so
// staleness is shown rather than hidden.
const STALE_MS = 75 * 60 * 1000
// The app's highlight colour, the same one the record button uses.
const ACCENT = '#FF5A1F'

export default function WeatherRibbon({
  icao, units = {}, style, onChangeAirport,
  // Controlled from the parent so the weather button in the sheet opens the
  // same report this strip opens. There is one working weather screen and
  // both routes into it should land there.
  detailOpen = false, onDetailChange,
}) {
  const [wx, setWx] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)      // the inline expansion

  const [picker, setPicker] = useState(false)  // choosing a different base
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

  // No base set yet. The strip becomes the invitation to set one rather than
  // disappearing: a pilot who has not chosen a home airport is exactly the one
  // who needs the control to be visible.
  if (!icao) {
    return (<>
      <button onClick={() => setPicker(true)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 14px', borderRadius: 14, border: 'none',
        background: 'var(--map-panel)', backdropFilter: 'blur(14px)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)', cursor: 'pointer',
        fontSize: 12.5, fontWeight: 700, color: 'var(--map-ink)', ...style,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Set home airport
      </button>
      {picker && createPortal(
        <AirportPickerModal
          onConfirm={(id) => { setPicker(false); onChangeAirport?.(id) }}
          onClose={() => setPicker(false)} />,
        document.body,
      )}
    </>)
  }

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
      background: 'var(--map-panel)', backdropFilter: 'blur(14px)',
      borderRadius: 14, boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      overflow: 'hidden',
      // Sized by its contents, not stretched: collapsed this is a state and a
      // code, and a pill with a stretch of empty space between them reads as
      // something that failed to load rather than something compact.
      width: 'fit-content', maxWidth: 'calc(100vw - 130px)',
      ...style,
    }}>
      {/* Collapsed, this is the whole thing: what the field is doing, and
          which field. That is the glance a pilot takes, and a strip of
          numbers across the top of a chart is furniture the rest of the time. */}
      {/* The whole strip expands. Changing the base used to live on the code
          itself, which turned out to be most of the pill: tapping what looks
          like a weather readout opened an airport picker, and the weather was
          almost unreachable. Reading conditions is the frequent act and moving
          base is the rare one, so the frequent one gets the whole target and
          the rare one gets a labelled control inside. */}
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 7, width: '100%',
        padding: '6px 12px', border: 'none', background: 'none',
        cursor: 'pointer',
      }}>
        <span style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.3px',
          color: cat.color, background: cat.bg, padding: '4px 7px', borderRadius: 7,
          flexShrink: 0,
        }}>{metar ? cat.label : loading ? '···' : '--'}</span>

        <span style={{
          fontSize: 13.5, fontWeight: 700, color: 'var(--map-ink)',
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
          <span style={{ fontSize: 12, color: 'var(--map-ink-faint)' }}>
            {error ? 'No weather' : 'Tap for weather'}
          </span>
        )}

        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.45)"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          style={{
            flexShrink: 0,
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
        {/* Width zero while closed, not just height. A grid row collapsed to
            0fr still contributes its content's WIDTH, so the airport name and
            the metric grid were setting the width of a pill showing two short
            words: it measured 231px for something that needs about 120. */}
        <div style={{ overflow: 'hidden', minHeight: 0, width: open ? 'auto' : 0 }}>
          {/* The min width belongs to the open state only. Applied always, it
              set the width of the collapsed pill too, which is why a strip
              showing two short words still stretched halfway across the map. */}
          <div style={{ padding: '2px 12px 11px', minWidth: open ? 236 : 0 }}>
            {metar ? (<>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8 }}>
                <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--map-ink)', letterSpacing: '-0.8px' }}>
                  {parseTemp(metar, units) ?? '--'}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--map-ink-dim)', minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {parseAirportName(metar) || ''}
                </span>
              </div>


              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 14px' }}>
                {metrics.map(m => (
                  <div key={m.icon} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <img src={m.icon} alt="" width={13} height={13}
                      style={{ filter: 'brightness(0)', opacity: 0.55, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--map-ink)' }}>{m.value}</span>
                  </div>
                ))}
              </div>

              <button onClick={() => onDetailChange?.(true)} style={{
                marginTop: 10, width: '100%', border: 'none', cursor: 'pointer',
                background: 'var(--map-fill)', borderRadius: 9, padding: '9px 0',
                fontSize: 11.5, fontWeight: 700, color: 'var(--map-ink)',
              }}>
                Full report, METAR and TAF
              </button>

              {/* Last, and in the accent, because it is the only thing in this
                  panel that changes something rather than reporting it. Same
                  shape as the button above so the two read as a pair of
                  actions rather than a button and a link. */}
              <button onClick={() => setPicker(true)} style={{
                marginTop: 7, width: '100%', border: 'none', cursor: 'pointer',
                background: ACCENT, borderRadius: 9, padding: '9px 0',
                fontSize: 11.5, fontWeight: 700, color: '#fff',
              }}>
                Change home airport
              </button>
            </>) : (
              <div style={{ fontSize: 11.5, color: 'var(--map-ink-dim)', padding: '2px 0 4px' }}>
                {loading ? 'Loading conditions…' : error ? 'Weather unavailable right now' : 'No observation'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* The same overlay the weather card opens, portaled so the map's stacking
        context cannot trap it. */}
    {picker && createPortal(
      <AirportPickerModal
        current={icao}
        onConfirm={(id) => { setPicker(false); onChangeAirport?.(id) }}
        onClose={() => setPicker(false)} />,
      document.body,
    )}

    {detailOpen && createPortal(
      <WeatherDetailOverlay
        wx={wx} icao={icao} loading={loading} error={error} isStale={stale}
        onClose={() => onDetailChange?.(false)}
        onRefresh={() => load(icao)} />,
      document.body,
    )}
  </>)
}
