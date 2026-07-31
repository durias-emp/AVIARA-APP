import { useEffect, useRef, useState } from 'react'

// Continuously-updating GPS reading for the Map screen's info bar — separate
// from useCurrentLocation (a one-shot [lat,lon] fetch used to center the map
// once and never touched again, on purpose, to dodge a real StrictMode
// double-mount bug). This one uses watchPosition and exposes the full coords
// object (altitude, heading, speed, accuracy) plus a smoothed rate of turn
// and vertical speed derived from consecutive readings.
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
    const id = navigator.geolocation.watchPosition(
      (result) => {
        setStatus('success')
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
      },
      (err) => {
        setStatus('error')
        setError(`Location error (code ${err.code}): ${err.message || 'unknown'}`)
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return { coords, derived, status, error }
}
