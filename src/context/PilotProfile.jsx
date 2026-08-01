import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { get, put } from '../lib/db'
import { seedDemoData } from '../lib/devSeed'

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
    // The seed runs before the read so a fresh device sees the demo profile on
    // the first pass and renders Home, rather than flashing onboarding and
    // correcting itself. It resolves immediately and writes nothing unless the
    // dev demo flag is on.
    // The gate in App renders nothing while profile is null, so this promise
    // failing to settle is indistinguishable on screen from the app being
    // broken: a white screen, no error, nothing to go on. IndexedDB is the
    // part most likely to do that. It can reject outright, and it can sit
    // open forever when another connection blocks an upgrade. Either way the
    // app must still start, on the empty profile if nothing better is
    // available, so the worst case is onboarding rather than a dead screen.
    const settle = (saved) => setProfileState(saved ?? EMPTY_PROFILE)

    // A blocked IndexedDB open never rejects, it simply never settles, so a
    // catch alone cannot cover it. Whichever finishes first wins; a late read
    // is still applied, because settle runs again when the real value lands.
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('IndexedDB did not respond in 5s')), 5000))

    const read = seedDemoData()
      .catch(() => {})
      .then(() => get(STORE, KEY))

    const load = () => {
      read.then(settle).catch(() => {})
      return Promise.race([read, timeout])
        .then(settle)
        .catch(err => {
          console.error('[aviara] profile load failed, starting empty', err)
          settle(null)
        })
    }
    load()
    // After sign-in, the cloud restore may fill the settings store AFTER the
    // initial read above returned empty. Re-read once hydration finishes so
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
