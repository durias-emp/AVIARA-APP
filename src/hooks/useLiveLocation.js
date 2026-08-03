import { useEffect, useRef, useState } from 'react'

// Continuous GPS watch — the low-level primitive behind both
// HomeLocationProvider (src/context/HomeLocation.jsx, shared by Home's map
// preview and the full Map screen) and AirportDiagram.jsx's own independent
// "you are here" marker, which deliberately runs its own separate instance
// of this hook only while its fullscreen view is open, rather than sharing
// the Home-level watch. Each caller gets its own watchPosition — don't call
// this from two places that might be mounted at the same time, since two
// concurrent high-accuracy geolocation requests were the root of a real bug
// (they contend with each other on real devices and can make both slow or
// fail). Exposes the full coords object (altitude, heading, speed,
// accuracy) plus a smoothed rate of turn and vertical speed derived from
// consecutive readings.
export function useLiveLocation() {
  const [coords, setCoords] = useState(null) // { lat, lon, altFt, accuracyM, headingDeg, speedKt, timestamp }
  const [derived, setDerived] = useState({ rotDegSec: null, vsFpm: null })
  const [status, setStatus] = useState('pending')
  const [error, setError] = useState(null)
  const prev = useRef(null)

  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus('unsupported')
      setError('Location is not available on this device.')
      return
    }

    // Tracks whether we've ever gotten a real fix, and whether we've already
    // dropped down to relaxed accuracy — both survive across watchPosition
    // restarts below, so a restart doesn't just retry the same request.
    let watchId
    let everGotFix = false
    let relaxed = false

    function handleSuccess(result) {
      everGotFix = true
      setStatus('success')
      setError(null)
      const c = result.coords
      const next = {
        lat: c.latitude,
        lon: c.longitude,
        altFt: c.altitude != null ? c.altitude * 3.28084 : null,
        accuracyM: c.accuracy ?? null,
        headingDeg: c.heading ?? null,
        speedKt: c.speed != null ? c.speed * 1.94384 : null,
        timestamp: result.timestamp,
      }
      const p = prev.current
      if (p && next.timestamp > p.timestamp) {
        const dtSec = (next.timestamp - p.timestamp) / 1000
        let rot = null
        if (dtSec >= 0.5 && next.headingDeg != null && p.headingDeg != null) {
          let dh = next.headingDeg - p.headingDeg
          if (dh > 180) dh -= 360
          if (dh < -180) dh += 360
          rot = dh / dtSec
        }
        let vs = null
        if (dtSec >= 0.5 && next.altFt != null && p.altFt != null) {
          vs = ((next.altFt - p.altFt) / dtSec) * 60
        }
        setDerived(d => ({
          rotDegSec: rot != null ? rot : d.rotDegSec,
          vsFpm: vs != null ? vs : d.vsFpm,
        }))
      }
      prev.current = next
      setCoords(next)
    }

    function handleError(err) {
      setStatus('error')
      setError(`Location error (code ${err.code}): ${err.message || 'unknown'}`)
      // A raw high-accuracy GPS fix can be slow or unavailable (weak sky
      // view, chip still warming up) — same story as useCurrentLocation's
      // one-shot retry. watchPosition itself just keeps hammering the same
      // failing request forever with no fallback, so if we've never gotten
      // a fix yet, drop down once to relaxed accuracy (network/cell
      // location, longer window, willing to accept a cached fix) by tearing
      // down this watch and starting a new one — PERMISSION_DENIED is the
      // one code that's genuinely terminal and not worth retrying at all.
      if (!everGotFix && !relaxed && err.code !== err.PERMISSION_DENIED) {
        relaxed = true
        navigator.geolocation.clearWatch(watchId)
        watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
          enableHighAccuracy: false, maximumAge: 30000, timeout: 20000,
        })
      }
    }

    watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: true, maximumAge: 1000, timeout: 15000,
    })
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  return { coords, derived, status, error }
}
