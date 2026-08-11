// Publishing where you are, and reading where your friends are.
//
// Against supabase/migrations/0009_live_positions.sql. Plain async functions
// returning { data, error }, the same convention as messages.js and follows.js.
//
// THE TABLE MAY NOT EXIST. The migration is deliberately not applied until a
// human applies it, and this module is written to be shipped before that
// happens: the first "no such table" answer latches the feature off for the
// rest of the session, so the app degrades to simply not having it rather than
// retrying a failing request every few seconds forever. Nothing here ever
// surfaces an error to the pilot, because a pilot who has not asked for this
// feature should never learn it exists by being told it is broken.

import { supabase } from './supabase'

// 42P01 is Postgres for undefined_table. PGRST205 is PostgREST failing to find
// it in the schema cache, which is what actually comes back through the API
// before the schema is reloaded. Either one means the same thing here.
function isMissingTable(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205'
    || /live_positions/i.test(error?.message ?? '') && /does not exist|not find/i.test(error?.message ?? '')
}

let unavailable = false

// Exported so the UI can stop offering a control that cannot work, rather than
// showing a switch that silently does nothing.
export function liveSharingAvailable() {
  return !unavailable
}

export async function publishPosition({ lat, lon, altFt, trackDeg, groundKt }) {
  if (unavailable) return { data: null, error: null }
  const { data: session } = await supabase.auth.getUser()
  const uid = session?.user?.id
  if (!uid) return { data: null, error: null }

  // upsert, not insert: one row per pilot, overwritten in place. The table has
  // no history by design and this is the call that keeps it that way.
  const { data, error } = await supabase
    .from('live_positions')
    .upsert({
      user_id: uid,
      lat, lon,
      alt_ft: altFt ?? null,
      track_deg: trackDeg ?? null,
      ground_kt: groundKt ?? null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .maybeSingle()

  if (isMissingTable(error)) { unavailable = true; return { data: null, error: null } }
  return { data, error }
}

// Stopping deletes the row rather than letting it age out of the freshness
// window. Ten more minutes of being visible after a pilot says stop is not
// stopping.
export async function withdrawPosition() {
  if (unavailable) return { error: null }
  const { data: session } = await supabase.auth.getUser()
  const uid = session?.user?.id
  if (!uid) return { error: null }
  const { error } = await supabase.from('live_positions').delete().eq('user_id', uid)
  if (isMissingTable(error)) { unavailable = true; return { error: null } }
  return { error }
}

// Whoever the row-level policy lets through, which is mutual follows only, with
// blocks overriding and stale rows filtered out in the database rather than
// here. This deliberately sends no filter of its own: the client asking for
// "my friends" would be a second, weaker copy of a rule that belongs in one
// place, and the one place is the policy.
export async function listFriendsAloft() {
  if (unavailable) return { data: [], error: null }
  const { data, error } = await supabase
    .from('live_positions')
    .select('user_id, lat, lon, alt_ft, track_deg, ground_kt, updated_at')
    .order('updated_at', { ascending: false })

  if (isMissingTable(error)) { unavailable = true; return { data: [], error: null } }
  if (error) return { data: [], error }

  const rows = data ?? []
  if (!rows.length) return { data: [], error: null }

  // Names come from profiles, which is already publicly readable. A marker
  // labelled with a uuid is not a friend, it is a database row.
  const ids = rows.map(r => r.user_id)
  const { data: profiles } = await supabase
    .from('profiles').select('id, username, display_name').in('id', ids)
  const byId = new Map((profiles ?? []).map(p => [p.id, p]))

  return {
    data: rows.map(r => ({
      ...r,
      name: byId.get(r.user_id)?.display_name || byId.get(r.user_id)?.username || 'Pilot',
    })),
    error: null,
  }
}
