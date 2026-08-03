import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useTheme } from './hooks/useTheme'
import { PilotProfileProvider, usePilotProfile } from './context/PilotProfile'
import { ActiveAircraftProvider } from './context/ActiveAircraft'
import { LogbookProvider } from './context/Logbook'
import { RegionProvider } from './context/Region'
import { AuthProvider, useAuth } from './context/AuthContext'
import { SocialProfileProvider } from './context/SocialProfile'
import BackOverrideProvider from './context/BackOverrideProvider'
import Shell from './components/Shell'

const Home        = lazy(() => import('./pages/Home/Home'))
const Calculators = lazy(() => import('./pages/Calculators/Calculators'))
const Checklists  = lazy(() => import('./pages/Checklists/Checklists'))
const Hangar      = lazy(() => import('./pages/Aircraft/Hangar'))
const Pilot       = lazy(() => import('./pages/Pilot/Pilot'))
const Reference   = lazy(() => import('./pages/Reference/Reference'))
const Weather     = lazy(() => import('./pages/Weather/Weather'))
const LogbookList      = lazy(() => import('./pages/Pilot/LogbookList'))
const LogbookEntryForm = lazy(() => import('./pages/Pilot/LogbookEntryForm'))
const LogbookFields    = lazy(() => import('./pages/Pilot/LogbookFields'))
const LogbookImport    = lazy(() => import('./pages/Pilot/LogbookImport'))
const LogbookScan      = lazy(() => import('./pages/Pilot/LogbookScan'))
const Onboarding    = lazy(() => import('./pages/Onboarding/Onboarding'))
const Profile       = lazy(() => import('./pages/Profile/Profile'))
const SignIn        = lazy(() => import('./pages/SignIn/SignIn'))
const ResetPassword = lazy(() => import('./pages/SignIn/ResetPassword'))


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

  if (!profile.onboardingComplete) return (
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
            <Route path="/profile" element={<Profile />} />
            <Route path="/pilot" element={<Pilot />} />
            <Route path="/logbook" element={<LogbookList />} />
            <Route path="/logbook/fields" element={<LogbookFields />} />
            <Route path="/logbook/import" element={<LogbookImport />} />
            <Route path="/logbook/scan" element={<LogbookScan />} />
            <Route path="/logbook/:id" element={<LogbookEntryForm />} />
            <Route path="/reference" element={<Reference />} />
            <Route path="/weather" element={<Weather />} />
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
