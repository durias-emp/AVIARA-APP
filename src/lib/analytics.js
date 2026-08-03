import { supabase } from './supabase'

// Minimal usage analytics: "what do pilots do," not a full analytics
// platform. Fire-and-forget: never awaited by callers, never throws, and
// doesn't queue locally: an event lost while offline is an acceptable
// trade-off for how small/simple this needs to be.
export function trackEvent(name, meta = {}) {
  supabase.auth.getSession().then(({ data }) => {
    const userId = data.session?.user?.id
    if (!userId) return
    return supabase.from('events').insert({ user_id: userId, name, meta })
  }).catch(() => {})
}
