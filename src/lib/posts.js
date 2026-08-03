// Posts, against the tables in supabase/migrations/0002_social.sql.
//
// Plain async functions like follows.js, for the same reason: a feed is
// mostly about other people, so none of it belongs in the global profile
// context.
//
// One structural wrinkle shapes almost everything here. posts.author_id
// references auth.users, not profiles — correct, since a post belongs to an
// account rather than to a social identity that might not exist — but it
// means PostgREST has no foreign key to follow from a post to its author's
// username and avatar. Rather than pretend otherwise with an embed that
// silently returns null, author details are fetched in a second query and
// joined here. Two round trips, never N+1.

import { supabase } from './supabase'
import { uploadImages, removeByUrls } from './media'

const AUTHOR_FIELDS = 'id, username, display_name, avatar_url'

// Attaches author rows to anything carrying an author_id.
async function withAuthors(rows) {
  if (!rows.length) return rows
  const ids = [...new Set(rows.map(r => r.author_id))]
  const { data } = await supabase.from('profiles').select(AUTHOR_FIELDS).in('id', ids)
  const by = new Map((data ?? []).map(p => [p.id, p]))
  return rows.map(r => ({ ...r, author: by.get(r.author_id) ?? null }))
}

// Media comes back unordered from PostgREST; `position` is what the author
// chose.
function sortMedia(row) {
  return { ...row, post_media: [...(row.post_media ?? [])].sort((a, b) => a.position - b.position) }
}

// Creates the post first, then attaches media.
//
// The order matters on failure: a post row with no photos is a visible,
// deletable thing the pilot can retry or remove, whereas orphaned uploads
// with no row are invisible and unreachable. If the media insert fails the
// post is rolled back by hand — there is no transaction across storage and
// the database, so this is the closest honest equivalent.
export async function createPost({ authorId, caption, files = [], onProgress }) {
  if (!authorId) return { error: new Error('Not signed in') }
  const text = (caption ?? '').trim()
  if (!text && !files.length) return { error: new Error('Add a photo or write something') }

  let uploaded = []
  try {
    if (files.length) {
      uploaded = await uploadImages(files, { kind: 'posts', userId: authorId, onProgress })
    }
  } catch (err) {
    return { error: err }
  }

  const { data: post, error } = await supabase
    .from('posts')
    .insert({ author_id: authorId, caption: text || null })
    .select('id, author_id, caption, created_at')
    .single()

  if (error) {
    await removeByUrls(uploaded.map(u => u.url))
    return { error }
  }

  if (uploaded.length) {
    const { error: mediaError } = await supabase.from('post_media').insert(
      uploaded.map((u, i) => ({ post_id: post.id, url: u.url, position: i }))
    )
    if (mediaError) {
      await supabase.from('posts').delete().eq('id', post.id)
      await removeByUrls(uploaded.map(u => u.url))
      return { error: mediaError }
    }
  }

  return { data: { ...post, post_media: uploaded.map((u, i) => ({ url: u.url, position: i })) } }
}

// The feed: people I follow, plus me.
//
// RLS already hides anything I'm not allowed to see, so this filter is about
// relevance rather than permission — without it "feed" would mean every
// public post on the platform, which is Explore's job, not this one.
export async function listFeed(myId, { limit = 30 } = {}) {
  const { data: follows } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', myId)
    .eq('status', 'accepted')

  const authors = [...new Set([...(follows ?? []).map(f => f.followee_id), myId])]

  const { data, error } = await supabase
    .from('posts')
    .select('id, author_id, caption, created_at, post_media(url, position)')
    .in('author_id', authors)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return { data: [], error }
  return { data: await withAuthors((data ?? []).map(sortMedia)), error: null }
}

// One pilot's own posts — the profile grid.
export async function listUserPosts(userId, { limit = 60 } = {}) {
  const { data, error } = await supabase
    .from('posts')
    .select('id, author_id, caption, created_at, post_media(url, position)')
    .eq('author_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return { data: (data ?? []).map(sortMedia), error }
}

export async function countUserPosts(userId) {
  const { count } = await supabase
    .from('posts').select('*', { count: 'exact', head: true }).eq('author_id', userId)
  return count ?? 0
}

// Deletes the row, then the bytes. post_media rows go with the post by
// cascade, but storage objects have no idea the database exists.
export async function deletePost(post) {
  const urls = (post.post_media ?? []).map(m => m.url)
  const { error } = await supabase.from('posts').delete().eq('id', post.id)
  if (error) return { error }
  await removeByUrls(urls)
  return { error: null }
}

// ── Likes ────────────────────────────────────────────────────

// Counts for a batch of posts, and which of them I've liked — two queries
// for the whole feed rather than two per post.
export async function likeState(postIds, myId) {
  if (!postIds.length) return { counts: {}, mine: new Set() }
  const [{ data: all }, { data: mineRows }] = await Promise.all([
    supabase.from('post_likes').select('post_id').in('post_id', postIds),
    supabase.from('post_likes').select('post_id').in('post_id', postIds).eq('user_id', myId),
  ])
  const counts = {}
  for (const r of all ?? []) counts[r.post_id] = (counts[r.post_id] ?? 0) + 1
  return { counts, mine: new Set((mineRows ?? []).map(r => r.post_id)) }
}

export async function setLiked(postId, myId, liked) {
  return liked
    ? supabase.from('post_likes').insert({ post_id: postId, user_id: myId })
    : supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', myId)
}

// ── Formatting ───────────────────────────────────────────────

// "just now" / "4h" / "3d" / "12 Mar" — feed-style, shortest useful form.
export function timeAgo(iso) {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
