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
    // A real profile always wins. Nothing found keeps whatever is already
    // loaded, and only falls back to empty when there is nothing at all.
    // The old version assigned unconditionally, so any later read that came
    // back empty, or any failure, downgraded a signed-in pilot to the empty
    // profile, which the gate renders as onboarding. Sign-out reloads the
    // page (see Profile.handleSignOut), so holding a profile here can never
    // leak one account's data into the next.
    const settle = (saved) => setProfileState(prev => saved ?? prev ?? EMPTY_PROFILE)

    // Both the read and its timeout are built per call, and that is the whole
    // point of this function. They used to be created once, outside load(),
    // which broke the re-read after the cloud restore in two separate ways:
    // the promise was already settled, so awaiting it again replayed the
    // pre-restore result (empty) instead of reading the restored row, and the
    // timeout had usually already rejected by then, since hydration involves a
    // network round-trip, so the race rejected immediately and forced the
    // empty profile. A returning pilot signed in, their profile was restored
    // into IndexedDB correctly, and the app still sent them to onboarding.
    const attempt = () => {
      const read = seedDemoData()
        .catch(() => {})
        .then(() => get(STORE, KEY))
      // A blocked IndexedDB open never rejects, it simply never settles, so a
      // catch alone cannot cover it. Whichever finishes first wins; a late
      // read is still applied, because settle runs again when it lands.
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('IndexedDB did not respond in 5s')), 5000))
      return { read, timeout }
    }

    const load = () => {
      const { read, timeout } = attempt()
      read.then(settle).catch(() => {})
      return Promise.race([read, timeout])
        .then(settle)
        .catch(err => {
          console.error('[aviara] profile load failed', err)
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
