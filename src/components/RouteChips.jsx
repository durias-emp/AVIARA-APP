// The route, as chips inside a field.
//
// Modelled on ForeFlight's flight plan strip, and the field is the point: the
// chips do not sit on the drawer, they sit in an input, and the empty space
// after the last chip IS the input. Tap it and type the next stop. There is
// no Add button, because the field is the add button, which is exactly how
// the one every pilot already knows works.
//
// Four things a finger can do, each told apart from the other three:
//
//   tap a chip           show me where that is
//   tap its x            take it out, ends included
//   hold, then drag      pick it up and put it somewhere else
//   tap the empty space  type the next stop
//
// Held, the chip actually leaves the strip and rides under the finger; what
// stays behind dims to a placeholder. The lift is the feedback: a chip that
// only changes colour has not been picked up.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getAirports, searchAirports } from '../lib/aerodromes'
import { resolveWaypoint } from '../lib/waypoints'
import { fmtAvCoord } from '../lib/geo'

// How long a finger stays still before a press becomes a pick-up, and how far
// it may stray while it waits. 350ms is the chart's own long-press figure, so
// the two gestures feel like one idea. The slop matters more than the delay:
// a thumb in turbulence never holds perfectly still, and a finger that
// travels early was scrolling the drawer, not grabbing a chip.
const HOLD_MS = 350
const HOLD_SLOP_PX = 10

// One chip. A component rather than a helper so the strip can hand it a ref
// through JSX, which is the shape the hooks compiler recognises as a ref and
// not as a render-time read. It lives at module level because a component
// created inside another remounts on every render of its parent.
//
// The colour says what kind of thing it is, after ForeFlight: an airway is
// tinted apart from the fixes either side of it. The x is on every chip,
// ends included; what removing an end means is the caller's decision.
function Pill({ item, ghost = false, dimmed = false, onRemove, ...rest }) {
  return (
    <span {...rest} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
      background: item.via ? 'rgba(255,159,10,0.18)' : 'var(--map-fill)',
      borderRadius: 999, padding: '6px 7px 6px 12px',
      touchAction: item.fixed ? undefined : 'none',
      cursor: item.fixed ? 'pointer' : 'grab',
      opacity: dimmed ? 0.25 : 1,
      ...(ghost ? {
        // In the air: over everything, following the finger.
        boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
        transform: 'scale(1.08)',
      } : null),
    }}>
      <span style={{
        fontSize: 13.5, fontWeight: 800,
        color: item.via ? '#FF9F0A' : 'var(--map-ink)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        letterSpacing: '0.5px', lineHeight: 1, userSelect: 'none',
      }}>{item.label}</span>
      {!ghost && onRemove && (
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onRemove() }}
          aria-label={`Remove ${item.label}`}
          style={{
            background: 'none', border: 'none', padding: 3, display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            color: item.via ? 'rgba(255,159,10,0.75)' : 'var(--map-ink-faint)',
          }}>
          <svg width={9} height={9} viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  )
}

export default function RouteChips({
  route, onRemoveLeg, onRemoveEnd, onReorder, onAddStop, onFocusPoint,
}) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [airports, setAirports] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const inputRef = useRef(null)

  // The chip in the air, and where it would land.
  const [drag, setDrag] = useState(null)   // { key, x, y }
  const [dropAt, setDropAt] = useState(null)
  const holdTimer = useRef(null)
  const pressed = useRef(null)
  const chipRefs = useRef(new Map())

  // The worldwide list arrives when the field is first entered, not on mount:
  // it is a 2 MB chunk and most glances at the card never type into it.
  useEffect(() => {
    if (!focused || airports) return
    let cancelled = false
    getAirports().then(rows => { if (!cancelled) setAirports(rows) }).catch(() => {})
    return () => { cancelled = true }
  }, [focused, airports])

  useEffect(() => () => clearTimeout(holdTimer.current), [])

  const codeOf = (ident, pos) => {
    if (!ident) return null
    // A dropped point's identifier IS its coordinate, and a coordinate is not
    // a code. Compared against the real formatter rather than sniffed with a
    // pattern, because a fix could legitimately begin with an N and a digit.
    if (pos && ident === fmtAvCoord(pos[0], pos[1])) return 'Point'
    return ident
  }

  // The route as entered, not as expanded. A SID becomes a dozen fixes in
  // `wpts` so the map can draw it; printing all twelve would be a strip of
  // names the pilot never typed, with the one they did nowhere in it.
  const legs = []
  for (const w of route.wpts ?? []) {
    const key = w.via ?? w.name
    if (!key) continue
    if (legs[legs.length - 1]?.key === key) continue
    legs.push({ key, label: key, via: !!w.via, lat: w.lat, lon: w.lon })
  }

  const items = [
    { key: ' dep', label: codeOf(route.dep, route.depPos) ?? 'FROM',
      lat: route.depPos?.[0], lon: route.depPos?.[1], fixed: true },
    ...legs,
    { key: ' dest', label: codeOf(route.dest, route.destPos) ?? 'TO',
      lat: route.destPos?.[0], lon: route.destPos?.[1], fixed: true },
  ]
  const dragItem = drag ? items.find(i => i.key === drag.key) : null

  /* ── The press, and which of three things it turns out to be ───────── */

  function onPointerDown(e, item, index) {
    if (item.fixed) { pressed.current = null; return }
    e.stopPropagation()
    pressed.current = { key: item.key, index, x: e.clientX, y: e.clientY, moved: false }
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => {
      if (!pressed.current || pressed.current.moved) return
      setDrag({ key: item.key, x: pressed.current.x, y: pressed.current.y })
      setDropAt(index)
    }, HOLD_MS)
  }

  function onPointerMove(e) {
    const p = pressed.current
    if (!p) return
    if (!drag) {
      // Still deciding. Past the slop before the timer fires, this was never
      // a press: it is the drawer being scrolled, and the chip lets go.
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > HOLD_SLOP_PX) {
        p.moved = true
        clearTimeout(holdTimer.current)
      }
      return
    }
    e.stopPropagation()
    setDrag(d => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
    setDropAt(indexAt(e.clientX, e.clientY))
  }

  // Where a chip released here would go. Measured off the chips actually on
  // screen rather than from arithmetic on the pointer, because they wrap: on
  // a phone a five-point route is two rows, and the gap between the end of
  // one row and the start of the next is not a distance the pointer crosses.
  function indexAt(x, y) {
    let best = null, bestDist = Infinity
    for (const [key, el] of chipRefs.current) {
      if (!el) continue
      const item = items.find(i => i.key === key)
      if (!item || item.fixed) continue
      const b = el.getBoundingClientRect()
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2
      const d = Math.hypot(x - cx, y - cy)
      if (d < bestDist) {
        bestDist = d
        const i = items.findIndex(it => it.key === key)
        best = x > cx ? i + 1 : i
      }
    }
    return best
  }

  function onPointerUp() {
    clearTimeout(holdTimer.current)
    const p = pressed.current
    pressed.current = null

    if (drag) {
      const from = items.findIndex(i => i.key === drag.key)
      // Clamped to the movable middle: a finger that overshoots an end meant
      // the end it overshot towards.
      const target = Math.max(1, Math.min(items.length - 1, dropAt ?? from))
      setDrag(null); setDropAt(null)
      if (target !== from && target !== from + 1) onReorder?.(drag.key, target - 1)
      return
    }

    // No hold, no travel: a tap, and a tap asks where.
    if (p && !p.moved) {
      const item = items.find(i => i.key === p.key)
      if (item?.lat != null) onFocusPoint?.(item.lat, item.lon)
    }
  }

  /* ── The field's own input ─────────────────────────────────────────── */

  const suggestions = focused ? searchAirports(airports, query, { limit: 5 }) : []

  async function commit(ident, pos) {
    const name = (ident ?? '').trim().toUpperCase()
    if (!name) return
    setBusy(true); setErr(null)
    try {
      // A pick from the list carries its position. Anything typed resolves
      // the way the planner resolves it, so a VOR, a fix and a saved user
      // waypoint all work here, not only airports.
      const at = pos ?? await resolveWaypoint(name)
      if (!at || at.lat == null) { setErr(`${name} not found`); return }
      onAddStop?.({ kind: at.kind ?? 'FIX', name: at.name ?? name, lat: at.lat, lon: at.lon })
      setQuery('')
      // Focus stays, so a route can be typed as a sentence: SAC enter SWR
      // enter, the way the ForeFlight field takes them.
      inputRef.current?.focus()
    } finally { setBusy(false) }
  }

  const marker = (
    <span style={{
      width: 2, alignSelf: 'stretch', minHeight: 22, borderRadius: 1,
      background: 'var(--map-ink)', opacity: 0.7,
    }} />
  )

  return (
    <div style={{ position: 'relative', zIndex: 1 }}>
      {/* The field lets the drag through.
          
          It used to swallow every pointerdown on the theory that a finger in
          the strip is working the route. But the field is 83px of the drawer's
          grab area, mostly empty on a two-point route, and swallowing there
          meant the sheet could not be dragged from the largest thing on it.
          The drawer felt stuck.
          
          The chips and the input stop propagation themselves, which is where
          it belongs: those are targets. Everything between them is the
          drawer's to drag, and a tap that lands on nothing still puts the
          caret in the input. */}
      <div
        onClick={e => { if (e.target === e.currentTarget) inputRef.current?.focus() }}
        style={{
          display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start',
          alignItems: 'center', gap: 7,
          // Two rows of chips, always, whether or not the route needs them.
          //
          // A field that is one row tall until a route outgrows it changes
          // height under the pilot's hand, and the figures below it move every
          // time a point is added or taken out. Sized for two rows from the
          // start, a five-point route wraps into space that was already there
          // and nothing else on the card shifts.
          //
          // 27px a chip plus the 7px between the rows plus 11px of padding
          // top and bottom. Measured off the chips rather than guessed, and
          // the chips are the smaller size again.
          padding: '11px 11px', minHeight: 83, boxSizing: 'border-box',
          background: 'var(--map-fill-soft)', borderRadius: 16,
          border: '0.5px solid var(--map-hairline)',
        }}>
        {items.map((item, i) => (
          <span key={item.key} style={{ display: 'contents' }}>
            {drag && dropAt === i && marker}
            <Pill item={item} dimmed={drag?.key === item.key}
              ref={el => { if (el) chipRefs.current.set(item.key, el); else chipRefs.current.delete(item.key) }}
              onRemove={() => (item.fixed
                ? onRemoveEnd?.(item.key === ' dep' ? 'dep' : 'dest')
                : onRemoveLeg?.(item.key))}
              onPointerDown={e => onPointerDown(e, item, i)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onClick={item.fixed && item.lat != null ? () => onFocusPoint?.(item.lat, item.lon) : undefined} />
            {drag && dropAt === i + 1 && i === items.length - 1 && marker}
          </span>
        ))}

        {/* The rest of the field is the input. No placeholder and no button:
            the affordance is the field itself, and a tap after the last chip
            starts typing there, which is the ForeFlight form this strip is
            taken from. */}
        <input
          ref={inputRef}
          value={query}
          aria-label="Add to route"
          onChange={e => { setQuery(e.target.value.toUpperCase()); setErr(null) }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => { setFocused(false); setQuery('') }, 150)}
          onKeyDown={e => {
            if (e.key === 'Enter') commit(query)
            if (e.key === 'Escape') { setQuery(''); inputRef.current?.blur() }
          }}
          style={{
            flex: '1 0 88px', minWidth: 0, background: 'none', border: 'none',
            padding: '5px 2px', color: 'var(--map-ink)', fontSize: 16,
            outline: 'none',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }} />
      </div>

      {/* Suggestions, under the field and over the figures. The chips stay
          visible while a stop is typed, because a pilot adding a point is
          looking at the points already there; the figures below go stale the
          moment it lands, so covering them costs nothing. */}
      {(suggestions.length > 0 || err || (busy && focused)) && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)',
          zIndex: 30, background: 'var(--map-panel-solid)', borderRadius: 12,
          border: '0.5px solid var(--map-hairline)', overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        }}>
          {busy && <div style={{ padding: '8px 11px', fontSize: 11, color: 'var(--map-ink-faint)' }}>Looking…</div>}
          {err && <div style={{ padding: '8px 11px', fontSize: 11, color: '#FF9F0A' }}>{err}</div>}
          {suggestions.map((a, i) => (
            <button key={a.ident}
              onPointerDown={e => e.stopPropagation()}
              onMouseDown={() => commit(a.ident, { lat: a.lat, lon: a.lon, kind: 'APT', name: a.ident })}
              style={{
                width: '100%', textAlign: 'left', background: 'none', border: 'none',
                borderTop: i > 0 ? '0.5px solid var(--map-hairline)' : 'none',
                padding: '8px 11px', cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 8,
              }}>
              <span style={{
                fontSize: 12, fontWeight: 800, color: 'var(--map-ink)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}>{a.ident}</span>
              <span style={{
                fontSize: 10.5, color: 'var(--map-ink-dim)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{a.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* The picked-up chip, riding under the finger. Portaled to the body:
          the drawer is transformed, and position fixed inside a transform
          resolves against the transform, which would put the ghost half a
          screen away from the finger that is supposed to be holding it. */}
      {dragItem && createPortal(
        <span style={{
          position: 'fixed', left: drag.x, top: drag.y, zIndex: 700,
          transform: 'translate(-50%, -50%)', pointerEvents: 'none',
        }}>
          <Pill item={dragItem} ghost />
        </span>,
        document.body,
      )}
    </div>
  )
}
