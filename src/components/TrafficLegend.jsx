// What the traffic layer is, and what it is not.
//
// This is not decoration. Aggregated ADS-B inside a flight-planning map can be
// read as TCAS or TIS-B, and it is neither: it is delayed, it is blind to
// anything not transmitting, and its low-altitude coverage over Central
// America is patchy. So the caveat is permanent while the layer is on rather
// than dismissible, and the snapshot age is always on screen: a frozen picture
// must never be able to pass for a live one.
//
// It is a strip, not a panel. It used to be a 300px card at the bottom left
// with a paragraph of warning in it, which covered a quarter of the map at the
// moment a pilot had turned on the layer to look at the map. It now takes the
// full width above the drawer and about the height of the recording card,
// which is the shape this screen already uses for "here is what is happening
// right now": a label, a row of figures, and nothing else.
//
// The caveat survives that shrink as one line rather than a paragraph. The
// full text is in the tooltip and the words that matter are the ones that are
// left: not for separation, delayed, incomplete.
//
// Strings are English only. The repo has no i18n layer at present, so there is
// nothing to route them through; when one lands, these are the first strings
// that should go into it.

import { useEffect, useState } from 'react'
import { ALTITUDE_BANDS } from './trafficBands'

// Past this the picture is old enough that saying so matters more than the
// count does.
const STALE_MS = 30000

const CAVEAT_FULL = 'Do not use for separation or traffic avoidance. Data is '
  + 'delayed, and coverage is incomplete at low altitude. Aircraft not '
  + 'transmitting ADS-B do not appear at all, and light aircraft on 978 UAT '
  + 'may be missing even when they are transmitting.'

const label = { fontSize: 10, fontWeight: 600, color: 'var(--map-ink-dim)', letterSpacing: '0.2px' }
const big = {
  fontSize: 22, fontWeight: 800, color: 'var(--map-ink)',
  letterSpacing: '-0.6px', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
}

export default function TrafficLegend({ meta, onClose, filter, onFilter, lightCount }) {
  const [now, setNow] = useState(() => Date.now())

  // Ticked from state rather than read during render, so the age climbs on its
  // own even while nothing else changes and the same props always render the
  // same output.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const ageMs = meta.fetchedAt ? now - meta.fetchedAt : null
  const stale = ageMs != null && ageMs > STALE_MS
  const ageText = ageMs == null ? 'no data yet'
    : ageMs < 10000 ? 'live'
    : `${Math.round(ageMs / 1000)}s ago`
  // An error that has not yet cost us the picture still gets said, because the
  // number beside it is older than it looks.
  const status = meta.error ? 'no signal' : ageText
  const warn = !!meta.error || stale

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase',
          color: 'var(--map-ink)',
        }}>Live traffic</span>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: '0.4px', textTransform: 'uppercase',
          color: 'var(--map-ink-dim)', background: 'var(--map-fill)',
          padding: '2px 5px', borderRadius: 4,
        }}>Reference only</span>
        <span style={{
          marginLeft: 'auto', fontSize: 10.5, fontWeight: 700,
          color: warn ? '#FF9500' : 'var(--map-ink-dim)',
          background: warn ? 'rgba(255,149,0,0.15)' : 'transparent',
          padding: warn ? '3px 6px' : 0, borderRadius: 5, whiteSpace: 'nowrap',
        }}>{status}</span>
        {onClose && (
          <button onClick={onClose} aria-label="Hide traffic" style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--map-ink-faint)', padding: 2, display: 'flex', flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Two figures and the colour key, on one line, the way the recording
          card puts its three figures on one. The key is here rather than on a
          row of its own because it is what makes the figures readable: a
          count of aircraft means little without knowing which dot is which. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 10 }}>
        <div style={{ flexShrink: 0 }}>
          <div style={big}>{meta.count}</div>
          <div style={label}>Aircraft</div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <div style={big}>{lightCount ?? 0}</div>
          <div style={label}>Light</div>
        </div>
        <div style={{
          marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end',
          gap: '4px 9px', paddingBottom: 2,
        }}>
          {ALTITUDE_BANDS.map(b => (
            <span key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color, flexShrink: 0 }} />
              <span style={{ fontSize: 9.5, color: 'var(--map-ink-dim)' }}>{b.short ?? b.label}</span>
            </span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Triangulated rather than broadcast, so the position is less certain">
            <span style={{
              width: 8, height: 8, borderRadius: 2, flexShrink: 0,
              border: '1.5px solid var(--map-ink-faint)',
            }} />
            <span style={{ fontSize: 9.5, color: 'var(--map-ink-dim)' }}>MLAT</span>
          </span>
        </div>
      </div>

      {/* What to look at. The default is not "everything": in a busy area the
          airliners outnumber light aircraft three to one, and a GA pilot
          scanning for the traffic they actually share the sky with should not
          have to find it inside the flow above them. */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--map-fill)', borderRadius: 9, padding: 3 }}>
        {[
          ['ga', 'GA focus', 'Light aircraft prominent, the rest dimmed'],
          ['light', 'GA only', 'Hide everything above 15,500 lb'],
          ['all', 'All', 'Every target at equal weight'],
        ].map(([key, text, title]) => (
          <button key={key} onClick={() => onFilter?.(key)} title={title} style={{
            flex: 1, border: 'none', cursor: 'pointer', borderRadius: 7,
            padding: '5px 4px', fontSize: 10.5, fontWeight: 700,
            background: filter === key ? 'var(--map-panel-solid)' : 'transparent',
            color: filter === key ? 'var(--map-ink)' : 'var(--map-ink-dim)',
            boxShadow: filter === key ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
          }}>{text}</button>
        ))}
      </div>

      {/* One line, and it is the one line that matters. The rest of it is in
          the tooltip rather than deleted: shrinking the card may not shrink
          what the app has told the pilot. */}
      <div title={CAVEAT_FULL} style={{
        marginTop: 8, fontSize: 9.5, lineHeight: 1.4, color: 'var(--map-ink-faint)',
      }}>
        <span style={{ color: '#c07800', fontWeight: 700 }}>Not for separation.</span>
        {' '}Delayed, and incomplete at low altitude.
        {meta.attribution ? ` ${meta.attribution}` : ''}
      </div>
    </div>
  )
}
