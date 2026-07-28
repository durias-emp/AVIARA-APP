import { useEffect, useState } from 'react'

// Shared by the full map screen and the home-screen map preview, so both
// ask for location the same way and show the same fallback message.
// `status` is exposed (not just the final result) so the map screen can
// show a "still waiting" state instead of looking identical to "failed".
export function useCurrentLocation() {
  const [position, setPosition] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('pending') // 'pending' | 'success' | 'error' | 'unsupported'

  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus('unsupported')
      setError('Location is not available on this device.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setStatus('success')
        setPosition([result.coords.latitude, result.coords.longitude])
      },
      (err) => {
        setStatus('error')
        // Includes the raw browser error code/message (not just a generic
        // line) so a "still not working" report can be diagnosed from what's
        // on screen, without needing access to the device's dev console.
        setError(`Location error (code ${err.code}): ${err.message || 'unknown'}`)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  return { position, error, status }
}
