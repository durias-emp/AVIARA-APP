import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import StepPane from './sections/StepPane'
import StepTabBar from './shared/StepTabBar'
import { PaneActivityContext } from './shared/PaneActivity'

const SWIPE_THRESHOLD_FRACTION = 0.18   // fraction of pane width to commit a tab change
const EDGE_RESISTANCE = 0.35            // drag damping past the first/last pane
const MAX_VERTICAL_DRIFT = 40           // cancels the drag, defers to normal vertical scroll

// Tracks how many currently-open ExpandableCards live within one pane, so
// the floating footer can hide itself while the pilot is working inside an
// expanded card and come back once every card in view is collapsed again.
function PaneActivityProvider({ onActiveChange, children }) {
  const openSet = useRef(new Set())
  const value = useMemo(() => ({
    register(token) {
      openSet.current.add(token)
      onActiveChange(true)
      return () => {
        openSet.current.delete(token)
        onActiveChange(openSet.current.size > 0)
      }
    },
  }), [onActiveChange])

  return <PaneActivityContext.Provider value={value}>{children}</PaneActivityContext.Provider>
}

/* ── Full-screen tabbed step navigation — one section per tab,
   fixed tab bar at the bottom, sections slide horizontally as a
   single translated track. Index-based positioning makes tap
   navigation direction-correct automatically; a drag gesture on
   top lets the same track be swiped between adjacent panes. ── */
export default function ChecklistTabShell({
  sections, resetKey, checked, onToggle, total,
  customItems, onDeleteCustomItem, onUpdateCustomItemValue, completeBar,
  activeIndex, onActiveIndexChange,
}) {
  const [dragPx, setDragPx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [footerHeight, setFooterHeight] = useState(0)
  const containerRef = useRef(null)
  const footerRef = useRef(null)
  const gesture = useRef(null)
  const n = sections.length

  // Stable per-section callbacks (created once) so PaneActivityProvider's
  // registration function never changes identity and doesn't churn
  // ExpandableCard's registration effect on every unrelated re-render.
  const [paneOpen, setPaneOpen] = useState(() => sections.map(() => false))
  const onActiveChangeFns = useMemo(() => sections.map((_, i) => (v) => {
    setPaneOpen(prev => (prev[i] === v ? prev : prev.map((p, pi) => (pi === i ? v : p))))
  }), [sections])
  const footerHidden = paneOpen[activeIndex] ?? false

  // The footer (tab bar + action buttons) is position:fixed to the real
  // viewport bottom, immune to any dvh/ancestor-height mismatch. Panes pad
  // their bottom by its measured height so content never sits underneath it.
  useLayoutEffect(() => {
    const el = footerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setFooterHeight(el.offsetHeight))
    observer.observe(el)
    setFooterHeight(el.offsetHeight)
    return () => observer.disconnect()
  }, [])

  function onTouchStart(e) {
    // Gestures that start on a map belong to the map (pan/zoom/long-press) —
    // never turn them into tab swipes. This was the "glitchy map" bug: any
    // horizontal pan on the route map dragged the whole checklist sideways.
    if (e.target.closest?.('.leaflet-container')) return
    const t = e.touches[0]
    gesture.current = {
      startX: t.clientX,
      startY: t.clientY,
      width: containerRef.current?.clientWidth || 1,
      tracking: true,
    }
    setDragging(true)
  }

  function onTouchMove(e) {
    const g = gesture.current
    if (!g?.tracking) return
    const t = e.touches[0]
    const dx = t.clientX - g.startX
    const dy = Math.abs(t.clientY - g.startY)

    // Vertical-dominant gesture — this is a scroll, not a tab swipe. Bail out
    // and let the pane's own overflowY handle it.
    if (dy > MAX_VERTICAL_DRIFT && dy > Math.abs(dx)) {
      g.tracking = false
      setDragging(false)
      setDragPx(0)
      return
    }

    let clamped = dx
    if (activeIndex === 0 && dx > 0) clamped = dx * EDGE_RESISTANCE
    if (activeIndex === n - 1 && dx < 0) clamped = dx * EDGE_RESISTANCE
    setDragPx(clamped)
  }

  function onTouchEnd() {
    const g = gesture.current
    gesture.current = null
    setDragging(false)

    if (g?.tracking) {
      const threshold = g.width * SWIPE_THRESHOLD_FRACTION
      if (dragPx < -threshold && activeIndex < n - 1) onActiveIndexChange(activeIndex + 1)
      else if (dragPx > threshold && activeIndex > 0) onActiveIndexChange(activeIndex - 1)
    }
    setDragPx(0)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div
        ref={containerRef}
        style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', touchAction: 'pan-y' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div style={{
          display: 'flex',
          width: `${n * 100}%`,
          height: '100%',
          transform: `translateX(calc(-${activeIndex * (100 / n)}% + ${dragPx}px))`,
          transition: dragging ? 'none' : 'transform 0.32s cubic-bezier(0.4,0,0.2,1)',
        }}>
          {sections.map((section, i) => (
            <div key={section.title} style={{ width: `${100 / n}%`, flexShrink: 0, height: '100%', overflowY: 'auto' }}>
              <div style={{ paddingBottom: footerHeight }}>
                <PaneActivityProvider onActiveChange={onActiveChangeFns[i]}>
                  <StepPane
                    key={`${section.title}-${resetKey}`}
                    section={section}
                    checked={checked}
                    onToggle={onToggle}
                    total={total}
                    customItems={customItems}
                    onDeleteCustomItem={onDeleteCustomItem}
                    onUpdateCustomItemValue={onUpdateCustomItemValue}
                  />
                </PaneActivityProvider>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        ref={footerRef}
        className="fixed-footer-bar"
        style={{ transform: footerHidden ? 'translateY(calc(100% + 24px + env(safe-area-inset-bottom, 0px)))' : 'translateY(0)' }}
      >
        <StepTabBar
          sections={sections}
          activeIndex={activeIndex}
          onSelect={onActiveIndexChange}
          checked={checked}
          customItems={customItems}
        />
        {completeBar}
      </div>
    </div>
  )
}
