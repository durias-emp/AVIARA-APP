import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { get, put } from '../lib/db'
import { getRuleset } from '../lib/regulations'

const STORE = 'settings'
const KEY   = 'region'
const DEFAULT_REGION = 'us'

const RegionContext = createContext(null)

export function RegionProvider({ children }) {
  const [region, setRegionState] = useState(DEFAULT_REGION)

  useEffect(() => {
    const load = () => get(STORE, KEY).then(row => {
      if (row?.value) setRegionState(row.value)
    })
    load()
    // A cloud restore can land a region choice made on another device after
    // the initial read above already ran — re-read once hydration finishes,
    // same pattern as PilotProfileProvider/ActiveAircraftProvider.
    window.addEventListener('aviara-hydrated', load)
    return () => window.removeEventListener('aviara-hydrated', load)
  }, [])

  const setRegion = useCallback((key) => {
    setRegionState(key)
    put(STORE, { key: KEY, value: key }).catch(() => {})
  }, [])

  return (
    <RegionContext.Provider value={{ region, setRegion, ruleset: getRuleset(region) }}>
      {children}
    </RegionContext.Provider>
  )
}

export function useRegion() {
  return useContext(RegionContext)
}
