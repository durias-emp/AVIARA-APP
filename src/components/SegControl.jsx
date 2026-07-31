// Segmented control — sliding highlight over a row of string options.
// Pulled out of Onboarding.jsx into its own module so other pages (Profile,
// Aircraft) can import it without creating a circular dependency with
// Onboarding (which itself imports from Aircraft.jsx).
export function SegControl({ options, value, onChange }) {
  const idx = options.indexOf(value)
  const pct = 100 / options.length
  return (
    <div style={{ display: 'flex', background: 'rgba(120,120,128,0.12)', borderRadius: 'var(--r-sm)', padding: 3, position: 'relative' }}>
      <div style={{
        position: 'absolute', top: 3, bottom: 3,
        left: `calc(${Math.max(0, idx) * pct}% + 3px)`,
        width: `calc(${pct}% - 6px)`,
        background: 'var(--bg-card)',
        borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.06)',
        transition: 'left 0.25s cubic-bezier(0.34, 1.2, 0.64, 1)',
        pointerEvents: 'none',
        opacity: idx >= 0 ? 1 : 0,
      }} />
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          flex: 1, padding: '7px 4px', borderRadius: 6, border: 'none', cursor: 'pointer',
          fontWeight: 600, fontSize: 13,
          background: 'transparent',
          color: value === opt ? 'var(--text)' : 'var(--text-secondary)',
          fontFamily: 'inherit', position: 'relative', zIndex: 1,
          transition: 'color 0.18s',
        }}>{opt}</button>
      ))}
    </div>
  )
}
