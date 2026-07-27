// What happens after you drop a point on the map.
//
// Dropping used to insert a bare coordinate straight into the route. That is
// almost never what a pilot means: there is usually a fix, a navaid or a field
// within a couple of miles, and a route built from named points is the one
// that gets filed, read back and found again on the chart. So the drop opens
// this instead — what is actually there, nearest first, with the coordinate
// kept as the fallback it should be.
//
// Two ways to add, because "add a waypoint" is ambiguous once a route exists:
// somewhere along the way, or a new final destination.

import { useEffect, useState } from 'react'
import { nearbyPoints, FILTERS } from '../../../lib/nearby'

const KIND_STYLE = {
  AIRPORT: { label: 'APT', color: 'var(--ok)' },
  VOR:     { label: 'VOR', color: '#5AC8FA' },
  FIX:     { label: 'FIX', color: 'var(--text-secondary)' },
}

// point:    { lat, lon } where the finger landed
// mode:     'insert' when adding to the route, 'move' when a waypoint was dragged
// onChoose: (target) => void
//           target = { lat, lon, name|null, as: 'insert'|'append'|'move'|'destination' }
export default function DropPicker({ point, mode = 'insert', canAppend = true, onChoose, onCancel }) {
  const [filter, setFilter] = useState('all')
  const [options, setOptions] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!point) return
    let cancelled = false
    nearbyPoints(point.lat, point.lon, { withinNm: 10 })
      .then(r => { if (!cancelled) setOptions(r) })
      .catch(() => { if (!cancelled) setOptions([]) })
    return () => { cancelled = true }
  }, [point?.lat, point?.lon])

  if (!point) return null

  const shown = (options || []).filter(p => FILTERS.find(f => f.id === filter).match(p))
  // The coordinate is always available, and is what you get if nothing is
  // selected — the drop still means something even in the middle of nowhere.
  const target = selected
    ? { lat: selected.lat, lon: selected.lon, name: selected.ident }
    : { lat: point.lat, lon: point.lon, name: null }

  const btn = (label, as, primary) => (
    <button onClick={() => onChoose({ ...target, as })} style={{
      flex: 1, padding: '10px 0', borderRadius: 9, cursor: 'pointer',
      background: primary ? 'var(--text)' : 'var(--bg-card-2)',
      color: primary ? 'var(--bg)' : 'var(--text)',
      border: primary ? 'none' : '0.5px solid var(--border)',
      fontSize: 12.5, fontWeight: 700,
    }}>{label}</button>
  )

  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 10020,
      background: 'rgba(12,12,16,0.97)', backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)', border: '0.5px solid rgba(255,255,255,0.14)',
      borderRadius: 16, padding: '12px 13px', boxShadow: '0 8px 36px rgba(0,0,0,0.6)',
      maxHeight: '62%', display: 'flex', flexDirection: 'column',
      // The sheet opens under a finger that is often still down.
      userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>
          {mode === 'move' ? 'Move this point to' : 'Add to route'}
        </div>
        <span onClick={onCancel} style={{ fontSize: 17, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>✕</span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
            background: filter === f.id ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.08)',
            color: filter === f.id ? '#000' : 'rgba(255,255,255,0.75)',
            border: 'none', letterSpacing: '0.3px',
          }}>{f.label}</button>
        ))}
      </div>

      <div style={{ overflowY: 'auto', marginTop: 8, flex: 1, minHeight: 0 }}>
        {/* The raw coordinate, always first and always available */}
        <Row
          active={!selected}
          onClick={() => setSelected(null)}
          badge={{ label: 'COORD', color: 'rgba(255,255,255,0.4)' }}
          title={fmtCoord(point.lat, point.lon)}
          sub="Exact position you dropped"
          mono />

        {options === null && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', padding: '10px 2px' }}>
            Looking for nearby points…
          </div>
        )}
        {options?.length === 0 && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', padding: '10px 2px', lineHeight: 1.5 }}>
            Nothing charted within 10 NM — the coordinate above is the option here.
          </div>
        )}
        {shown.map(p => (
          <Row key={`${p.kind}-${p.ident}-${p.lat}`}
            active={selected?.ident === p.ident && selected?.lat === p.lat}
            onClick={() => setSelected(p)}
            badge={KIND_STYLE[p.kind]}
            title={p.ident}
            sub={`${p.distNm.toFixed(1)} NM · ${p.sub}${p.name ? ` · ${p.name}` : ''}`} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
        {mode === 'move'
          ? btn('Move here', 'move', true)
          : (<>
              {btn('Add along route', 'insert', true)}
              {canAppend && btn('Add as final', 'append', false)}
            </>)}
      </div>

      {/* Only an airport can become the destination — a fix cannot be landed
          at, and offering it there would produce a route that cannot be filed. */}
      {mode !== 'move' && selected?.kind === 'AIRPORT' && (
        <button onClick={() => onChoose({ ...target, as: 'destination' })} style={{
          marginTop: 7, width: '100%', padding: '10px 0', borderRadius: 9, cursor: 'pointer',
          background: 'transparent', border: '0.5px solid var(--ok)',
          color: 'var(--ok)', fontSize: 12.5, fontWeight: 700,
        }}>
          Make {selected.ident} the destination
        </button>
      )}

      <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.3)', marginTop: 7, lineHeight: 1.45 }}>
        {mode === 'move'
          ? 'Snaps the point to the selection, or leaves it on the coordinate.'
          : selected?.kind === 'AIRPORT'
          ? '“Along route” adds a turning point. “Final” adds it as the last point. “Make destination” re-files the route to end there.'
          : '“Along route” drops it into the leg you tapped. “Final” adds it as the last point of the route.'}
      </div>
    </div>
  )
}

function Row({ active, onClick, badge, title, sub, mono }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 9,
      cursor: 'pointer', background: active ? 'rgba(255,255,255,0.13)' : 'transparent',
      border: `0.5px solid ${active ? 'rgba(255,255,255,0.35)' : 'transparent'}`,
      marginBottom: 3,
    }}>
      <span style={{
        fontSize: 8.5, fontWeight: 800, letterSpacing: '0.5px', color: badge.color,
        border: `0.5px solid ${badge.color}`, borderRadius: 3, padding: '1px 3px', flexShrink: 0,
      }}>{badge.label}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: mono ? 11.5 : 13, fontWeight: 700, color: '#fff',
          fontFamily: mono ? 'monospace' : undefined, letterSpacing: mono ? '0.2px' : '0.5px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</div>
        <div style={{
          fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sub}</div>
      </div>
    </div>
  )
}

function fmtCoord(lat, lon) {
  const f = (v, pad) => {
    const d = Math.floor(Math.abs(v))
    const m = (Math.abs(v) - d) * 60
    return `${String(d).padStart(pad, '0')}°${m.toFixed(1).padStart(4, '0')}'`
  }
  return `${lat >= 0 ? 'N' : 'S'}${f(lat, 2)} ${lon >= 0 ? 'E' : 'W'}${f(lon, 3)}`
}
