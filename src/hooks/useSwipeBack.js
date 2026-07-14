import { useEffect, useRef } from 'react'

// iOS-style edge-swipe-to-go-back. The gesture must start within EDGE_ZONE
// px of the left edge (so it doesn't fight normal horizontal scrolling/swipe
// carousels elsewhere on the page) and travel right past TRIGGER_DISTANCE
// without drifting too far vertically (so a scroll gesture doesn't trigger it).
const EDGE_ZONE = 28
const TRIGGER_DISTANCE = 80
const MAX_VERTICAL_DRIFT = 60

export function useSwipeBack(onBack, { disabled = false } = {}) {
  const ref = useRef(null)
  const gesture = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || disabled || !onBack) return

    function onTouchStart(e) {
      const t = e.touches[0]
      if (t.clientX > EDGE_ZONE) return
      gesture.current = { startX: t.clientX, startY: t.clientY, tracking: true }
    }
    function onTouchMove(e) {
      const g = gesture.current
      if (!g?.tracking) return
      const t = e.touches[0]
      if (Math.abs(t.clientY - g.startY) > MAX_VERTICAL_DRIFT) g.tracking = false
    }
    function onTouchEnd(e) {
      const g = gesture.current
      gesture.current = null
      if (!g?.tracking) return
      const t = e.changedTouches[0]
      const dx = t.clientX - g.startX
      const dy = Math.abs(t.clientY - g.startY)
      if (dx > TRIGGER_DISTANCE && dy < MAX_VERTICAL_DRIFT) onBack()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [onBack, disabled])

  return ref
}
