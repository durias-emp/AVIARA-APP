import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { shareLink, copyLink } from '../../lib/share'
import { listOtherPilots } from '../../lib/follows'
import { getOrCreateConversation, sendMessage } from '../../lib/messages'

// The share sheet: send somewhere else, copy, or send to a pilot in here.
//
// The native sheet handles "somewhere else" — Messages, WhatsApp, AirDrop,
// email — and this app deliberately knows about none of them. What it can do
// better than the OS is the third option: sending straight to another pilot
// on AVIARA, which reuses the DM plumbing that already exists rather than
// bouncing out to another app and back.

function Row({ icon, label, sub, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%',
        padding: '13px 16px', border: 'none', background: 'transparent',
        cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
        textAlign: 'left', opacity: disabled ? 0.5 : 1,
        borderTop: '0.5px solid var(--border)',
        WebkitTapHighlightColor: 'transparent',
      }}>
      <span style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        background: 'var(--bg-card-2)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 16,
      }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{sub}</span>}
      </span>
    </button>
  )
}

export default function ShareSheet({ url, title, text, myId, onClose }) {
  const [status, setStatus] = useState(null)
  const [picking, setPicking] = useState(false)
  const [pilots, setPilots] = useState(null)
  const [query, setQuery] = useState('')
  const [sendingTo, setSendingTo] = useState(null)

  useEffect(() => {
    if (!picking || pilots || !myId) return
    listOtherPilots(myId, 100).then(({ data }) => setPilots(data))
  }, [picking, pilots, myId])

  // A confirmation the pilot can actually read before it disappears.
  useEffect(() => {
    if (status !== 'copied' && status !== 'sent') return
    const t = setTimeout(onClose, 1100)
    return () => clearTimeout(t)
  }, [status, onClose])

  async function native() {
    const r = await shareLink({ url, title, text })
    if (r === 'cancelled') return
    setStatus(r)
    if (r === 'shared') onClose()
  }

  async function sendTo(pilot) {
    if (sendingTo) return
    setSendingTo(pilot.id)
    const { data: convo } = await getOrCreateConversation(myId, pilot.id)
    if (!convo) { setStatus('failed'); setSendingTo(null); return }
    // Sent as a plain link in the message body. messages.body is text, and a
    // URL travelling as text needs no schema change and renders as something
    // tappable wherever it lands.
    const { error } = await sendMessage(convo.id, myId, `${title}\n${url}`)
    setSendingTo(null)
    setStatus(error ? 'failed' : 'sent')
  }

  const q = query.trim().toLowerCase()
  const shown = (pilots ?? []).filter(p =>
    !q || p.username?.toLowerCase().includes(q) || p.display_name?.toLowerCase().includes(q))

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, background: 'var(--bg-card)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          paddingBottom: 'env(safe-area-inset-bottom)',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        }}>
        <div style={{ padding: '10px 0 6px', display: 'flex', justifyContent: 'center' }}>
          <span style={{ width: 36, height: 4, borderRadius: 3, background: 'var(--border)' }} />
        </div>

        <div style={{ padding: '4px 16px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {picking ? 'Send to a pilot' : 'Share'}
          </span>
          {picking && (
            <button onClick={() => setPicking(false)} style={{
              border: 'none', background: 'transparent', color: 'var(--accent)',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            }}>Back</button>
          )}
        </div>

        {status && (
          <div style={{
            margin: '0 16px 10px', padding: '9px 12px', borderRadius: 10,
            background: status === 'failed' ? 'rgba(255,59,48,0.12)' : 'var(--accent-light)',
            color: status === 'failed' ? 'var(--danger)' : 'var(--accent)',
            fontSize: 12, fontWeight: 700,
          }}>
            {status === 'copied' ? 'Link copied'
              : status === 'sent' ? 'Sent'
              : status === 'failed' ? "Couldn't share that — try copying the link"
              : 'Shared'}
          </div>
        )}

        {!picking ? (
          <div style={{ overflowY: 'auto' }}>
            <Row icon="↗" label="Share…" sub="Messages, WhatsApp, AirDrop, anywhere" onClick={native} />
            <Row icon="⧉" label="Copy link" sub={url.replace(/^https?:\/\//, '')}
              onClick={async () => setStatus(await copyLink(url))} />
            <Row icon="✈" label="Send to a pilot" sub="Straight into their AVIARA inbox"
              onClick={() => setPicking(true)} disabled={!myId} />
          </div>
        ) : (
          <>
            <div style={{ padding: '0 16px 10px' }}>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search pilots"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                  borderRadius: 10, border: 'none', background: 'var(--bg-card-2)',
                  color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', outline: 'none',
                }}
              />
            </div>
            <div style={{ overflowY: 'auto', paddingBottom: 8 }}>
              {pilots === null && (
                <div style={{ padding: '18px 16px', fontSize: 13, color: 'var(--text-tertiary)' }}>Loading…</div>
              )}
              {pilots?.length === 0 && (
                <div style={{ padding: '18px 16px', fontSize: 13, color: 'var(--text-tertiary)' }}>
                  No other pilots on AVIARA yet.
                </div>
              )}
              {shown.map(p => (
                <Row
                  key={p.id}
                  icon={(p.username?.[0] ?? '?').toUpperCase()}
                  label={`@${p.username}`}
                  sub={sendingTo === p.id ? 'Sending…' : p.display_name}
                  onClick={() => sendTo(p)}
                  disabled={!!sendingTo}
                />
              ))}
            </div>
          </>
        )}

        <button onClick={onClose} style={{
          margin: 12, padding: '13px 0', borderRadius: 14, border: 'none',
          background: 'var(--bg-card-2)', color: 'var(--text)', fontFamily: 'inherit',
          fontSize: 15, fontWeight: 700, cursor: 'pointer',
        }}>Done</button>
      </div>
    </div>,
    document.body
  )
}
