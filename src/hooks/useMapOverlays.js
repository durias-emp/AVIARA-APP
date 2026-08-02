import { useCallback, useEffect, useState } from 'react'
import { get, put } from '../lib/db'

const STORE = 'settings'
const KEY   = 'mapOverlays'
const EVENT = 'aviara-map-overlays'

const DEFAULTS = {
  radar: false,
  flightCategory: false,
  tfr: false,
  airports: false,
  heliports: false,
  seaplaneBases: false,
}

// Persisted, multi-select overlay toggles — separate from useMapLayer's
// single-select base chart. Same load/broadcast pattern so the Home preview
// and the full map screen (if both mounted) stay in sync.
export function useMapOverlays() {
  const [overlays, setOverlaysState] = useState(DEFAULTS)

  useEffect(() => {
    const load = () => get(STORE, KEY).then(saved => {
      if (saved?.value) setOverlaysState({ ...DEFAULTS, ...saved.value })
    })
    load()
    window.addEventListener(EVENT, load)
    return () => window.removeEventListener(EVENT, load)
  }, [])

  const toggleOverlay = useCallback((key) => {
    setOverlaysState(prev => {
      const next = { ...prev, [key]: !prev[key] }
      put(STORE, { key: KEY, value: next })
        .then(() => window.dispatchEvent(new Event(EVENT)))
        .catch(() => {})
      return next
    })
  }, [])

  return { overlays, toggleOverlay }
}
