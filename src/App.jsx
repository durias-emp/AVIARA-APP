import { Suspense, lazy, useEffect, useState } from 'react'
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
const Onboarding    = lazy(() => import('./pages/Onboarding/Onboarding'))
const Profile       = lazy(() => import('./pages/Profile/Profile'))
const SignIn        = lazy(() => import('./pages/SignIn/SignIn'))
const ResetPassword = lazy(() => import('./pages/SignIn/ResetPassword'))

// Dev only, and stripped from production along with every use of it.
// The numbers that decide whether the app fills the screen live on the device
// and nowhere else: the phone's console does not reach this terminal, and the
// desktop preview reports zero insets, so the only way to see them is to put
// them on the screen being measured.
function ViewportBadge() {
  const [v, setV] = useState(null)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const read = () => {
      const cs = getComputedStyle(document.documentElement)
      const root = document.getElementById('root')
      const shell = document.querySelector('.app-shell, .app-shell--fill')
      setV({
        inner: window.innerHeight,
        client: document.documentElement.clientHeight,
        visual: Math.round(window.visualViewport?.height ?? -1),
        root: root ? Math.round(root.getBoundingClientRect().height) : -1,
        rootScroll: root ? root.scrollHeight : -1,
        shell: shell ? Math.round(shell.getBoundingClientRect().height) : -1,
        shellBottom: shell ? Math.round(window.innerHeight - shell.getBoundingClientRect().bottom) : -1,
        top: cs.getPropertyValue('--safe-top').trim(),
        bot: cs.getPropertyValue('--safe-bottom').trim(),
        standalone: (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) ? 'PWA' : 'browser',
      })
    }
    read()
    const t = setInterval(read, 1000)
    window.visualViewport?.addEventListener('resize', read)
    return () => { clearInterval(t); window.visualViewport?.removeEventListener('resize', read) }
  }, [])
  if (!import.meta.env.DEV || !v) return null
  return (
    <div style={{
      position: 'fixed', left: 6, bottom: 6, zIndex: 2147483647,
      background: 'rgba(255,59,48,0.94)', color: '#fff', font: '600 10px/1.35 monospace',
      padding: '6px 8px', borderRadius: 6, pointerEvents: 'none', maxWidth: '94vw',
    }}>
      {v.standalone} inner{v.inner} client{v.client} vis{v.visual}<br />
      root{v.root} (scroll{v.rootScroll}) shell{v.shell} gap{v.shellBottom}<br />
      safe {v.top} / {v.bot}
    </div>
  )
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

  // Sign-in is required before anything else. A pre-existing install (real
  // local data, onboarding already done, no account yet) gets reassuring
  // "back up your data" copy instead of the generic sign-in screen; the
  // actual sign-in flow is identical either way.
  //
  // The one exception is local development, where signing in on every reload
  // to reach a screen three taps deep is pure friction. It is gated on BOTH
  // import.meta.env.DEV, which Vite hardcodes to false in any production
  // build, so the branch is dead code Rollup strips from the bundle, and an
  // opt-in flag in .env.local, which is gitignored and never reaches the
  // deployment. There is no way to turn this on against the real app.
  const devBypass = import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS === '1'

  if (!session && !devBypass) {
    const legacy = profile != null && profile.onboardingComplete
    return (
      <Suspense fallback={null}>
        <SignIn legacy={legacy} />
      </Suspense>
    )
  }

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
            <Route path="/aircraft" element={<Aircraft />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/currency" element={<Currency />} />
            <Route path="/reference" element={<Reference />} />
            <Route path="/weather" element={<Weather />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Shell>
      <ViewportBadge />
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
