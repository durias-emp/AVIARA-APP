import { ACCENT } from './mapStyle'

// What a pilot can do with a point they just tapped.
//
// Two actions, and only one of them is always possible. Setting the
// destination works from a cold start, so it is the primary and wears the
// accent. Adding a waypoint needs a route to add it to, so it only appears
// once one exists: an action that cannot work is worse than an absent one,
// because the pilot has to press it to find out.
//
// The identifier travels with the position. A route filed as 30NV can be read
// back to a controller and a pair of coordinates cannot, but heliports live in
// a different pack from airports, so the position is what makes it resolvable
// at all.
export default function PopupActions({ onSetDestination, onAddWaypoint, ident, name, lat, lon }) {
  if (!onSetDestination && !onAddWaypoint) return null
  const payload = { ident, name, lat, lon }
  const base = {
    width: '100%', padding: '9px 12px', borderRadius: 9, border: 'none',
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
  }
  return (
    <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {onSetDestination && (
        <button
          onClick={(e) => { e.stopPropagation(); onSetDestination(payload) }}
          style={{ ...base, background: ACCENT, color: '#fff' }}>
          Set as destination
        </button>
      )}
      {onAddWaypoint && (
        <button
          onClick={(e) => { e.stopPropagation(); onAddWaypoint(payload) }}
          style={{ ...base, background: 'var(--map-fill)', color: 'var(--map-ink)' }}>
          Add as waypoint
        </button>
      )}
    </div>
  )
}
