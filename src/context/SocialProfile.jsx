import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const SocialProfileContext = createContext(null)

// profile: undefined = haven't checked yet, null = signed in but no row in
// `profiles` (the social feature's cloud identity — separate from the local
// pilot profile in PilotProfile.jsx), object = the real row. Three states,
// not two, so a "create your profile" prompt never flashes for a moment
// before the initial query has actually come back.
//
// Deliberately its own context rather than folded into AuthContext: signing
// in is required for the whole app now, but having a social profile is not
// — this only matters once something (today, just Discover) actually asks
// for it.
export function SocialProfileProvider({ children }) {
  const { user } = useAuth()
  const [profile, setProfile] = useState(undefined)

  const refresh = useCallback(() => {
    if (!user) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      .then(({ data }) => setProfile(data ?? null))
      .catch(() => setProfile(null))
  }, [user])

  useEffect(() => { refresh() }, [refresh])

  const createProfile = useCallback(async (username) => {
    if (!user) return { data: null, error: new Error('Not signed in') }
    const { data, error } = await supabase.from('profiles')
      .insert({ id: user.id, username })
      .select()
      .single()
    if (!error) setProfile(data)
    return { data, error }
  }, [user])

  return (
    <SocialProfileContext.Provider value={{ profile, refresh, createProfile }}>
      {children}
    </SocialProfileContext.Provider>
  )
}

export function useSocialProfile() {
  return useContext(SocialProfileContext)
}
