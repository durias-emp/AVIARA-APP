import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { hydrateFromCloud, pushAllToCloud, retryPendingPushes } from '../lib/sync'
import { trackEvent } from '../lib/analytics'

const AuthContext = createContext(null)

// session: undefined = still loading from local storage (no network needed. 
// see src/lib/supabase.js), null = signed out, object = signed in.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  // True while the user arrived via a password-reset email link. The app
  // shows the "set a new password" screen instead of the normal gate, even
  // though Supabase has technically created a session from the recovery
  // token. Cleared once the new password is saved.
  const [recovery, setRecovery] = useState(false)
  // False while the post-sign-in cloud restore is running. The app gate must
  // wait for it: reading the (still empty) local profile mid-restore sent
  // returning users to onboarding, and re-completing onboarding would then
  // overwrite their cloud backup.
  const [hydrated, setHydrated] = useState(true)
  const syncedRef = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession ?? null)

      if (event === 'PASSWORD_RECOVERY') {
        setRecovery(true)
      }

      // Runs on every sign-in (fresh account, restored session, or a
      // pre-existing local install linking an account for the first time).
      // hydrateFromCloud() only fills stores that are empty locally, so it
      // never clobbers real data already on this device; pushAllToCloud()
      // right after is what turns pre-existing local data into a cloud
      // backup the very first time someone signs in. Guarded so it only
      // fires once per session, not on every token refresh.
      // INITIAL_SESSION = app launch with a persisted session. Hydrating on
      // launch (not just fresh sign-ins) keeps the local copy self-healing:
      // if anything corrupted the local profile, the per-row restore + the
      // never-onboarded-stub tiebreak repair it from the cloud backup on the
      // next open.
      if ((event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && newSession)) && !syncedRef.current) {
        syncedRef.current = true
        trackEvent('sign_in')
        setHydrated(false)
        hydrateFromCloud()
          .then(() => pushAllToCloud())
          .catch(() => {})
          .finally(() => {
            setHydrated(true)
            // Local stores may have just been filled from the cloud. 
            // anything that cached a pre-hydration read must re-read.
            window.dispatchEvent(new Event('aviara-hydrated'))
          })
      }
      if (event === 'SIGNED_OUT') {
        syncedRef.current = false
        setRecovery(false)
      }
    })

    const onOnline = () => retryPendingPushes().catch(() => {})
    window.addEventListener('online', onOnline)

    return () => {
      subscription.subscription.unsubscribe()
      window.removeEventListener('online', onOnline)
    }
  }, [])

  const signInWithGoogle = useCallback(() => (
    supabase.auth.signInWithOAuth({ provider: 'google' })
  ), [])

  // captchaToken is a no-op extra field until Supabase's project-level
  // CAPTCHA protection is actually turned on (see Turnstile.jsx) — passing
  // it now, before that switch flips, costs nothing and means turning it on
  // later needs no client changes.
  const signInWithPassword = useCallback((email, password, captchaToken) => (
    supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })
  ), [])

  const signUp = useCallback((email, password, captchaToken) => (
    supabase.auth.signUp({ email, password, options: { captchaToken } })
  ), [])

  const signOut = useCallback(() => supabase.auth.signOut(), [])

  const resetPasswordForEmail = useCallback((email, captchaToken) => (
    supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin, captchaToken })
  ), [])

  const updatePassword = useCallback(async (password) => {
    const result = await supabase.auth.updateUser({ password })
    if (!result.error) setRecovery(false)
    return result
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    loading: session === undefined,
    hydrated,
    recovery,
    signInWithGoogle,
    signInWithPassword,
    signUp,
    signOut,
    resetPasswordForEmail,
    updatePassword,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
