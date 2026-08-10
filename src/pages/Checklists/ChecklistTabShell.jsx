import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  activeIndex, onActiveIndexChange, embedded = false, expanded = true, onStepOpenChange,
}) {
  const [dragPx, setDragPx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [footerHeight, setFooterHeight] = useState(0)
  const containerRef = useRef(null)
  const footerRef = useRef(null)
  const gesture = useRef(null)
  const n = sections.length

  // Does this shell scroll, or does it flow into a scroller it does not own?
  //
  // Standalone it scrolls: it is the screen, each pane is as tall as the
  // window and reads like a page. In the map home's drawer it flows, because
  // there the pane is not the top of anything. Above it sit the route, its
  // figures and the flight rules, and while the pane scrolled inside itself
  // those three stayed nailed to the drawer and the plan slid underneath
  // them: open a step and the form disappeared under the rules row that was
  // meant to be part of the same sheet. One scroller, one sheet, everything
  // moving together, which is what the drawer looked like it was promising.
  //
  // Flowing means the panes have no height of their own, so the track is told
  // the height of whichever one is showing. Measured rather than computed:
  // a step opens and closes and the pane grows by however much its form needs.
  const flow = embedded
  const paneRefs = useRef([])
  const [paneH, setPaneH] = useState(0)
  useLayoutEffect(() => {
    if (!flow || typeof ResizeObserver === 'undefined') return
    const el = paneRefs.current[activeIndex]
    if (!el) return
    const read = () => setPaneH(el.offsetHeight)
    read()
    const observer = new ResizeObserver(read)
    observer.observe(el)
    return () => observer.disconnect()
  }, [flow, activeIndex, sections, resetKey])

  // Stable per-section callbacks (created once) so PaneActivityProvider's
  // registration function never changes identity and doesn't churn
  // ExpandableCard's registration effect on every unrelated re-render.
  const [paneOpen, setPaneOpen] = useState(() => sections.map(() => false))
  const onActiveChangeFns = useMemo(() => sections.map((_, i) => (v) => {
    setPaneOpen(prev => (prev[i] === v ? prev : prev.map((p, pi) => (pi === i ? v : p))))
  }), [sections])
  // Open a card and the buttons go, everywhere.
  //
  // They were kept in the drawer on the theory that hiding an in-flow
  // transparent bar buys no room and leaves a bare band under the card. On the
  // phone it is the other way round: the drawer is half a screen, the two
  // buttons and their padding are most of what an open card has to work with,
  // and the pane takes the space back the moment they go rather than leaving a
  // gap. Add Step and Complete Flight Plan are both about the plan as a whole,
  // so neither has anything to say while a pilot is inside one step of it.
  const footerHidden = paneOpen[activeIndex] ?? false

  // Tell whoever is holding this shell that a step wants the room.
  //
  // Inside the map home's drawer that is the difference between a form
  // scrolling away under the drawer's own title and the drawer standing up to
  // full screen so the form has somewhere to be. The same signal already hides
  // the footer, so nothing new is being tracked, only reported.
  useEffect(() => { onStepOpenChange?.(footerHidden) }, [footerHidden, onStepOpenChange])

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
    <div style={{
      display: 'flex', flexDirection: 'column',
      ...(flow ? { flex: '0 0 auto' } : { flex: 1, minHeight: 0 }),
    }}>
      <div
        ref={containerRef}
        style={{
          position: 'relative', overflow: 'hidden', touchAction: 'pan-y',
          ...(flow
            // As tall as the pane on screen, and it eases so that opening a
            // step grows the sheet rather than snapping it.
            ? { flex: '0 0 auto', height: paneH || undefined,
                transition: 'height 0.28s cubic-bezier(0.4,0,0.2,1)' }
            : { flex: 1, minHeight: 0 }),
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div style={{
          display: 'flex',
          width: `${n * 100}%`,
          // Flowing, the panes are their own heights and the track must not
          // stretch them all to the tallest: only the one on screen is
          // measured, and the rest are as tall as they happen to be.
          ...(flow ? { alignItems: 'flex-start' } : { height: '100%' }),
          transform: `translateX(calc(-${activeIndex * (100 / n)}% + ${dragPx}px))`,
          transition: dragging ? 'none' : 'transform 0.32s cubic-bezier(0.4,0,0.2,1)',
        }}>
          {sections.map((section, i) => (
            <div key={section.title}
              ref={el => { paneRefs.current[i] = el }}
              style={{
              width: `${100 / n}%`, flexShrink: 0,
              ...(flow
                ? { height: 'auto', overflow: 'visible' }
                : { height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
                    overscrollBehaviorY: 'contain' }),
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
                    // Stretching shares a pane's spare height between its
                    // collapsed cards. Flowing there is no spare height to
                    // share: the pane is exactly as tall as its cards, and
                    // asking them to divide nothing collapses each to its
                    // 46px floor. Content height is the right answer for
                    // something that scrolls.
                    stretch={!flow && !paneOpen[i]}
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
          // No rule above it. Floating, the bar needs an edge because it sits
          // over content that scrolls under it. In flow it does not: the drawer
          // ends where it ends, and a line drawn across it only cuts the plan
          // in half a second time.
          //
          // The bottom inset is re-applied by hand. The floating bar gets it
          // from .fixed-footer-bar, and dropping that class to put the bar in
          // flow dropped the inset with it: the drawer reaches the true bottom
          // of the screen, so Add Step and Complete Flight Plan sat down in the
          // home indicator's strip. Nothing the desktop preview would ever
          // show, because there the inset is zero.
          ? {
            // No surface of its own. A filled bar inside the drawer draws a
            // second panel on top of the first, which is most of what made the
            // planner look bolted on. The buttons carry their own shape and do
            // not need a slab behind them.
            flexShrink: 0, background: 'transparent',
            paddingBottom: 'var(--safe-bottom)',
            display: footerHidden ? 'none' : 'block',
          }
          : { transform: footerHidden ? 'translateY(calc(100% + 24px + var(--safe-bottom)))' : 'translateY(0)' }}
      >
        {/* The numbered step menu, on the same rule as the buttons under it.
            Full screen it costs nothing and it is the only way to reach the
            other four groups without knowing that the panes swipe, which is a
            gesture with nothing on screen to advertise it: from the Route
            group, Performance, Airport, Aircraft and Pilot were unreachable
            by anyone who had not discovered the swipe.

            Below full screen it goes, and that has not changed. In a
            half-height drawer it and the buttons took 132px off a panel that
            is already short, which was enough to hide the third of the three
            Route cards. There the swipe is the way. */}
        {(!embedded || expanded) && (
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
