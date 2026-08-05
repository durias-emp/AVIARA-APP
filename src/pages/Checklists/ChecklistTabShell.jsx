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

/* ── Full-screen tabbed step navigation, one section per tab,
   fixed tab bar at the bottom, sections slide horizontally as a
   single translated track. Index-based positioning makes tap
   navigation direction-correct automatically; a drag gesture on
   top lets the same track be swiped between adjacent panes. ── */
export default function ChecklistTabShell({
  sections, resetKey, checked, onToggle, total,
  customItems, onDeleteCustomItem, onUpdateCustomItemValue, completeBar,
  activeIndex, onActiveIndexChange, embedded = false,
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
  //
  // Embedded, it cannot be fixed at all. The map home's drawer is moved with
  // a transform, and a transformed ancestor becomes the containing block for
  // its fixed descendants: bottom:0 would resolve against the drawer's own
  // box, which is a full screen tall and mostly below the fold, putting the
  // tab bar off the bottom of the phone. In flow at the end of the column it
  // lands on the drawer's real bottom edge, and the panes need no padding
  // because nothing is floating over them any more.
  useLayoutEffect(() => {
    const el = footerRef.current
    if (embedded || !el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setFooterHeight(el.offsetHeight))
    observer.observe(el)
    setFooterHeight(el.offsetHeight)
    return () => observer.disconnect()
  }, [embedded])

  function onTouchStart(e) {
    // Gestures that start on a map belong to the map (pan/zoom/long-press). 
    // never turn them into tab swipes. This was the "glitchy map" bug: any
    // horizontal pan on the route map dragged the whole checklist sideways.
    if (e.target.closest?.('.leaflet-container')) return
    const t = e.touches[0]
    gesture.current = {
      startX: t.clientX,
      startY: t.clientY,
      width: containerRef.current?.clientWidth || 1,
      tracking: true,
      // Nothing is a swipe until it proves horizontal. Flipping state on every
      // touchstart re-rendered the track, including its transition property. 
      // at the instant a finger landed, which is enough for iOS to abandon the
      // scroll it was about to start.
      committed: false,
    }
  }

  function onTouchMove(e) {
    const g = gesture.current
    if (!g?.tracking) return
    const t = e.touches[0]
    const dx = t.clientX - g.startX
    const dy = Math.abs(t.clientY - g.startY)

    // Vertical-dominant gesture: this is a scroll, not a tab swipe. Bail out
    // and let the pane's own overflowY handle it, without touching state:
    // a re-render here lands mid-scroll.
    if (dy > MAX_VERTICAL_DRIFT && dy > Math.abs(dx)) {
      g.tracking = false
      if (g.committed) { setDragging(false); setDragPx(0) }
      return
    }

    // Horizontal enough to be a swipe, only now does the track start moving.
    if (!g.committed) {
      if (Math.abs(dx) < MAX_VERTICAL_DRIFT) return
      g.committed = true
      setDragging(true)
    }

    let clamped = dx
    if (activeIndex === 0 && dx > 0) clamped = dx * EDGE_RESISTANCE
    if (activeIndex === n - 1 && dx < 0) clamped = dx * EDGE_RESISTANCE
    setDragPx(clamped)
  }

  function onTouchEnd() {
    const g = gesture.current
    gesture.current = null
    if (!g?.committed) return          // a scroll, or a tap: nothing to settle
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
            <div key={section.title} style={{
              width: `${100 / n}%`, flexShrink: 0, height: '100%',
              overflowY: 'auto', WebkitOverflowScrolling: 'touch',
              overscrollBehaviorY: 'contain',
              // A flex column so the content column can be told to fill the
              // pane's height. A percentage min-height would resolve against
              // an auto-height parent and quietly do nothing.
              display: 'flex', flexDirection: 'column',
            }}>
              {/* The pane itself spans the whole window so a wheel anywhere
                  over it scrolls; the reading width lives here instead. */}
              <div className="content-column" style={{
                paddingBottom: footerHeight,
                // Grow past the pane when the content is taller, fill it when
                // it is shorter, which is what lets collapsed cards share the
                // screen instead of stacking at the top of it.
                flex: '1 0 auto', display: 'flex', flexDirection: 'column',
              }}>
                <PaneActivityProvider onActiveChange={onActiveChangeFns[i]}>
                  <StepPane
                    key={`${section.title}-${resetKey}`}
                    stretch={!paneOpen[i]}
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
        className={embedded ? undefined : 'fixed-footer-bar'}
        style={embedded
          // Sits at the bottom of the drawer, and gets out of the way while a
          // card is open exactly as the floating version does. Out of flow
          // rather than slid off the bottom, because in flow that is what
          // hands the space back: a drawer at half a screen has perhaps two
          // hundred pixels for an open card, and this is most of them.
          ? {
            flexShrink: 0, background: 'var(--bg-card)',
            borderTop: '0.5px solid var(--border)',
            display: footerHidden ? 'none' : 'block',
          }
          : { transform: footerHidden ? 'translateY(calc(100% + 24px + var(--safe-bottom)))' : 'translateY(0)' }}
      >
        {/* The numbered step menu is dropped inside the drawer.
            Full screen it costs nothing, but in the drawer it and the buttons
            below it took 132px off a panel that is already short, which was
            enough to hide the third of the three cards in the Route group.
            The panes are swipeable (see onTouchStart above), so this is the
            one control here that has another way to do its job. The buttons
            below do not, which is why they stay. */}
        {!embedded && (
          <StepTabBar
            sections={sections}
            activeIndex={activeIndex}
            onSelect={onActiveIndexChange}
            checked={checked}
            customItems={customItems}
          />
        )}
        {completeBar}
      </div>
    </div>
  )
}
