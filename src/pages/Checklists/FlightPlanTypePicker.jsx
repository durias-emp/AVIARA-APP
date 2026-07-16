import { useState } from 'react'

const RULES_OPTIONS = [
  { key: 'VFR', label: 'VFR' },
  { key: 'IFR', label: 'IFR' },
]

const KIND_OPTIONS = [
  { key: 'LOCAL', label: 'Local' },
  { key: 'XC',    label: 'Cross Country' },
]

function OptionButton({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '18px 12px', borderRadius: 14, border: 'none', cursor: 'pointer',
      background: active ? 'var(--text)' : 'var(--bg-card-2)',
      color: active ? 'var(--bg)' : 'var(--text)',
      fontSize: 16, fontWeight: 700, letterSpacing: '-0.2px',
      transition: 'background 0.18s, color 0.18s',
    }}>{label}</button>
  )
}

// First screen of Flight Planning — picks flight rules (VFR/IFR) and flight
// kind (Local/Cross Country). Both are stored so the checklist can filter its
// content by them later; for now every combination opens the same checklist.
export default function FlightPlanTypePicker({ onComplete }) {
  const [rules, setRules] = useState(null)
  const [kind, setKind]   = useState(null)
  const canStart = rules && kind

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '4px 20px 24px', gap: 28, overflowY: 'auto' }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 10 }}>
          Flight Rules
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {RULES_OPTIONS.map(o => (
            <OptionButton key={o.key} label={o.label} active={rules === o.key} onClick={() => setRules(o.key)} />
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 10 }}>
          Flight Type
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {KIND_OPTIONS.map(o => (
            <OptionButton key={o.key} label={o.label} active={kind === o.key} onClick={() => setKind(o.key)} />
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <button
        onClick={() => canStart && onComplete({ rules, kind })}
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
