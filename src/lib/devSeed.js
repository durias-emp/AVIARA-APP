import { get, getAll, put } from './db'
import { createAircraft } from './aircraft'

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
//
// The airframe is the real one now, not an invented N407AV, and it carries its
// real counters. The maintenance schedule being built against it is 118 items
// of absolute due values around 17,500 hours and 26,000 cycles: seeded against
// a made-up 1284.6 every one of them reads as thousands of hours out, which is
// not a preview of anything. The pilot above stays fictional; the aircraft has
// to be this aircraft for the numbers to mean what they say.
const DEMO_AIRCRAFT = {
  registration: 'YS-CNA',
  fullName: 'Bell 206B-3 JetRanger III',
  category: 'helicopter',
  pilotName: 'Alex Moreno',
  hobbsTime: 17538.9,
  hobbsUpdatedAt: null,
  // Engine starts. Nothing reads this yet; the maintenance work will, and
  // seeding it now means the item list has both clocks from the first render.
  cyclesCurrent: 25870,
}

// Only ever fills gaps. An existing record means real work happened on this
// device, and silently overwriting it would be a bad trade for a preview
// convenience, so anything already stored is left exactly as it is.
//
// The pilot is seeded with onboardingComplete set, which is the whole reason a
// preview opens on the map instead of asking a demo user to introduce
// themselves.
// Single-flight, for the same reason migrateLegacyAircraft is: in development
// React mounts effects twice, so this runs twice, and both runs read an empty
// hangar before either has written to it. Two aircraft, created in the same
// millisecond. Sharing one promise makes the second caller wait for the first
// rather than repeat its work.
let inFlight = null
export function seedDemoData() {
  if (!DEMO_SEED_ENABLED) return Promise.resolve()
  if (inFlight) return inFlight
  inFlight = runSeed().finally(() => { inFlight = null })
  return inFlight
}

async function runSeed() {

  const pilot = await get('settings', 'pilot').catch(() => null)
  if (!pilot?.onboardingComplete) await put('settings', DEMO_PILOT).catch(() => {})

  // A real hangar entry, not the legacy `profile` record.
  //
  // Seeding `profile` put this in a loop with migrateLegacyAircraft, which
  // exists to promote that record into the hangar and delete it: the seed
  // wrote it, the migration moved it and removed it, and the next launch
  // wrote it again. Before the migration learned to recognise an airframe it
  // already had, that produced one new copy of the aircraft per launch, which
  // is where a hangar full of identical helicopters came from. Even with the
  // dedupe it left the aircraft on screen twice between the two steps.
  //
  // Gated on the hangar being empty rather than on one id being absent, so it
  // seeds a device that has never been used and never a device that has.
  const hangar = await getAll('aircraft').catch(() => [])
  const real = hangar.filter(a => a.id !== 'profile' && !a.deletedAt)
  if (real.length === 0) await createAircraft(DEMO_AIRCRAFT).catch(() => {})
}
