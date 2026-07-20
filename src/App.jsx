import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useTheme } from './hooks/useTheme'
import { PilotProfileProvider, usePilotProfile } from './context/PilotProfile'
import { AuthProvider, useAuth } from './context/AuthContext'
import BackOverrideProvider from './context/BackOverrideProvider'
import Shell from './components/Shell'

const Home        = lazy(() => import('./pages/Home/Home'))
const Calculators = lazy(() => import('./pages/Calculators/Calculators'))
const Checklists  = lazy(() => import('./pages/Checklists/Checklists'))
const Aircraft    = lazy(() => import('./pages/Aircraft/Aircraft'))
const Currency    = lazy(() => import('./pages/Currency/Currency'))
const Reference   = lazy(() => import('./pages/Reference/Reference'))
const Weather     = lazy(() => import('./pages/Weather/Weather'))
const Onboarding  = lazy(() => import('./pages/Onboarding/Onboarding'))
const Profile     = lazy(() => import('./pages/Profile/Profile'))
const SignIn      = lazy(() => import('./pages/SignIn/SignIn'))

function AppRoutes({ theme }) {
  const { session, loading: authLoading } = useAuth()
  const { profile } = usePilotProfile()

  if (authLoading) return null

  // Sign-in is required before anything else — no bypass. A pre-existing
  // install (real local data, onboarding already done, no account yet)
  // gets reassuring "back up your data" copy instead of the generic
  // sign-in screen; the actual sign-in flow is identical either way.
  if (!session) {
    const legacy = profile != null && profile.onboardingComplete
    return (
      <Suspense fallback={null}>
        <SignIn legacy={legacy} />
      </Suspense>
    )
  }

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
            <Route path="/aircraft" element={<Aircraft />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/currency" element={<Currency />} />
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
        <BrowserRouter>
          <AppRoutes theme={theme} />
        </BrowserRouter>
      </PilotProfileProvider>
    </AuthProvider>
  )
}
