// Follow-system queries/mutations against supabase/migrations/0002_social.sql.
// Plain async functions, not a context — a follow list is inherently about
// people other than the current user, so there's nothing here that belongs
// in global app state the way SocialProfile.jsx's own profile row does.

import { supabase } from './supabase'

export async function listOtherPilots(myId, limit = 50) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, is_private')
    .neq('id', myId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return { data: data ?? [], error }
}

// Every row I'm the follower on, keyed by who it's aimed at — used to derive
// each pilot-list row's button state (Follow / Requested / Following)
// without an N+1 query per row.
export async function listMyFollows(myId) {
  const { data, error } = await supabase
    .from('follows')
    .select('followee_id, status')
    .eq('follower_id', myId)
  return { data: data ?? [], error }
}

// status starts 'accepted' immediately for a public target, 'pending' for a
// private one — see the same convention documented on follows.status in the
// migration. is_private is always false today (nothing sets it yet), so
// this always resolves to 'accepted' in practice right now, but it's
// written correctly rather than hardcoded so it doesn't need revisiting
// once a private-account toggle actually exists.
export async function followUser(myId, theirId, theirIsPrivate) {
  return supabase.from('follows').insert({
    follower_id: myId,
    followee_id: theirId,
    status: theirIsPrivate ? 'pending' : 'accepted',
  })
}

export async function unfollowUser(myId, theirId) {
  return supabase.from('follows').delete().eq('follower_id', myId).eq('followee_id', theirId)
}

// Only counts accepted relationships — a pending request isn't a follower
// yet, same as Instagram doesn't count a request against either total.
export async function getFollowCounts(userId) {
  const [{ count: followers }, { count: following }] = await Promise.all([
    supabase.from('follows').select('*', { count: 'exact', head: true })
      .eq('followee_id', userId).eq('status', 'accepted'),
    supabase.from('follows').select('*', { count: 'exact', head: true })
      .eq('follower_id', userId).eq('status', 'accepted'),
  ])
  return { followers: followers ?? 0, following: following ?? 0 }
}
