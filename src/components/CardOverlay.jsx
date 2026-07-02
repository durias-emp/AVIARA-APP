import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { OverlayCloseContext } from '../context/OverlayClose'

export default function CardOverlay({ cardRect, onClose, children }) {
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  function close() {
    setClosing(true)
    setTimeout(onClose, 220)
  }

  const isOpen = visible && !closing

  return createPortal(
    <OverlayCloseContext.Provider value={close}>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'var(--bg)',
        opacity: isOpen ? 1 : 0,
        transform: isOpen ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)',
        transition: isOpen
          ? 'opacity 240ms ease, transform 260ms cubic-bezier(0.16, 1, 0.3, 1)'
          : 'opacity 200ms ease, transform 200ms cubic-bezier(0.4, 0, 1, 1)',
        overflowY: isOpen ? 'auto' : 'hidden',
        overscrollBehavior: 'none',
      }}>
        {children}
      </div>
    </OverlayCloseContext.Provider>,
    document.body
  )
}
