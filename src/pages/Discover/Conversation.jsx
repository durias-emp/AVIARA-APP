import { useEffect, useRef, useState } from 'react'
import { IconChevronLeft } from '../../components/Icons'
import { supabase } from '../../lib/supabase'
import { listMessages, sendMessage, markConversationRead } from '../../lib/messages'

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function Bubble({ msg, mine }) {
  return (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', padding: '3px 16px' }}>
      <div style={{
        maxWidth: '75%', padding: '9px 13px', borderRadius: 16,
        borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4,
        background: mine ? 'var(--accent)' : 'var(--bg-card-2)',
        color: mine ? 'var(--accent-fg)' : 'var(--text)',
        fontSize: 14, lineHeight: 1.4, wordBreak: 'break-word',
      }}>
        {msg.body}
      </div>
    </div>
  )
}

// Reached from Inbox (or directly from ExploreTab's message button, which
// skips straight here after getOrCreateConversation). Local-state screen,
// not a route — see the comment on DiscoverShell's dmScreen state.
//
// First use of Supabase Realtime in this codebase — the subscribe/cleanup
// shape here is the template for any future live feature.
export default function Conversation({ myId, conversationId, otherProfile, onBack }) {
  const [messages, setMessages] = useState(undefined)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    listMessages(conversationId).then(({ data }) => {
      if (cancelled) return
      setMessages(data)
      markConversationRead(conversationId, myId)
    })
    return () => { cancelled = true }
  }, [conversationId, myId])

  useEffect(() => {
    // The offline-stub Supabase client (used when env vars aren't set) only
    // defines auth.* and from() — it has no channel() at all, so calling it
    // would throw. Degrade to no live updates rather than crash the screen.
    if (typeof supabase.channel !== 'function') return
    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        ({ new: msg }) => {
          // Absorbs the realtime echo of our own optimistically-appended
          // send without special-casing "is this my own message."
          setMessages(prev => (prev ?? []).some(m => m.id === msg.id) ? prev : [...(prev ?? []), msg])
          if (msg.sender_id !== myId) markConversationRead(conversationId, myId)
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversationId, myId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  async function handleSend() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setDraft('')
    const { data, error } = await sendMessage(conversationId, myId, body)
    if (data) setMessages(prev => (prev ?? []).some(m => m.id === data.id) ? prev : [...(prev ?? []), data])
    if (error) setDraft(body) // give the pilot their text back so nothing's lost (e.g. blocked mid-conversation)
    setSending(false)
  }

  const name = otherProfile?.display_name || (otherProfile ? `@${otherProfile.username}` : 'Conversation')

  return (
    <div style={{ minHeight: '100dvh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 16px 12px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button
          onClick={onBack} aria-label="Back"
          style={{
            width: 36, height: 36, borderRadius: '50%', border: '0.5px solid var(--border)',
            background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text)', flexShrink: 0, WebkitTapHighlightColor: 'transparent',
          }}>
          <IconChevronLeft size={18} />
        </button>
        <h2 style={{
          fontSize: 17, fontWeight: 700, letterSpacing: '-0.2px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>{name}</h2>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {messages?.map(m => (
          <Bubble key={m.id} msg={m} mine={m.sender_id === myId} />
        ))}
        {messages?.length > 0 && (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-tertiary)', padding: '4px 16px 0' }}>
            {fmtTime(messages[messages.length - 1].created_at)}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
        borderTop: '0.5px solid var(--border)', flexShrink: 0,
      }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
          placeholder="Message…"
          style={{
            flex: 1, boxSizing: 'border-box', padding: '11px 14px', borderRadius: 20,
            border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)',
            fontSize: 14, outline: 'none', fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          style={{
            padding: '10px 16px', borderRadius: 20, border: 'none',
            background: 'var(--text)', color: 'var(--bg)',
            fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
            cursor: (!draft.trim() || sending) ? 'default' : 'pointer',
            opacity: (!draft.trim() || sending) ? 0.5 : 1, flexShrink: 0,
            WebkitTapHighlightColor: 'transparent',
          }}>
          Send
        </button>
      </div>
    </div>
  )
}
