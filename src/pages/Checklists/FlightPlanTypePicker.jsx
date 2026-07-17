import { useState } from 'react'

// Only three options are meaningful for this operation: VFR and IFR flights
// are always cross-country, and Local is always flown VFR — so a single
// choice here fully determines both flightRules and crossCountry, instead of
// asking two separate questions.
const OPTIONS = [
  { key: 'VFR',   label: 'VFR',   flightRules: 'VFR', crossCountry: true },
  { key: 'IFR',   label: 'IFR',   flightRules: 'IFR', crossCountry: true },
  { key: 'LOCAL', label: 'Local', flightRules: 'VFR', crossCountry: false },
]

function OptionButton({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: '22px 12px', borderRadius: 14, border: 'none', cursor: 'pointer',
      background: active ? 'var(--text)' : 'var(--bg-card-2)',
      color: active ? 'var(--bg)' : 'var(--text)',
      fontSize: 18, fontWeight: 700, letterSpacing: '-0.2px',
      transition: 'background 0.18s, color 0.18s',
    }}>{label}</button>
  )
}

// First screen of Flight Planning — a single VFR / IFR / Local choice that
// determines both flightRules and crossCountry so the checklist can filter
// its content by them later; for now every combination opens the same
// checklist.
export default function FlightPlanTypePicker({ onComplete }) {
  const [selected, setSelected] = useState(null)
  const canStart = !!selected

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '4px 20px 24px', gap: 28, overflowY: 'auto' }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 10 }}>
          Flight Type
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {OPTIONS.map(o => (
            <OptionButton key={o.key} label={o.label} active={selected?.key === o.key} onClick={() => setSelected(o)} />
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <button
        onClick={() => canStart && onComplete({
          type: selected.key,
          flightRules: selected.flightRules,
          crossCountry: selected.crossCountry,
        })}
        disabled={!canStart}
        style={{
          width: '100%', height: 52, borderRadius: 14, border: 'none',
          cursor: canStart ? 'pointer' : 'default',
          background: canStart ? 'var(--text)' : 'var(--bg-card-2)',
          color: canStart ? 'var(--bg)' : 'var(--text-tertiary)',
          fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px',
          transition: 'background 0.2s, color 0.2s',
        }}
      >Start Checklist</button>
    </div>
  )
}
