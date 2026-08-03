import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePaneActivity } from './PaneActivity'
import { useCardLayout } from './CardLayout'

/* ── Expandable card shell. Used by every checklist item ────── */
export function ExpandableCard({ item, isChecked, onToggle, open, setOpen, children, forceOpen, hideCheckmark }) {
  const { stretch, solo } = useCardLayout()
  // A step with one card has nothing to choose between, so it arrives open.
  const isOpen = forceOpen || solo || open
  // Only a collapsed card divides the height. An open one is as tall as what
  // it contains, and squeezing a map or a chart into a share of the screen is
  // the opposite of what opening it was for.
  const filling = stretch && !isOpen
  usePaneActivity(isOpen)
  const rootRef = useRef(null)
  const wasOpenRef = useRef(open)
  const contentRef = useRef(null)
  const wrapRef = useRef(null)
  const [measuredHeight, setMeasuredHeight] = useState(0)
  // Once the opening animation has finished the cap comes off entirely. A card
  // whose height is pinned to a number measured at open time clips anything
  // that arrives later: a calculated route, a map, a forecast, and because
  // the clipped content cannot make the pane any taller, there is nothing to
  // scroll either. The measurement exists to animate the opening, not to
  // decide how tall the card is allowed to be.
  const [uncapped, setUncapped] = useState(false)
  // Mount content the first time it's opened, then keep it mounted (rather
  // than unmounting on every close) so the max-height transition has real
  // content to measure/animate instead of instantly popping in/out.
  const [everOpened, setEverOpened] = useState(isOpen)

  // Collapsing (e.g. via the Done button inside `children`) shrinks the page's
  // total height. Left alone, the browser clamps scroll position toward the new,
  // shorter bottom, which reads as "jumping to the end of the list" rather than
  // staying on the step the user was just working on. Recenter on this card instead.
  useLayoutEffect(() => {
    if (wasOpenRef.current && !open && rootRef.current) {
      rootRef.current.scrollIntoView({ block: 'center' })
    }
    wasOpenRef.current = open
  }, [open])

  useEffect(() => {
    if (isOpen) setEverOpened(true)
  }, [isOpen])

  // Release the cap a beat after opening, by the clock.
  //
  // This used to wait for transitionend, which sounds right and is not: when a
  // card opens, React mounts the content and sets its max-height in the same
  // commit, so the browser has nothing to animate from and never fires the
  // event. The cap then stayed at whatever the content measured at that instant
  //. 158 px for a card whose content is 930, and the card opened to a sliver
  // that could not be scrolled or interacted with.
  useEffect(() => {
    if (!isOpen) return

    // A page that is not being looked at is not animating anything, and it is
    // exactly where a clock-based release goes wrong, because a hidden page has
    // its timers clamped to about once a second and stops producing frames
    // altogether. That is long enough for a card to sit clipped at the height
    // its content happened to have when it opened, with the map, the forecast
    // and the altitude table below the cut and no way to scroll to them. There
    // is no animation to protect here, so drop the cap at once.
    // Synchronous on purpose: the extra render is the fix. Deferring it is
    // what leaves the card clipped in the very case this branch exists for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (document.visibilityState !== 'visible') { setUncapped(true); return }

    // On a visible page, count the transition out in frames rather than by a
    // timer: frames are what the animation is actually made of, so this stays
    // in step with it whatever the main thread is doing.
    let raf = 0
    const start = performance.now()
    const tick = now => {
      if (now - start >= 320) setUncapped(true)          // transition is 300ms
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    // Backstops: a window that is occluded rather than hidden can stop
    // painting without a visibilitychange, and the timer covers that; the
    // event covers a page hidden part-way through the animation.
    const timer = setTimeout(() => setUncapped(true), 600)
    const onVisibility = () => { if (document.visibilityState !== 'visible') setUncapped(true) }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isOpen])

  // Closing needs a pixel height to animate away from, so the cap goes back on
  // at the card's current size before React renders the zero.
  useLayoutEffect(() => {
    if (isOpen) return
    const el = wrapRef.current
    if (el && el.style.maxHeight === 'none') {
      el.style.maxHeight = `${contentRef.current?.scrollHeight ?? 0}px`
      void el.offsetHeight
    }
    setUncapped(false)
  }, [isOpen])

  // Re-measure while the cap is on, so the opening animation has a real height
  // to travel to even when the content arrives late.
  //
  // Once the cap is off, the observer is disconnected, and that is the point
  // of this, not an optimisation. Observing content whose height is no longer
  // constrained means every measurement can change the layout that produced
  // it: the map settling, a chart drawing, a card re-rendering. Each pass fed
  // the next and the main thread never got a turn, which is what left the
  // checklist unresponsive.
  useLayoutEffect(() => {
    if (!everOpened || uncapped || !contentRef.current || typeof ResizeObserver === 'undefined') return
    const el = contentRef.current
    // scrollHeight is a rounded-down integer while the rendered content can be
    // a fraction taller; +2 keeps the last sliver from being clipped. Ignoring
    // sub-pixel changes stops a measurement that merely rounds differently from
    // scheduling another render.
    const measure = () => {
      const h = el.scrollHeight + 2
      setMeasuredHeight(prev => (Math.abs(prev - h) > 1 ? h : prev))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [everOpened, uncapped])

  const locked = forceOpen || solo
  const Header = locked ? 'div' : 'button'

  return (
    <div ref={rootRef} style={{
      marginBottom: 8,
      ...(filling ? { flex: '1 1 0', minHeight: 46, display: 'flex', flexDirection: 'column' } : null),
    }}>
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: isOpen ? '14px 14px 0 0' : 14,
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
        ...(filling ? { flex: 1, display: 'flex' } : null),
      }}>
        {/* Tappable header */}
        <Header
          onClick={locked ? undefined : () => setOpen(o => !o)}
          style={{
            width: '100%', background: 'none', border: 'none',
            cursor: locked ? 'default' : 'pointer', padding: '13px 14px', textAlign: 'left',
            boxSizing: 'border-box', display: 'block',
            // Centred in the taller card rather than sitting at the top of it.
            ...(filling ? { display: 'flex', flexDirection: 'column', justifyContent: 'center' } : null),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{
              fontSize: 15, fontWeight: 600, letterSpacing: '-0.2px',
              color: isChecked ? 'var(--text)' : 'var(--text-tertiary)',
            }}>{item.label}</span>
            {!hideCheckmark && (
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
            )}
          </div>
        </Header>
      </div>

      {/* Expanded content: connects flush to the card header. Stays mounted
          once opened so max-height has real content to measure/animate. */}
      {everOpened && (
        <div ref={wrapRef}
          // Whichever comes first: the animation finishing, or the timer above.
          onTransitionEnd={e => {
            if (e.target === e.currentTarget && e.propertyName === 'max-height' && isOpen) setUncapped(true)
          }}
          style={{
          maxHeight: isOpen ? (uncapped ? 'none' : measuredHeight) : 0,
          overflow: 'hidden',
          background: 'var(--bg-card)',
          borderRadius: '0 0 14px 14px',
          transition: 'max-height 0.3s cubic-bezier(0.4,0,0.2,1)',
        }}>
          <div ref={contentRef}>
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Shared Done button. Manual tap + optional auto-complete ── */
export function DoneButton({ isChecked, onDone, checkedIds, subIds, autoCheck, onAutoComplete }) {
  const hasChecklist = subIds && subIds.length > 0
  const pct = hasChecklist
    ? subIds.filter(id => checkedIds?.has(id)).length / subIds.length
    : 1
  const complete = isChecked || pct >= 1

  // Auto-mark complete once the card's own content is fully filled. 
  // does not close the card, so the header checkmark can still be tapped to override.
  useEffect(() => {
    if (autoCheck && !isChecked && pct >= 1) onAutoComplete?.()
  }, [autoCheck, isChecked, pct])

  return (
    <div style={{ padding: '10px 14px 12px' }}>
      <button
        onClick={onDone}
        disabled={!complete}
        style={{
          width: '100%', height: 44,
          borderRadius: 10, border: 'none', cursor: complete ? 'pointer' : 'default',
          background: complete ? 'var(--text)' : 'var(--bg-card-2)',
          outline: 'none', WebkitTapHighlightColor: 'transparent',
          fontSize: 14, fontWeight: 600, letterSpacing: '-0.1px',
          color: complete ? 'var(--bg)' : 'var(--text-tertiary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {complete && (
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        Done
      </button>
    </div>
  )
}

/* ── Shared checklist row. Square checkbox + label + optional
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
        padding: '4px 14px', borderRadius: 8, transition: 'background 0.15s',
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
        <span style={{ flex: 1, transition: 'color 0.18s' }}>
          {label.includes(': ') ? (
            <>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.2px' }}>
                {label.split(': ')[0]}
              </span>
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)' }}>
                {' '}{label.split(': ')[1]}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 500, color: checked || disabled ? 'var(--text)' : 'var(--text-tertiary)' }}>{label}</span>
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
