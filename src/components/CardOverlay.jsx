import { createPortal } from 'react-dom'
import { OverlayCloseContext } from '../context/OverlayClose'
import { useSwipeBack } from '../hooks/useSwipeBack'

export default function CardOverlay({ cardRect, onClose, children }) {
  function close() {
    onClose()
  }
  const swipeRef = useSwipeBack(close)

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
