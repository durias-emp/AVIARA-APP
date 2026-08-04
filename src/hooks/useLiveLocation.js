import { useCallback, useEffect, useRef, useState } from 'react'

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
// How long to wait before starting the whole acquisition sequence over. Long
// enough not to hammer a chip that is genuinely struggling, short enough that
// walking out to the aircraft is noticed without the pilot doing anything.
const RETRY_AFTER_MS = 10000

export function useLiveLocation() {
  const [coords, setCoords] = useState(null) // { lat, lon, altFt, accuracyM, headingDeg, speedKt, timestamp }
  const [derived, setDerived] = useState({ rotDegSec: null, vsFpm: null })
  const [status, setStatus] = useState('pending')
  const [error, setError] = useState(null)
  const prev = useRef(null)
  // Bumping this tears the watch down and starts the whole sequence again
  // from scratch. It is what a manual retry drives, and what the automatic
  // one uses too.
  const [attempt, setAttempt] = useState(0)

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
    let retryTimer = null
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
      if (err.code === err.PERMISSION_DENIED) return   // genuinely terminal

      if (!everGotFix && !relaxed) {
        relaxed = true
        navigator.geolocation.clearWatch(watchId)
        watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
          enableHighAccuracy: false, maximumAge: 30000, timeout: 20000,
        })
        return
      }

      // Both attempts have now failed, and this used to be where the hook gave
      // up permanently: `relaxed` stayed true, nothing else was ever tried,
      // and the app sat on "No GPS" until it was fully reloaded. That is
      // exactly wrong for the case it matters most — a cold start indoors, or
      // a phone that has not seen sky yet. The pilot walks out to the aircraft
      // and the app never notices.
      //
      // So keep trying, on a slow cycle. It is cheap next to the alternative,
      // which is a pilot believing the app cannot see GPS at all.
      if (retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        setAttempt(a => a + 1)
      }, RETRY_AFTER_MS)
    }

    watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: true, maximumAge: 1000, timeout: 15000,
    })
    return () => {
      clearTimeout(retryTimer)
      navigator.geolocation.clearWatch(watchId)
    }
  }, [attempt])

  // Offered so the UI can put a retry in front of the pilot rather than making
  // them relaunch the app. Also resets the cycle, so a manual tap goes straight
  // back to a high-accuracy attempt instead of waiting out the timer.
  const retry = useCallback(() => setAttempt(a => a + 1), [])

  return { coords, derived, status, error, retry }
}
