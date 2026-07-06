import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/* ── Expandable card shell — used by every checklist item ────── */
export function ExpandableCard({ item, isChecked, onToggle, open, setOpen, children }) {
  const rootRef = useRef(null)
  const wasOpenRef = useRef(open)

  // Collapsing (e.g. via the Done button inside `children`) shrinks the page's
  // total height. Left alone, the browser clamps scroll position toward the new,
  // shorter bottom — which reads as "jumping to the end of the list" rather than
  // staying on the step the user was just working on. Recenter on this card instead.
  useLayoutEffect(() => {
    if (wasOpenRef.current && !open && rootRef.current) {
      rootRef.current.scrollIntoView({ block: 'center' })
    }
    wasOpenRef.current = open
  }, [open])

  return (
    <div ref={rootRef} style={{ marginBottom: 8 }}>
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
              color: isChecked ? 'var(--text)' : 'var(--text-tertiary)',
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

/* ── Shared checklist row — square checkbox + label + optional
   tooltip / disabled-with-badge state (used by section-specific
   checklist groups, e.g. Aircraft's currency-completed rows). ── */
export function CheckRow({ id, label, checked, onToggle, disabled = false, completedLabel, tooltip }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <button onClick={() => !disabled && onToggle(id)} style={{
        width: '100%', textAlign: 'left', background: 'transparent',
        border: 'none', cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '9px 14px', borderRadius: 8, transition: 'background 0.15s',
      }}>
        {!disabled && (
          <div style={{
            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
            background: checked ? 'var(--accent)' : 'transparent',
            border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.18s',
          }}>
            {checked && (
              <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
                <polyline points="2,6 5,9 10,3" stroke="var(--accent-fg)" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
        )}
        <span style={{ flex: 1, textDecoration: checked && !disabled ? 'line-through' : 'none', transition: 'color 0.18s' }}>
          {label.includes(' — ') ? (
            <>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.2px' }}>
                {label.split(' — ')[0]}
              </span>
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)' }}>
                {' '}{label.split(' — ')[1]}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{label}</span>
          )}
        </span>
        {disabled && completedLabel && (
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#fff',
            background: 'var(--ok)', borderRadius: 20,
            padding: '3px 10px', flexShrink: 0,
          }}>{completedLabel}</div>
        )}
      </button>
      {hovered && tooltip && (
        <div style={{
          position: 'fixed', zIndex: 9999,
          fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
          background: 'var(--bg-card)', borderRadius: 8, padding: '8px 10px',
          border: '0.5px solid var(--border-strong)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          width: 220, pointerEvents: 'none',
          top: 'auto', left: 14,
        }}>
          {tooltip}
        </div>
      )}
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
