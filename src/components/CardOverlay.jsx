import { useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import { OverlayCloseContext } from '../context/OverlayClose'
import { BackOverrideContext } from '../context/BackOverride'
import { useSwipeBack } from '../hooks/useSwipeBack'

export default function CardOverlay({ cardRect, onClose, children }) {
  function close() {
    onClose()
  }
  // A nested in-overlay view (e.g. Hangar's detail/wizard steps) can claim
  // the back gesture via useBackOverride — same pattern as Shell.jsx's
  // top-level swipe. Without this, an edge-swipe always closed the whole
  // overlay instead of stepping back one level inside it.
  const backOverride = useContext(BackOverrideContext)
  const handleSwipeBack = useCallback(() => {
    const override = backOverride?.peek?.()
    if (override) { override(); return }
    close()
  }, [backOverride])
  const swipeRef = useSwipeBack(handleSwipeBack)

  return createPortal(
    <OverlayCloseContext.Provider value={close}>
      <div ref={swipeRef} style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'var(--bg)',
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'var(--safe-bottom)',
        overflowY: 'auto',
        overscrollBehavior: 'none',
      }}>
        {children}
      </div>
    </OverlayCloseContext.Provider>,
    document.body
  )
}
