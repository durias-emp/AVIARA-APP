import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// createClient() throws synchronously if the URL is missing/malformed, and
// this module is imported transitively by db.js (via sync.js) — i.e. by
// nearly everything in the app. Without a stub fallback, forgetting to set
// the env vars would crash the entire app at load time, not just auth,
// which would be a serious regression against this app's offline-first,
// never-block-the-UI philosophy. The stub keeps every call site's shape
// (auth.* methods, from(table) chains) working — everything just resolves
// to a clear "not configured" error instead of throwing.
function createOfflineStubClient() {
  const notConfigured = new Error('Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local')
  const chain = new Proxy(function () {}, {
    apply() { return chain },
    get(_, prop) {
      if (prop === 'then') return (resolve) => resolve({ data: null, error: notConfigured })
      return chain
    },
  })

  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: () => Promise.resolve({ data: null, error: notConfigured }),
      signInWithPassword: () => Promise.resolve({ data: null, error: notConfigured }),
      signUp: () => Promise.resolve({ data: null, error: notConfigured }),
      signOut: () => Promise.resolve({ error: null }),
    },
    from: () => chain,
  }
}

if (!url || !anonKey) {
  console.warn('Supabase env vars missing — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local. Auth/backup features are disabled until then.')
}

// persistSession/autoRefreshToken/detectSessionInUrl are all Supabase
// defaults, spelled out here because they're load-bearing: they're what
// let auth.getSession() resolve from local storage with no network round
// trip, so a pilot who's already signed in keeps working fully offline.
export const supabase = (url && anonKey)
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : createOfflineStubClient()
