import { useCallback, useContext } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useOverlayClose } from '../context/OverlayClose'
import { BackOverrideContext } from '../context/BackOverride'
import { useSwipeBack } from '../hooks/useSwipeBack'

function IconChevronLeft({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconHouse({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 11.5L12 4l8 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 10v9a1 1 0 0 0 1 1h4v-5a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v5h4a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// Same "go back" resolution as BackButton (onBack prop → close the overlay
// → navigate home), just with a house glyph instead of a chevron — for
// full-bleed screens (the full-screen Map) where a floating icon reads
// better than a titled header row.
export function HomeButton({ onBack }) {
  const navigate     = useNavigate()
  const closeOverlay = useOverlayClose()

  function handleBack() {
    if (onBack)        { onBack();        return }
    if (closeOverlay)  { closeOverlay();  return }
    navigate('/')
  }

  return (
    <button
      onClick={handleBack}
      aria-label="Back to Home"
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        border: 'none',
        background: 'var(--bg-card)',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: 'var(--text)',
        flexShrink: 0,
        WebkitTapHighlightColor: 'transparent',
      }}>
      <IconHouse size={18} />
    </button>
  )
}

export function BackButton({ onBack }) {
  const navigate      = useNavigate()
  const closeOverlay  = useOverlayClose()

  function handleBack() {
    if (onBack)        { onBack();        return }
    if (closeOverlay)  { closeOverlay();  return }
    navigate('/')
  }

  return (
    <button
      onClick={handleBack}
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        border: '0.5px solid var(--border)',
        background: 'var(--bg-card)',
        boxShadow: 'var(--shadow-md)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: 'var(--text)',
        flexShrink: 0,
      }}>
      <IconChevronLeft size={18} />
    </button>
  )
}

export default function Shell({ children }) {
  const location = useLocation()
  const navigate  = useNavigate()
  const backOverride = useContext(BackOverrideContext)
  const isHome = location.pathname === '/'
  // The checklist page owns its own internal scroll (a single active step
  // pane, with a fixed tab bar below it) — letting the outer shell scroll
  // too would create a double-scrollbar fight between the two containers.
  const ownsInternalScroll = location.pathname === '/checklists'

  const handleSwipeBack = useCallback(() => {
    const override = backOverride?.peek?.()
    if (override) { override(); return }
    navigate('/')
  }, [backOverride, navigate])

  // On /checklists, a full-width horizontal drag means "swipe between tabs" —
  // letting the edge-swipe-back gesture also listen there would make a touch
  // starting near the left edge ambiguous between the two. Back navigation
  // stays available via the header's BackButton, so just disable the swipe.
  const swipeRef = useSwipeBack(handleSwipeBack, { disabled: isHome || ownsInternalScroll })

  return (
    <div className="app-shell">
      <main ref={swipeRef} style={{ flex: 1, overflowY: isHome || ownsInternalScroll ? 'hidden' : 'auto', display: ownsInternalScroll ? 'flex' : 'block', flexDirection: 'column', minHeight: 0 }}>
        {children}
      </main>
    </div>
  )
}
