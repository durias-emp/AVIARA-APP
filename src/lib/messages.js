// DM queries/mutations against supabase/migrations/0002_social.sql's
// conversations/messages tables. Plain async functions returning
// { data, error }, same convention as follows.js.

import { supabase } from './supabase'

function sortPair(a, b) {
  return a < b ? [a, b] : [b, a]
}

export async function getOrCreateConversation(myId, theirId, listingId = null) {
  const [user_a, user_b] = sortPair(myId, theirId)
  const { data: existing, error: findErr } = await supabase
    .from('conversations').select('*').eq('user_a', user_a).eq('user_b', user_b).maybeSingle()
  if (findErr) return { data: null, error: findErr }
  if (existing) return { data: existing, error: null }

  const { data, error } = await supabase
    .from('conversations').insert({ user_a, user_b, listing_id: listingId }).select().single()
  // Two people opening the same thread at once both hit find-then-create;
  // the unique(user_a,user_b) constraint rejects the loser — re-select
  // rather than surface a spurious error for what is actually a success.
  if (error?.code === '23505') {
    return supabase.from('conversations').select('*').eq('user_a', user_a).eq('user_b', user_b).maybeSingle()
  }
  return { data, error }
}

export async function listConversations(myId) {
  const { data: convos, error } = await supabase
    .from('conversations').select('*').order('last_message_at', { ascending: false, nullsFirst: false })
  if (error || !convos?.length) return { data: [], error }

  const ids = convos.map(c => c.id)
  const otherIds = convos.map(c => (c.user_a === myId ? c.user_b : c.user_a))

  const [{ data: profiles }, { data: recent }, { data: unread }] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name, avatar_url').in('id', otherIds),
    // Globally ordered desc, capped generously — the first row seen per
    // conversation_id while walking this list is that conversation's most
    // recent message (every later dupe is older). Fine at 1:1-DM volume; a
    // DISTINCT ON SQL helper would be the real fix if that stops being true.
    supabase.from('messages').select('conversation_id, body, sender_id, created_at')
      .in('conversation_id', ids).order('created_at', { ascending: false }).limit(300),
    supabase.from('messages').select('conversation_id')
      .in('conversation_id', ids).is('read_at', null).neq('sender_id', myId),
  ])

  const profileById = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))
  const lastByConvo = {}
  for (const m of recent ?? []) if (!(m.conversation_id in lastByConvo)) lastByConvo[m.conversation_id] = m
  const unreadByConvo = {}
  for (const m of unread ?? []) unreadByConvo[m.conversation_id] = (unreadByConvo[m.conversation_id] ?? 0) + 1

  const data = convos.map(c => ({
    ...c,
    otherProfile: profileById[c.user_a === myId ? c.user_b : c.user_a] ?? null,
    lastMessage: lastByConvo[c.id] ?? null,
    unreadCount: unreadByConvo[c.id] ?? 0,
  }))
  return { data, error: null }
}

export async function listMessages(conversationId, limit = 50) {
  const { data, error } = await supabase.from('messages').select('*')
    .eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(limit)
  return { data: data ?? [], error }
}

export async function sendMessage(conversationId, senderId, body) {
  const { data, error } = await supabase.from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, body }).select().single()
  if (error) return { data: null, error }
  // App-maintained per the migration (no trigger). Best-effort: the message
  // itself already succeeded, so a failure here just leaves the inbox
  // sort/preview stale, not a lost message.
  await supabase.from('conversations').update({ last_message_at: data.created_at }).eq('id', conversationId)
  return { data, error: null }
}

export async function markConversationRead(conversationId, myId) {
  // RLS already only allows the recipient to flip read_at (sender_id <>
  // auth.uid()), so this filter isn't load-bearing for security — it just
  // avoids sending an update destined to be a partial no-op.
  const { data, error } = await supabase.from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId).neq('sender_id', myId).is('read_at', null).select()
  return { data: data ?? [], error }
}

// Cheap existence check for the Discover-scoped unread dot — head:true, no
// row payload, and deliberately polled (called on mount / on inbox close)
// rather than realtime-subscribed, since a standing global subscription
// just for a badge is the first step toward a cross-app notification
// system this pass isn't building.
export async function hasUnreadMessages(myId) {
  const { count, error } = await supabase.from('messages')
    .select('id', { count: 'exact', head: true }).is('read_at', null).neq('sender_id', myId)
  return { count: count ?? 0, error }
}
