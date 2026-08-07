import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useTheme } from './hooks/useTheme'
import { PilotProfileProvider, usePilotProfile } from './context/PilotProfile'
import { ActiveAircraftProvider } from './context/ActiveAircraft'
import { LogbookProvider } from './context/Logbook'
import { RegionProvider } from './context/Region'
import { AuthProvider, useAuth } from './context/AuthContext'
import { SocialProfileProvider } from './context/SocialProfile'
import BackOverrideProvider from './context/BackOverrideProvider'
import { DEMO_SEED_ENABLED } from './lib/devSeed'
import Shell from './components/Shell'

// The redesign's home: a map you fly from. The previous menu-style Home is
// kept at ./pages/Home/Home for reference while this branch settles.
const Home        = lazy(() => import('./pages/Home/MapHome'))
const Calculators = lazy(() => import('./pages/Calculators/Calculators'))
const Checklists  = lazy(() => import('./pages/Checklists/Checklists'))
const Hangar      = lazy(() => import('./pages/Aircraft/Hangar'))
const Pilot       = lazy(() => import('./pages/Pilot/Pilot'))
const FlightDebriefs = lazy(() => import('./pages/Pilot/FlightDebriefs'))
const Reference   = lazy(() => import('./pages/Reference/Reference'))
const Weather     = lazy(() => import('./pages/Weather/Weather'))
const LogbookList      = lazy(() => import('./pages/Pilot/LogbookList'))
const LogbookEntryForm = lazy(() => import('./pages/Pilot/LogbookEntryForm'))
const LogbookFields    = lazy(() => import('./pages/Pilot/LogbookFields'))
const LogbookImport    = lazy(() => import('./pages/Pilot/LogbookImport'))
const LogbookScan      = lazy(() => import('./pages/Pilot/LogbookScan'))
// Four sections that main reached only as panels inside its own menu-style
// Home. This branch replaced that screen, so without addresses of their own
// they would have shipped present but unreachable: code in the bundle with no
// door. Discover mattered most, since the entire social half of the app hung
// off it and only a shared link could open it.
const Discover    = lazy(() => import('./pages/Discover/Discover'))
const AirportInfo = lazy(() => import('./components/AirportInfo'))
const ToolsMenu   = lazy(() => import('./components/ToolsMenu'))
const Settings    = lazy(() => import('./pages/Settings/Settings'))
// Where a shared link lands. Lazy like everything else — a pilot who never
// opens one never downloads them.
const SharedPost    = lazy(() => import('./pages/Discover/SharedLink').then(m => ({ default: m.SharedPost })))
const SharedListing = lazy(() => import('./pages/Discover/SharedLink').then(m => ({ default: m.SharedListing })))
const Onboarding    = lazy(() => import('./pages/Onboarding/Onboarding'))
const Profile       = lazy(() => import('./pages/Profile/Profile'))
const SignIn        = lazy(() => import('./pages/SignIn/SignIn'))
const ResetPassword = lazy(() => import('./pages/SignIn/ResetPassword'))


// Reads the id out of the URL so the Hangar can open on that aircraft. A
// separate component because useParams only works inside a Route element.
function AircraftDetail() {
  const { id } = useParams()
  return <Hangar initialOpenId={id} />
}

function AppRoutes({ theme }) {
  const { session, loading: authLoading, hydrated, recovery } = useAuth()
  const { profile, setProfile } = usePilotProfile()

  // Seed the profile's contact email from the signed-in account (Google/
  // Apple/email all expose user.email) so it's pre-filled without the pilot
  // typing it, only when empty, so a manually-edited value is never
  // overwritten. Phone isn't provided by OAuth, so that stays manual.
  // Must wait for hydration: this effect fires even while the gate renders
  // null, and writing the (still empty) profile mid-restore marked the
  // settings store non-empty, which made the old store-level hydrate skip
  // it entirely, bouncing returning users into onboarding.
  useEffect(() => {
    if (!hydrated) return
    const email = session?.user?.email
    // Only seed a COMPLETED profile. Seeding an empty one materializes a
    // never-onboarded stub row in the settings store, which once poisoned
    // this device's restore (the stub shadowed the real cloud profile).
    if (email && profile?.onboardingComplete && !profile.email) setProfile({ email })
  }, [session, profile, setProfile, hydrated])

  // Dev only, and stripped from production builds along with the branch below.
  // A white screen is whichever of these guards returned null, plus whatever
  // the box measured, and none of that is visible on a phone. Vite forwards
  // console output from the device to the terminal, so this is the fastest
  // way to see which one it actually was.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    console.log('[aviara-gate] ' + JSON.stringify({
      standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      authLoading, hydrated, recovery,
      profile: profile === null ? 'NULL (gate returns nothing)' : (profile.onboardingComplete ? 'complete' : 'onboarding'),
      innerH: window.innerHeight,
      clientH: document.documentElement.clientHeight,
      bodyH: Math.round(document.body.getBoundingClientRect().height),
      rootH: Math.round(document.getElementById('root')?.getBoundingClientRect().height ?? -1),
      safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim(),
      safeBottom: getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom').trim(),
    }))
  }, [authLoading, hydrated, recovery, profile])

  if (authLoading) return null

  // Arrived via a password-reset email link. Force the "set new password"
  // screen before anything else, even though Supabase created a recovery
  // session (which would otherwise fall through to the app).
  if (recovery) return (
    <Suspense fallback={null}>
      <ResetPassword />
    </Suspense>
  )

  // Sign-in is NOT required to use the app — everything here is local-first
  // (IndexedDB) by design, and forcing an account before a first-time
  // visitor (or someone trying it out on someone else's recommendation) can
  // even see the app was pure friction with no corresponding benefit. An
  // account only matters once a pilot wants cross-device backup or a social
  // feature (Friends/DMs, UAP report submission) — those are gated
  // individually, at the point of use, not app-wide. Reachable any time from
  // Profile > Account.

  // Signed in but the cloud restore is still running, showing the gate now
  // would read an empty local profile and bounce a returning user into
  // onboarding (and their redone onboarding would overwrite the backup).
  if (!hydrated) return null

  if (profile === null) return null

  // A demo preview never asks who you are.
  //
  // The seed writes a completed profile before this gate reads one, so in the
  // ordinary case this never fires. It is here for the cases where that is not
  // enough: a device carrying a half-finished profile from an earlier session,
  // a storage state nobody can clear because the thing in front of them IS the
  // onboarding form, or a fresh tunnel address starting from nothing while the
  // seed is still writing. A preview is for looking at the app, and being
  // asked to introduce yourself to it is the one thing it is not for.
  //
  // DEMO_SEED_ENABLED rather than DEV, so it also needs the opt-in flag in
  // .env.local: a developer working ON onboarding still gets to see it. Vite
  // strips the whole branch from production builds.
  if (!profile.onboardingComplete && !DEMO_SEED_ENABLED) return (
    <Suspense fallback={null}>
      <Onboarding />
    </Suspense>
  )

  return (
    <BackOverrideProvider>
      <Shell theme={theme}>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/calc" element={<Calculators />} />
            <Route path="/checklists" element={<Checklists />} />
            <Route path="/aircraft" element={<Hangar />} />
            {/* Straight to one aircraft's own screen. The map home's banner
                links here so tapping your aircraft shows your aircraft rather
                than the list it lives in. */}
            <Route path="/aircraft/:id" element={<AircraftDetail />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/pilot" element={<Pilot />} />
            <Route path="/logbook" element={<LogbookList />} />
            <Route path="/debriefs" element={<FlightDebriefs />} />
            <Route path="/logbook/fields" element={<LogbookFields />} />
            <Route path="/logbook/import" element={<LogbookImport />} />
            <Route path="/logbook/scan" element={<LogbookScan />} />
            <Route path="/logbook/:id" element={<LogbookEntryForm />} />
            <Route path="/reference" element={<Reference />} />
            <Route path="/weather" element={<Weather />} />
            {/* Settings is rendered without `order`/`onMoveRow` on purpose:
                those reordered the cards on main's menu-style Home, and this
                branch's home is a map. The component already guards on them,
                so the reorder block simply doesn't appear, and its back button
                falls through to the map. */}
            <Route path="/discover" element={<Discover />} />
            <Route path="/airports" element={<AirportInfo />} />
            <Route path="/tools" element={<ToolsMenu />} />
            <Route path="/settings" element={<Settings />} />
            {/* Shared links. /m/ is reachable signed out on purpose —
                listings are public in RLS, and an aircraft ad you can't
                send to a buyer without the app isn't much of an ad. */}
            <Route path="/p/:postId" element={<SharedPost />} />
            <Route path="/m/:listingId" element={<SharedListing />} />
            <Route path="/signin" element={<SignIn legacy={profile != null && profile.onboardingComplete} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Shell>
    </BackOverrideProvider>
  )
}

export default function App() {
  const { theme } = useTheme()

  return (
    <AuthProvider>
      <SocialProfileProvider>
        <PilotProfileProvider>
          <ActiveAircraftProvider>
            <LogbookProvider>
              <RegionProvider>
                <BrowserRouter>
                  <AppRoutes theme={theme} />
                </BrowserRouter>
              </RegionProvider>
            </LogbookProvider>
          </ActiveAircraftProvider>
        </PilotProfileProvider>
      </SocialProfileProvider>
    </AuthProvider>
  )
}
