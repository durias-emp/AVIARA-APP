import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useTheme } from './hooks/useTheme'
import { PilotProfileProvider, usePilotProfile } from './context/PilotProfile'
import { ActiveAircraftProvider } from './context/ActiveAircraft'
import { RegionProvider } from './context/Region'
import { AuthProvider, useAuth } from './context/AuthContext'
import BackOverrideProvider from './context/BackOverrideProvider'
import Shell from './components/Shell'

const Home        = lazy(() => import('./pages/Home/Home'))
const Calculators = lazy(() => import('./pages/Calculators/Calculators'))
const Checklists  = lazy(() => import('./pages/Checklists/Checklists'))
const Hangar      = lazy(() => import('./pages/Aircraft/Hangar'))
const Currency    = lazy(() => import('./pages/Currency/Currency'))
const Reference   = lazy(() => import('./pages/Reference/Reference'))
const Weather     = lazy(() => import('./pages/Weather/Weather'))
const Onboarding    = lazy(() => import('./pages/Onboarding/Onboarding'))
const Profile       = lazy(() => import('./pages/Profile/Profile'))
const SignIn        = lazy(() => import('./pages/SignIn/SignIn'))
const ResetPassword = lazy(() => import('./pages/SignIn/ResetPassword'))

function AppRoutes({ theme }) {
  const { session, loading: authLoading, hydrated, recovery } = useAuth()
  const { profile, setProfile } = usePilotProfile()
  const navigate = useNavigate()

  // Seed the profile's contact email from the signed-in account (Google/
  // Apple/email all expose user.email) so it's pre-filled without the pilot
  // typing it — only when empty, so a manually-edited value is never
  // overwritten. Phone isn't provided by OAuth, so that stays manual.
  // Must wait for hydration: this effect fires even while the gate renders
  // null, and writing the (still empty) profile mid-restore marked the
  // settings store non-empty — which made the old store-level hydrate skip
  // it entirely, bouncing returning users into onboarding.
  useEffect(() => {
    if (!hydrated) return
    const email = session?.user?.email
    // Only seed a COMPLETED profile. Seeding an empty one materializes a
    // never-onboarded stub row in the settings store, which once poisoned
    // this device's restore (the stub shadowed the real cloud profile).
    if (email && profile?.onboardingComplete && !profile.email) setProfile({ email })
  }, [session, profile, setProfile, hydrated])

  if (authLoading) return null

  // Arrived via a password-reset email link — force the "set new password"
  // screen before anything else, even though Supabase created a recovery
  // session (which would otherwise fall through to the app).
  if (recovery) return (
    <Suspense fallback={null}>
      <ResetPassword />
    </Suspense>
  )

  // Sign-in is required before anything else — no bypass. A pre-existing
  // install (real local data, onboarding already done, no account yet)
  // gets reassuring "back up your data" copy instead of the generic
  // sign-in screen; the actual sign-in flow is identical either way.
  // TEMP LOCAL-ONLY BYPASS (do not commit/push): skip the sign-in gate so
  // the app UI can be viewed without Supabase configured.
  if (!session && false) {
    const legacy = profile != null && profile.onboardingComplete
    return (
      <Suspense fallback={null}>
        <SignIn legacy={legacy} />
      </Suspense>
    )
  }

  // Signed in but the cloud restore is still running — showing the gate now
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
            <Route path="/currency" element={<Currency onBack={() => navigate('/profile')} />} />
            <Route path="/reference" element={<Reference />} />
            <Route path="/weather" element={<Weather />} />
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
      <PilotProfileProvider>
        <ActiveAircraftProvider>
          <RegionProvider>
            <BrowserRouter>
              <AppRoutes theme={theme} />
            </BrowserRouter>
          </RegionProvider>
        </ActiveAircraftProvider>
      </PilotProfileProvider>
    </AuthProvider>
  )
}
