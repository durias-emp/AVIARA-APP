import { useCallback, useEffect, useState } from 'react'

// Shared by the full map screen and the home-screen map preview, so both
// ask for location the same way and show the same fallback message.
// `status` is exposed (not just the final result) so the map screen can
// show a "still waiting" state instead of looking identical to "failed".
//
// `locate` re-runs the same one-shot fetch on demand — used for the map's
// "recenter on me" button only as a fallback, when the continuous live
// watch (useLiveLocation, in MapView) hasn't produced a fix yet. The button
// prefers that live watch when it can: it's already running, so it very
// likely already has a recent reading, where this one-shot fetch has to
// pay a "cold start" cost from scratch — which is why its timeouts here are
// kept tight rather than generous, and why a timeout retries once at lower
// accuracy instead of just giving up.
export function useCurrentLocation() {
  const [position, setPosition] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('pending') // 'pending' | 'success' | 'error' | 'unsupported'
  const [refreshing, setRefreshing] = useState(false)

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('unsupported')
      setError('Location is not available on this device.')
      return
    }
    setRefreshing(true)

    const succeed = (result) => {
      setStatus('success')
      setError(null)
      setRefreshing(false)
      setPosition([result.coords.latitude, result.coords.longitude])
    }
    const failFinal = (err) => {
      setStatus('error')
      setRefreshing(false)
      // Includes the raw browser error code/message (not just a generic
      // line) so a "still not working" report can be diagnosed from what's
      // on screen, without needing access to the device's dev console.
      setError(`Location error (code ${err.code}): ${err.message || 'unknown'}`)
    }

    navigator.geolocation.getCurrentPosition(
      succeed,
      (err) => {
        // A cold high-accuracy fix (GPS chip idle, weak sky view — tree
        // cover, indoors) routinely takes longer than any fixed timeout
        // should block a button tap on. On a timeout specifically, retry
        // once with relaxed settings — network/cell accuracy instead of raw
        // GPS, a longer window, and willing to accept a fix already cached
        // by the OS — rather than surfacing a dead end on the first miss.
        if (err.code === err.TIMEOUT) {
          navigator.geolocation.getCurrentPosition(succeed, failFinal, {
            enableHighAccuracy: false, timeout: 12000, maximumAge: 60000,
          })
          return
        }
        failFinal(err)
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
    )
  }, [])

  useEffect(() => { locate() }, [locate])

  return { position, error, status, refreshing, locate }
}
