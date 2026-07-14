import { IconChevronRight } from '../../../components/Icons'

// ── Shared visual atoms for Reference topic pages ─────────────────────────

// Back-to-grid header used by every topic detail view — matches the app's
// existing card title style (SectionCard in Calculators.jsx) rather than
// full page navigation, since topics are shown inline within one page.
export function TopicHeader({ title, onBack }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <button onClick={onBack} style={{
        width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'var(--bg-card-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, transform: 'rotate(180deg)', color: 'var(--text-secondary)',
      }}>
        <IconChevronRight size={16} />
      </button>
      <h3 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text)', margin: 0 }}>
        {title}
      </h3>
    </div>
  )
}

export function Card({ title, sub, children, style }) {
  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 'var(--r-lg)', padding: 16,
      boxShadow: 'var(--shadow-sm)', ...style,
    }}>
      {title && (
        <div style={{ marginBottom: sub ? 2 : 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.1px' }}>
            {title}
          </div>
          {sub && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>
              {sub}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

// A single label/value row used throughout the topic pages (steps, FAR
// citations, signal meanings).
export function Row({ label, value, last }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 14,
      padding: '10px 0', borderBottom: last ? 'none' : '0.5px solid var(--border)',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export function Disclaimer({ children }) {
  return (
    <div style={{
      fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5,
      textAlign: 'center', padding: '4px 8px',
    }}>
      {children}
    </div>
  )
}
