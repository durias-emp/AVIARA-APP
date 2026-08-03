// Comments, against the `comments` table in
// supabase/migrations/0002_social.sql. No migration was needed — the table
// and its policies have been there since the social schema was written,
// including the one worth knowing about: either the commenter *or* the
// post's author may delete a comment, so a pilot can moderate replies on
// their own post.
//
// Visibility is inherited from the post via can_view_posts, enforced in RLS
// on both select and insert. Nothing here re-checks it, because a check in
// the client would be decoration.

import { supabase } from './supabase'

async function withAuthors(rows) {
  if (!rows.length) return rows
  const ids = [...new Set(rows.map(r => r.author_id))]
  const { data } = await supabase
    .from('profiles').select('id, username, display_name, avatar_url').in('id', ids)
  const by = new Map((data ?? []).map(p => [p.id, p]))
  return rows.map(r => ({ ...r, author: by.get(r.author_id) ?? null }))
}

// Oldest first — a comment thread is a conversation, and reading one from
// the bottom up makes no sense.
export async function listComments(postId) {
  const { data, error } = await supabase
    .from('comments')
    .select('id, post_id, author_id, body, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
  if (error) return { data: [], error }
  return { data: await withAuthors(data ?? []), error: null }
}

export async function addComment(postId, authorId, body) {
  const text = (body ?? '').trim()
  if (!text) return { error: new Error('Write something first') }
  if (!authorId) return { error: new Error('Not signed in') }

  const { data, error } = await supabase
    .from('comments')
    .insert({ post_id: postId, author_id: authorId, body: text })
    .select('id, post_id, author_id, body, created_at')
    .single()
  if (error) return { error }

  const [withAuthor] = await withAuthors([data])
  return { data: withAuthor }
}

export async function deleteComment(id) {
  return supabase.from('comments').delete().eq('id', id)
}

// Counts for a whole feed in one query, the same shape likeState uses — the
// alternative is a count per card, which is the classic way a feed ends up
// making thirty requests to render.
export async function commentCounts(postIds) {
  if (!postIds.length) return {}
  const { data } = await supabase.from('comments').select('post_id').in('post_id', postIds)
  const counts = {}
  for (const r of data ?? []) counts[r.post_id] = (counts[r.post_id] ?? 0) + 1
  return counts
}
