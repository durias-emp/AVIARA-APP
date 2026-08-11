import { useState } from 'react'
import { resolveRouteText } from '../lib/routeText'

// Top-of-map route entry — ForeFlight-style "type a route, see it drawn".
// Deliberately scoped down from the full Route & Altitude planner in Flight
// Planning (airway expansion, terrain/water/airspace analysis, draggable
// waypoints): this is just "give the map a route" so the GPS info bar has a
// destination/next-waypoint to measure against.
export default function FlightPlanBar({ onRouteChange }) {
  const [text, setText] = useState('')
  const [resolving, setResolving] = useState(false)
  const [badTokens, setBadTokens] = useState([])

  async function submit() {
    if (text.trim().split(/\s+/).filter(Boolean).length < 2) {
      setBadTokens([])
      onRouteChange(null)
      return
    }
    setResolving(true)
    const { points, bad } = await resolveRouteText(text)
    setResolving(false)
    setBadTokens(bad)
    onRouteChange(points.length >= 2 ? points : null)
  }

  function clear() {
    setText('')
    setBadTokens([])
    onRouteChange(null)
  }

  return (
    <div style={{
      position: 'absolute', top: 'calc(12px + var(--map-top-inset, 0px))', left: 'calc(12px + var(--map-left-inset, 52px))', right: 12, zIndex: 600,
      background: 'var(--bg-card)', borderRadius: 14, boxShadow: 'var(--shadow-sm)',
      padding: '4px 6px 4px 14px', display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 700 }}>Route</span>
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); submit() } }}
        placeholder="KJFK KBOS"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        style={{
          flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
          fontSize: 15, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.04em',
          color: 'var(--text)',
        }}
      />
      {text && (
        <button onClick={clear} style={{
          flexShrink: 0, width: 26, height: 26, borderRadius: 13, border: 'none',
          background: 'var(--bg-card-2)', color: 'var(--text-secondary)', fontSize: 14,
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}>✕</button>
      )}
      <button
        onClick={submit}
        disabled={resolving}
        style={{
          flexShrink: 0, padding: '7px 14px', borderRadius: 10, border: 'none',
          background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 700,
          cursor: resolving ? 'default' : 'pointer', opacity: resolving ? 0.6 : 1,
        }}>
        {resolving ? '…' : 'Go'}
      </button>

      {badTokens.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
          background: 'var(--bg-card)', borderRadius: 10, boxShadow: 'var(--shadow-sm)',
          padding: '8px 12px', fontSize: 12, color: 'var(--danger)', fontWeight: 600,
        }}>
          Not found: {badTokens.join(', ')}
        </div>
      )}
    </div>
  )
}
