// The app's bottom drawer.
//
// The chrome here is not new: it is FlightDetailDrawer's, value for value, and
// that is the point. A drawer that is nearly the same as the others is worse
// than one that is obviously different, because it reads as the same thing
// behaving oddly. Extracted so a third and fourth one cannot drift.
//
// FlightDetailDrawer and the checklist's add-item drawer still carry their own
// copies. They should adopt this when they are next touched; they were not
// changed here because they work and this is not their change.
//
// Portaled to the body: the pages this opens over are inside scroll containers
// and transformed shells, either of which would trap a fixed child.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export default function Drawer({ onClose, zIndex = 300, children }) {
  // Mounted off screen and slid up on the next frame. Setting the final
  // position in the same paint as the mount gives no transition at all, and
  // the drawer appears rather than arrives.
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Closing runs the animation first and tells the parent afterwards, so the
  // drawer slides out instead of vanishing. 260ms against a 280ms transition:
  // the last twenty milliseconds are imperceptible and waiting for them makes
  // the tap feel slow.
  function close() {
    setVisible(false)
    setTimeout(onClose, 260)
  }

  return createPortal(
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex,
        background: visible ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)',
        backdropFilter: visible ? 'blur(6px)' : 'blur(0px)',
        WebkitBackdropFilter: visible ? 'blur(6px)' : 'blur(0px)',
        transition: 'background 0.26s ease, backdrop-filter 0.26s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          maxHeight: '86vh', overflowY: 'auto', overscrollBehavior: 'contain',
          background: 'var(--bg-card)',
          borderRadius: '24px 24px 0 0',
          border: '0.5px solid var(--border)', borderBottom: 'none',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.35)',
          padding: '10px 20px calc(var(--safe-bottom) + 24px)',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 14px' }}>
          <div style={{ width: 36, height: 5, borderRadius: 3, background: 'var(--border-strong)' }} />
        </div>

        {/* Children get the closer, so a Cancel or Close button inside runs the
            same animation as the backdrop rather than cutting it. */}
        {typeof children === 'function' ? children({ close }) : children}
      </div>
    </div>,
    document.body,
  )
}
