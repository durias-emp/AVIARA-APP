import { useEffect } from 'react'

/* ── Expandable card shell — used by every checklist item ────── */
export function ExpandableCard({ item, isChecked, onToggle, open, setOpen, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
        borderRadius: open ? '14px 14px 0 0' : 14,
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
      }}>
        {/* Tappable header */}
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            width: '100%', background: 'none', border: 'none',
            cursor: 'pointer', padding: '13px 14px', textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: 15, fontWeight: 600, letterSpacing: '-0.2px',
              color: isChecked ? 'var(--text-tertiary)' : 'var(--text)',
            }}>{item.label}</span>
            <div
              onClick={e => { e.stopPropagation(); onToggle(item.id) }}
              style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isChecked ? 'var(--text)' : 'transparent',
                border: `1.5px solid ${isChecked ? 'var(--text)' : 'var(--border-strong)'}`,
                transition: 'all 0.2s', cursor: 'pointer',
              }}
            >
              {isChecked && (
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--bg-card)' }}>
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          </div>
        </button>
      </div>

      {/* Expanded content — connects flush to the card header */}
      {open && (
        <div style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          borderTop: 'none',
          borderRadius: '0 0 14px 14px',
          overflow: 'hidden',
        }}>
          {children}
        </div>
      )}
    </div>
  )
}

/* ── Shared Done button — manual tap + optional auto-complete ── */
export function DoneButton({ isChecked, onDone, checkedIds, subIds, autoCheck, onAutoComplete }) {
  const hasChecklist = subIds && subIds.length > 0
  const pct = hasChecklist
    ? subIds.filter(id => checkedIds?.has(id)).length / subIds.length
    : 1
  const complete = isChecked || pct >= 1

  // Auto-mark complete once the card's own content is fully filled —
  // does not close the card, so the header checkmark can still be tapped to override.
  useEffect(() => {
    if (autoCheck && !isChecked && pct >= 1) onAutoComplete?.()
  }, [autoCheck, isChecked, pct])

  return (
    <div style={{ padding: '10px 14px 12px' }}>
      <button
        onClick={onDone}
        style={{
          position: 'relative', width: '100%', height: 44,
          borderRadius: 10, border: 'none', cursor: 'pointer',
          overflow: 'hidden',
          background: complete ? 'var(--text)' : 'var(--bg-card-2)',
          transition: 'background 0.4s ease', outline: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {!complete && (
          <div style={{
            position: 'absolute', inset: 0,
            width: `${pct * 100}%`,
            background: 'var(--border)',
            transition: 'width 0.4s ease',
            borderRadius: 10,
          }} />
        )}
        <span style={{
          position: 'relative', zIndex: 1,
          fontSize: 14, fontWeight: 600, letterSpacing: '-0.1px',
          color: complete ? 'var(--bg)' : 'var(--text-tertiary)',
          transition: 'color 0.4s ease',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          {complete ? (
            <>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Done
            </>
          ) : 'Done'}
        </span>
      </button>
    </div>
  )
}

/* ── Skeleton loading placeholder ─────────────────────────────── */
export function Bone({ w = '100%', h = 14, r = 6, mb = 0 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: 'var(--border)',
      animation: 'skeleton-pulse 1.4s ease-in-out infinite',
      marginBottom: mb,
      flexShrink: 0,
    }} />
  )
}
