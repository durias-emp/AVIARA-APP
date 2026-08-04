import { useEffect, useRef, useState } from 'react'

// Keeps the screen awake while something is being recorded.
//
// This does not give the app background execution — nothing available to a web
// app does. What it does is remove the most common reason a recording stops:
// the screen dimming on its own timer while the phone sits on the glareshield.
// A pilot who starts the timer and puts the phone down is otherwise recording
// for about thirty seconds.
//
// The lock is released by the browser whenever the page is hidden, and it is
// NOT restored on the way back — so re-acquiring on visibilitychange is not
// belt-and-braces, it is the difference between the lock surviving one glance
// at another app and not.
//
// Fails quietly. It is unsupported on some browsers, and a request can be
// refused outright (low battery, for one). Losing the screen lock should cost
// the recording nothing that it was not already going to lose.
export function useWakeLock(active) {
  const lockRef = useRef(null)
  const [held, setHeld] = useState(false)

  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.wakeLock) return
    let cancelled = false

    async function acquire() {
      if (cancelled || document.visibilityState !== 'visible' || lockRef.current) return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) { lock.release().catch(() => {}); return }
        lockRef.current = lock
        setHeld(true)
        lock.addEventListener('release', () => {
          lockRef.current = null
          setHeld(false)
        })
      } catch { /* unsupported, or refused — carry on without it */ }
    }

    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      lockRef.current?.release().catch(() => {})
      lockRef.current = null
      setHeld(false)
    }
  }, [active])

  return held
}
