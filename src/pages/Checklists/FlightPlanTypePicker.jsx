// Only three options are meaningful for this operation: VFR and IFR flights
// are always cross-country, and Local is always flown VFR — so a single
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
      flex: 1, borderRadius: 14, border: 'none', cursor: 'pointer',
      background: 'var(--bg-card-2)', color: 'var(--text)',
      fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px',
      transition: 'background 0.15s',
      WebkitTapHighlightColor: 'transparent',
    }}>{label}</button>
  )
}

// First screen of Flight Planning — a single VFR / IFR / Local choice that
// determines both flightRules and crossCountry so the checklist can filter
// its content by them later; for now every combination opens the same
// checklist, so tapping an option starts it immediately (each button is its
// own "start" action, not a selection that needs separate confirming).
export default function FlightPlanTypePicker({ onComplete }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '4px 20px 24px', gap: 14 }}>
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
