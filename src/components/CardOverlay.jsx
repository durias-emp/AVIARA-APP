import { createPortal } from 'react-dom'
import { OverlayCloseContext } from '../context/OverlayClose'

export default function CardOverlay({ cardRect, onClose, children }) {
  function close() {
    onClose()
  }

  return createPortal(
    <OverlayCloseContext.Provider value={close}>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'var(--bg)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        overflowY: 'auto',
        overscrollBehavior: 'none',
      }}>
        {children}
      </div>
    </OverlayCloseContext.Provider>,
    document.body
  )
}
