import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { OverlayCloseContext } from '../context/OverlayClose'

export default function CardOverlay({ cardRect, onClose, children }) {
  const [visible, setVisible]   = useState(false)
  const [closing, setClosing]   = useState(false)

  useEffect(() => {
    let id2
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setVisible(true))
    })
    return () => { cancelAnimationFrame(id1); cancelAnimationFrame(id2) }
  }, [])

  function close() {
    setClosing(true)
    setTimeout(onClose, 320)
  }

  const vw = window.innerWidth
  const vh = window.innerHeight
  const { top, left, width, height } = cardRect
  const right  = Math.max(0, vw - left - width)
  const bottom = Math.max(0, vh - top - height)
  const closedClip = `inset(${top}px ${right}px ${bottom}px ${left}px round 20px)`
  const openClip   = 'inset(0px 0px 0px 0px round 22px)'

  const isOpen   = visible && !closing
  const clipPath = isOpen ? openClip : closedClip
  const transition = closing
    ? 'clip-path 300ms cubic-bezier(0.55, 0, 0.8, 0.9)'
    : 'clip-path 420ms cubic-bezier(0.16, 1, 0.3, 1)'

  return createPortal(
    <OverlayCloseContext.Provider value={close}>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'var(--bg)',
        clipPath,
        transition,
        willChange: 'clip-path',
        transform: 'translateZ(0)',
        overflowY: isOpen ? 'auto' : 'hidden',
        overscrollBehavior: 'none',
      }}>
        <div style={{
          opacity: isOpen ? 1 : 0,
          transition: isOpen
            ? 'opacity 200ms ease 100ms'
            : 'opacity 80ms ease',
          minHeight: '100%',
        }}>
          {children}
        </div>
      </div>
    </OverlayCloseContext.Provider>,
    document.body
  )
}
