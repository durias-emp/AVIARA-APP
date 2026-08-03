// Stories — a photo that stops being visible 24 hours after it's posted.
//
// The expiry that matters is the one in the database. The select policy in
// 0004 is `expires_at > now()`, so a lapsed story is invisible to every
// query from every client, including a stale tab or a hand-written request.
// Everything in this file — the countdown, the purge — is presentation and
// housekeeping layered on top of that, never the thing enforcing it.

import { supabase } from './supabase'
import { uploadImage, removeByPaths } from './media'

export const STORY_HOURS = 24

export async function createStory({ authorId, file, caption }) {
  if (!authorId) return { error: new Error('Not signed in') }
  if (!file) return { error: new Error('A story needs a photo') }

  let uploaded
  try {
    uploaded = await uploadImage(file, { kind: 'stories', userId: authorId })
  } catch (err) {
    return { error: err }
  }

  const { data, error } = await supabase
    .from('stories')
    .insert({
      author_id: authorId,
      url: uploaded.url,
      path: uploaded.path,
      caption: (caption ?? '').trim() || null,
    })
    .select('id, author_id, url, caption, created_at, expires_at')
    .single()

  // No row means the photo is unreachable — nothing references it and
  // nothing ever will, so take it back out rather than leave it billing
  // against the project's quota forever.
  if (error) {
    await removeByPaths([uploaded.path])
    return { error }
  }
  return { data }
}

// Every story still in force, grouped by author, mine first.
//
// Mine first because the row doubles as the "add a story" control: the
// pilot's own ring is where they tap to post one, so it has to be where
// their thumb already is rather than somewhere down the list.
export async function listActiveStories(myId) {
  const { data, error } = await supabase
    .from('stories')
    .select('id, author_id, url, caption, created_at, expires_at')
    .order('created_at', { ascending: true })

  if (error) return { data: [], error }
  const rows = data ?? []
  if (!rows.length) return { data: [], error: null }

  const ids = [...new Set(rows.map(r => r.author_id))]
  const { data: profiles } = await supabase
    .from('profiles').select('id, username, display_name, avatar_url').in('id', ids)
  const by = new Map((profiles ?? []).map(p => [p.id, p]))

  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.author_id)) {
      groups.set(r.author_id, { authorId: r.author_id, author: by.get(r.author_id) ?? null, stories: [] })
    }
    groups.get(r.author_id).stories.push(r)
  }

  const out = [...groups.values()]
  out.sort((a, b) => (a.authorId === myId ? -1 : b.authorId === myId ? 1 : 0))
  return { data: out, error: null }
}

export async function deleteStory(story) {
  const { error } = await supabase.from('stories').delete().eq('id', story.id)
  if (error) return { error }
  await removeByPaths([story.path])
  return { error: null }
}

// Removes the caller's own lapsed stories and the photos behind them.
//
// pg_cron isn't enabled on this project, so nothing runs on a schedule.
// Rather than let storage grow without bound, each pilot cleans up after
// themselves the next time they open Discover — the RLS delete policy only
// permits their own rows anyway, so this is the most any client can do and
// exactly enough. Silent and best-effort: it is quota management, not a
// feature, and it must never delay or break opening the tab.
export async function purgeMyExpiredStories() {
  try {
    // Deliberately an RPC, not a select-then-delete. The select policy hides
    // expired rows from everyone including their author, so the client
    // cannot read back the storage paths it needs — a plain delete would
    // clear the rows and strand the photos. purge_my_expired_stories() runs
    // as security definer, deletes the caller's own lapsed rows, and returns
    // their paths so the objects can go too.
    const { data } = await supabase.rpc('purge_my_expired_stories')
    await removeByPaths((data ?? []).map(r => r.path))
  } catch { /* housekeeping */ }
}

// "23h left" / "40m left" / "expiring" — what the viewer shows.
export function timeLeft(story) {
  const ms = Date.parse(story.expires_at) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 'expired'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m left`
  return `${Math.floor(mins / 60)}h left`
}
