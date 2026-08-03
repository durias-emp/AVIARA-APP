import { get, put } from './db'

// A fictional pilot and aircraft, written straight into the local stores so a
// fresh device lands on Home instead of onboarding. For looking at real screens
// on a phone preview without typing a profile in first.
//
// Gated the same way as the sign-in bypass in App.jsx: on import.meta.env.DEV,
// which Vite hardcodes to false in any production build so Rollup strips this
// branch out of the bundle, AND on an opt-in flag in .env.local, which is
// gitignored and never reaches the deployment. Neither alone turns it on.
export const DEMO_SEED_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_DEV_DEMO === '1'

// Nobody real. The dates are recent on purpose so the currency and medical
// checks read as in-date rather than showing a wall of expiry warnings.
const DEMO_PILOT = {
  key: 'pilot',
  onboardingComplete: true,
  name: 'Alex Moreno',
  email: 'alex.moreno@example.com',
  phone: '+1 775 555 0142',
  dob: '1989-04-17',
  certificate: 'Commercial',
  ratings: ['Rotorcraft-Helicopter', 'Instrument Helicopter'],
  medClass: 2,
  medDate: '2026-03-12',
  lastBFR: '2026-02-08',
  last90Day: '2026-07-19',
  last90Night: '2026-07-11',
  lastIFR: '2026-06-24',
  homeAirport: 'KRNO',
  units: 'imperial',
  altimeter: 'inhg',
}

// Matches the shape Home reads back in its aircraft/profile effect:
// registration, pilotName, fullName, image, hobbsTime. image is left off, so
// the card falls back to its no-photo layout rather than carrying a stale
// data URL around.
const DEMO_AIRCRAFT = {
  id: 'profile',
  registration: 'N407AV',
  fullName: 'Bell 206B-3 JetRanger III',
  pilotName: 'Alex Moreno',
  hobbsTime: 1284.6,
  hobbsUpdatedAt: null,
}

// Only ever fills gaps. An existing record means real work happened on this
// device, and silently overwriting it would be a bad trade for a preview
// convenience, so anything already stored is left exactly as it is.
export async function seedDemoData() {
  if (!DEMO_SEED_ENABLED) return

  const pilot = await get('settings', 'pilot').catch(() => null)
  if (!pilot?.onboardingComplete) await put('settings', DEMO_PILOT).catch(() => {})

  const aircraft = await get('aircraft', 'profile').catch(() => null)
  if (!aircraft?.registration) await put('aircraft', DEMO_AIRCRAFT).catch(() => {})
}
