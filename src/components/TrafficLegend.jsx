// What the traffic layer is, and what it is not.
//
// This is not decoration. Aggregated ADS-B inside a flight-planning map can be
// read as TCAS or TIS-B, and it is neither: it is delayed, it is blind to
// anything not transmitting, and its low-altitude coverage over Central
// America is patchy. The warning strip is therefore permanent while the layer
// is on rather than something dismissible, and the snapshot age is always on
// screen so a frozen picture can never pass for a live one.
//
// Strings are English only. The repo has no i18n layer at present, so there is
// nothing to route them through; when one lands, these are the first strings
// that should go into it.

import { useEffect, useState } from 'react'
import { ALTITUDE_BANDS } from './trafficBands'

// Past this the picture is old enough that saying so matters more than the
// count does.
const STALE_MS = 30000

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

  return (
    <div style={{
      background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(18px)',
      borderRadius: 16, padding: '12px 14px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
      maxWidth: 300,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#1c1c1e', letterSpacing: '-0.1px' }}>
          Live traffic
        </span>
        <span style={{
          fontSize: 9.5, fontWeight: 800, letterSpacing: '0.4px', textTransform: 'uppercase',
          color: 'rgba(60,60,67,0.6)', background: 'rgba(60,60,67,0.09)',
          padding: '3px 6px', borderRadius: 5,
        }}>Reference only</span>
        {onClose && (
          <button onClick={onClose} aria-label="Hide traffic legend" style={{
            marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(60,60,67,0.5)', padding: 2, display: 'flex',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: '#1c1c1e', fontVariantNumeric: 'tabular-nums' }}>
          {meta.count}
        </span>
        <span style={{ fontSize: 11.5, color: 'rgba(60,60,67,0.6)' }}>
          aircraft{lightCount != null ? `, ${lightCount} light` : ''}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 10.5, fontWeight: 700,
          color: stale ? '#FF9500' : 'rgba(60,60,67,0.55)',
          background: stale ? 'rgba(255,149,0,0.15)' : 'transparent',
          padding: stale ? '3px 6px' : 0, borderRadius: 5,
        }}>{meta.error ? 'no signal' : ageText}</span>
      </div>

      {/* What to look at. The default is not "everything": in a busy area the
          airliners outnumber light aircraft three to one, and a GA pilot
          scanning for the traffic they actually share the sky with should not
          have to find it inside the flow above them. */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, background: 'rgba(60,60,67,0.07)', borderRadius: 9, padding: 3 }}>
        {[
          ['ga', 'GA focus', 'Light aircraft prominent, the rest dimmed'],
          ['light', 'GA only', 'Hide everything above 15,500 lb'],
          ['all', 'All', 'Every target at equal weight'],
        ].map(([key, label, title]) => (
          <button key={key} onClick={() => onFilter?.(key)} title={title} style={{
            flex: 1, border: 'none', cursor: 'pointer', borderRadius: 7,
            padding: '5px 4px', fontSize: 10.5, fontWeight: 700,
            background: filter === key ? '#fff' : 'transparent',
            color: filter === key ? '#1c1c1e' : 'rgba(60,60,67,0.6)',
            boxShadow: filter === key ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 12px', marginBottom: 10 }}>
        {ALTITUDE_BANDS.map(b => (
          <span key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: b.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'rgba(60,60,67,0.65)' }}>{b.label}</span>
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 9, height: 9, borderRadius: 2, flexShrink: 0,
            border: '1.5px solid rgba(60,60,67,0.6)',
          }} />
          <span style={{ fontSize: 10, color: 'rgba(60,60,67,0.65)' }}>MLAT (lower confidence)</span>
        </span>
      </div>

      <div style={{
        fontSize: 10, lineHeight: 1.45, color: '#8a5a00',
        background: 'rgba(255,149,0,0.13)', borderRadius: 9, padding: '8px 9px',
      }}>
        Do not use for separation or traffic avoidance. Data is delayed, and
        coverage is incomplete at low altitude. Aircraft not transmitting ADS-B
        do not appear at all, and light aircraft on 978 UAT may be missing even
        when they are transmitting.
      </div>

      {meta.attribution && (
        <div style={{ marginTop: 8, fontSize: 9.5, color: 'rgba(60,60,67,0.5)' }}>
          {meta.attribution}
        </div>
      )}
    </div>
  )
}
