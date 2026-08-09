// The flight rules, under the route.
//
// This choice used to be a full-screen gate: open a flight plan and the first
// thing you got was three big buttons, with the route you had just been editing
// nowhere in sight. The route is the first screen now, and the choice sits
// directly beneath it, so a pilot sees what they are filing and what they are
// filing it as at the same time.
//
// A segmented control rather than three cards, because at this size it is one
// question with three answers, not three actions.

import { FLIGHT_PLAN_TYPES, useFlightPlanType } from '../hooks/useFlightPlanType'

export default function FlightRulesRow() {
  const { value, choose } = useFlightPlanType()

  // Nothing until the stored answer is known. A control that draws unselected
  // and then jumps to VFR a frame later reads as the app changing its mind
  // about the flight.
  if (value === undefined) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{
        fontSize: 'clamp(8px, 2.5vw, 10px)', fontWeight: 600,
        color: 'var(--map-ink-faint)', letterSpacing: '0.4px',
        textTransform: 'uppercase',
      }}>Flight rules</span>

      <div
        // The drag lives on the drawer behind this, and a finger that lands on
        // a button is answering the question rather than moving the sheet.
        onPointerDown={e => e.stopPropagation()}
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 5, padding: 4,
          background: 'var(--map-fill-soft)', borderRadius: 14,
          border: '0.5px solid var(--map-hairline)',
        }}>
        {FLIGHT_PLAN_TYPES.map(o => {
          const on = value?.type === o.key
          return (
            <button
              key={o.key}
              onClick={() => choose(o)}
              aria-pressed={on}
              style={{
                padding: '11px 0', borderRadius: 11, border: 'none',
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13.5, fontWeight: 800, letterSpacing: '0.6px',
                background: on ? 'var(--map-ink)' : 'transparent',
                color: on ? 'var(--map-ink-invert)' : 'var(--map-ink-dim)',
                transition: 'background 0.15s, color 0.15s',
                WebkitTapHighlightColor: 'transparent',
              }}>{o.label}</button>
          )
        })}
      </div>
    </div>
  )
}
