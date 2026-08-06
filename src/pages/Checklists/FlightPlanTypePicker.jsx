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
      // The floor is small on purpose. flex 1 1 0 already shares whatever
      // height there is, so this only decides how much room three of them
      // demand when there is not enough. At 160 they demanded 540px, which a
      // full screen has and the drawer does not, so the third option sat off
      // the bottom and a pilot could not see that Local existed.
      flex: '1 1 0', minHeight: 72, borderRadius: 20, border: 'none', cursor: 'pointer',
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
// own "start" action, not a selection that needs separate confirming).
//
// The three share whatever height they are given rather than each claiming a
// fixed one, so this fills a full screen and still fits a half-open drawer.
// All three have to be visible wherever it renders: a choice you cannot see
// is not a choice.
export default function FlightPlanTypePicker({ onComplete }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '4px 20px 24px', gap: 16 }}>
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
