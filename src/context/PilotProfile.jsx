import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { get, put } from '../lib/db'

const STORE = 'settings'
const KEY   = 'pilot'

export const EMPTY_PROFILE = {
  key: KEY,
  onboardingComplete: false,
  name: '',
  email: '',
  phone: '',
  dob: '',
  certificate: '',
  ratings: [],
  medClass: null,
  medDate: '',
  lastBFR: '',
  last90Day: '',
  last90Night: '',
  lastIFR: '',
  homeAirport: '',
  units: 'imperial',
  altimeter: 'inhg',
}

const PilotProfileContext = createContext(null)

export function PilotProfileProvider({ children }) {
  const [profile, setProfileState] = useState(null)

  useEffect(() => {
    const load = () => get(STORE, KEY).then(saved => {
      setProfileState(saved ?? EMPTY_PROFILE)
    })
    load()
    // After sign-in, the cloud restore may fill the settings store AFTER the
    // initial read above returned empty — re-read once hydration finishes so
    // a returning user's profile (onboardingComplete etc.) is picked up.
    window.addEventListener('aviara-hydrated', load)
    return () => window.removeEventListener('aviara-hydrated', load)
  }, [])

  const setProfile = useCallback(async (patch) => {
    setProfileState(prev => {
      const next = { ...prev, ...patch }
      put(STORE, next).catch(() => {})
      return next
    })
  }, [])

  return (
    <PilotProfileContext.Provider value={{ profile, setProfile }}>
      {children}
    </PilotProfileContext.Provider>
  )
}

export function usePilotProfile() {
  return useContext(PilotProfileContext)
}
