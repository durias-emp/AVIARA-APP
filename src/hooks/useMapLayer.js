import { useCallback, useEffect, useState } from 'react'
import { get, put } from '../lib/db'

const STORE = 'settings'
const KEY   = 'mapLayer'
const EVENT = 'aviara-map-layer'

// 'sectional' (VFR), 'ifrlo', or 'ifrhi'. Shared between the full map screen
// and the home-screen preview so the preview is a real window into the same
// map — whichever chart you last picked follows you to both places, live.
const DEFAULT_LAYER = 'sectional'

export function useMapLayer() {
  const [layer, setLayerState] = useState(DEFAULT_LAYER)

  useEffect(() => {
    const load = () => get(STORE, KEY).then(saved => {
      if (saved?.layer) setLayerState(saved.layer)
    })
    load()
    // Home's preview stays mounted (never unmounts) while the full map is
    // open, so without this it would only ever show the layer from when
    // Home first loaded — this event is what makes switching layers in the
    // full map show up in the preview immediately, not just after a reload.
    window.addEventListener(EVENT, load)
    return () => window.removeEventListener(EVENT, load)
  }, [])

  const setLayer = useCallback((next) => {
    setLayerState(next)
    put(STORE, { key: KEY, layer: next })
      .then(() => window.dispatchEvent(new Event(EVENT)))
      .catch(() => {})
  }, [])

  return { layer, setLayer }
}
