// Only three options are meaningful for this operation: VFR and IFR flights
// are always cross-country, and Local is always flown VFR, so a single
// choice here fully determines both flightRules and crossCountry, instead of
// asking two separate questions.
const OPTIONS = [
  { key: 'VFR',   label: 'VFR',   flightRules: 'VFR', crossCountry: true },
  { key: 'IFR',   label: 'IFR',   flightRules: 'IFR', crossCountry: true },
  { key: 'LOCAL', label: 'Local', flightRules: 'VFR', crossCountry: false },
]

function OptionButton({ label, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: '1 1 0', minHeight: 160, borderRadius: 20, border: 'none', cursor: 'pointer',
      background: 'var(--bg-card-2)', color: 'var(--text)',
      fontSize: 32, fontWeight: 800, letterSpacing: '-0.4px',
      transition: 'background 0.15s',
      WebkitTapHighlightColor: 'transparent',
    }}>{label}</button>
  )
}

// First screen of Flight Planning. A single VFR / IFR / Local choice that
// determines both flightRules and crossCountry so the checklist can filter
// its content by them later; for now every combination opens the same
// checklist, so tapping an option starts it immediately (each button is its
// own "start" action, not a selection that needs separate confirming). Big,
// screen-filling buttons: flex:1 stretches them to share the available
// height, and minHeight is a floor in case an ancestor's flex-grow chain
// doesn't hand down as much room as expected.
export default function FlightPlanTypePicker({ onComplete }) {
  return (
    // Scrolls when it has to. The buttons have a 160px floor each, so in a
    // short container — the drawer at its half-open stop — the three of them
    // cannot fit, and without this the last one ("Local") simply sat below
    // the fold with no way to reach it.
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0,
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      padding: '4px 20px 24px', gap: 16,
    }}>
      {OPTIONS.map(o => (
        <OptionButton
          key={o.key}
          label={o.label}
          onClick={() => onComplete({ type: o.key, flightRules: o.flightRules, crossCountry: o.crossCountry })}
        />
      ))}
    </div>
  )
}
