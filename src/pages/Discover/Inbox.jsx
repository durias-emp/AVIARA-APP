import { useEffect, useState } from 'react'
import { IconChevronLeft } from '../../components/Icons'
import { listConversations } from '../../lib/messages'

function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ConversationRow({ convo, onOpen }) {
  const other = convo.otherProfile
  const name = other?.display_name || (other ? `@${other.username}` : 'Unknown pilot')
  const preview = convo.lastMessage?.body ?? 'Say hello'
  const unread = convo.unreadCount > 0

  return (
    <div
      onClick={() => onOpen(convo)}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(convo) } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
      }}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%', background: 'var(--bg-card-2)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)',
      }}>
        {(other?.username?.[0] ?? '?').toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{name}</div>
        <div style={{
          fontSize: 12.5, color: unread ? 'var(--text)' : 'var(--text-secondary)', fontWeight: unread ? 600 : 400,
          marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {preview}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmtWhen(convo.lastMessage?.created_at ?? convo.last_message_at)}</span>
        {unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />}
      </div>
    </div>
  )
}

// Reached from Discover's paper-plane chrome button. Local-state screen,
// not a route — see the comment on DiscoverShell's dmScreen state.
export default function Inbox({ myId, onOpen, onBack }) {
  const [conversations, setConversations] = useState(undefined)

  useEffect(() => {
    let cancelled = false
    listConversations(myId).then(({ data }) => { if (!cancelled) setConversations(data) })
    return () => { cancelled = true }
  }, [myId])

  return (
    <div style={{ minHeight: '100dvh', boxSizing: 'border-box', paddingBottom: 24 }}>
      <div style={{ padding: '20px 20px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
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
          fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Messages</h2>
      </div>

      {conversations === undefined ? null : conversations.length === 0 ? (
        <div style={{ padding: '32px 24px', textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          No conversations yet — message a pilot from Explore to start one.
        </div>
      ) : (
        <div>
          {conversations.map((c, i) => (
            <div key={c.id} style={{ borderTop: i === 0 ? 'none' : '0.5px solid var(--border)' }}>
              <ConversationRow convo={c} onOpen={onOpen} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
