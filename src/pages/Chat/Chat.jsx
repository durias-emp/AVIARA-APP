import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { askClaude, getApiKey, saveApiKey } from '../../lib/claude'
import { get } from '../../lib/db'
import WeatherCard from '../../components/WeatherCard'

const TOOLS = [
  { to: '/calc',       label: 'Calculators' },
  { to: '/checklists', label: 'Checklists'  },
  { to: '/currency',   label: 'Currency'    },
  { to: '/reference',  label: 'Reference'   },
]

const ALL_SUGGESTIONS = [
  { title: 'Read a METAR',         desc: 'Decode any aviation weather report step by step' },
  { title: 'Density altitude',     desc: 'What it is, how to calculate, and why it matters' },
  { title: 'BFR requirements',     desc: 'Currency rules for pilots in Canada and the US' },
  { title: 'Lost comms VFR',       desc: 'Procedures when radio contact is lost in flight' },
  { title: 'VFR weather minimums', desc: 'Cloud clearance and visibility rules by airspace' },
  { title: 'Transponder codes',    desc: 'When to squawk 7700, 7600, and 7500' },
  { title: 'Class B airspace',     desc: 'Entry requirements and communication rules' },
  { title: 'Weight & balance',     desc: 'How to calculate CG and ensure your aircraft is safe' },
  { title: 'IFR alternates',       desc: 'When you need one and how to pick the right airport' },
  { title: 'METARs vs TAFs',       desc: 'Difference between current and forecast weather' },
  { title: 'Crosswind technique',  desc: 'Crab vs sideslip and when to use each' },
  { title: 'Stall recovery',       desc: 'Recognition and recovery procedures' },
]

function pickSuggestions(exclude = []) {
  const pool = ALL_SUGGESTIONS.filter(s => !exclude.includes(s.title))
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 4)
}

function IconSend({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="currentColor">
      <path d="M476.6 227.4L49.5 24.2C40.9 20 30.9 21.7 24.1 28.5c-6.8 6.8-8.5 16.8-4.3 25.4L99.6 240H256c8.8 0 16 7.2 16 16s-7.2 16-16 16H99.6L19.8 458.1c-4.2 8.6-2.5 18.6 4.3 25.4 6.8 6.8 16.8 8.5 25.4 4.3l427.1-203.2c8.2-3.9 13.4-12.1 13.4-21.1s-5.2-17.2-13.4-21.1z"/>
    </svg>
  )
}

function IconKey({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="7.5" cy="15.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M21 2l-9.6 9.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M15 8l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

export default function Chat() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [apiKey, setApiKey] = useState(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [suggestions, setSuggestions] = useState(() => pickSuggestions())
  const [sugPhase, setSugPhase] = useState('in')
  const [registration, setRegistration] = useState('') // 'in' | 'out'
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (messages.length > 0) return
    const STAGGER = 320
    const DURATION = 900
    const HOLD = 6000
    const OUT_DONE = 3 * STAGGER + DURATION + 100

    let t1, t2, t3
    const cycle = () => {
      setSugPhase('out')
      t2 = setTimeout(() => {
        setSugPhase('hidden')
        setSuggestions(prev => pickSuggestions(prev.map(s => s.title)))
        requestAnimationFrame(() => requestAnimationFrame(() => {
          setSugPhase('in')
          t3 = setTimeout(cycle, HOLD + 3 * STAGGER + DURATION)
        }))
      }, OUT_DONE)
    }
    t1 = setTimeout(cycle, HOLD)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [messages.length])

  useEffect(() => {
    getApiKey().then(k => setApiKey(k))
    get('aircraft', 'profile').then(p => { if (p?.registration) setRegistration(p.registration) })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function handleSaveKey() {
    if (keyDraft.trim().length < 10) return
    await saveApiKey(keyDraft)
    setApiKey(keyDraft.trim())
    setShowKeyInput(false)
    setKeyDraft('')
  }

  async function send(text) {
    const content = text ?? input.trim()
    if (!content || loading) return
    setInput('')

    const userMsg = { role: 'user', content }
    const next = [...messages, userMsg]
    setMessages(next)
    setLoading(true)

    try {
      const reply = await askClaude(
        next.map(m => ({ role: m.role, content: m.content })),
        apiKey
      )
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}`,
        isError: true,
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>

      {/* Aircraft registration pill — top right */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 16px 0', flexShrink: 0 }}>
        <Link to="/aircraft" style={{ textDecoration: 'none' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px',
          borderRadius: 20,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <span style={{ position: 'relative', display: 'flex', width: 6, height: 6, flexShrink: 0 }}>
            <span style={{
              position: 'absolute', display: 'inline-flex',
              width: '100%', height: '100%', borderRadius: '50%',
              background: '#4ade80', opacity: 0.75,
              animation: 'ping 1.2s cubic-bezier(0,0,0.2,1) infinite',
            }} />
            <span style={{
              position: 'relative', display: 'inline-flex',
              width: 6, height: 6, borderRadius: '50%',
              background: '#4ade80',
            }} />
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.1px' }}>
            {registration || 'Aircraft'}
          </span>
        </div>
        </Link>
      </div>

      {/* Weather card */}
      <div style={{ padding: '16px 16px 0', flexShrink: 0 }}>
        <WeatherCard />
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 160px' }}>


        {/* Message bubbles */}
        {messages.map((m, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
            marginBottom: 10,
          }}>
            <div style={{
              maxWidth: '82%',
              padding: '10px 14px',
              borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: m.role === 'user'
                ? 'var(--accent)'
                : m.isError ? 'var(--danger-light)' : 'var(--bg-card)',
              color: m.role === 'user' ? '#fff' : m.isError ? 'var(--danger)' : 'var(--text)',
              fontSize: 15,
              lineHeight: 1.5,
              boxShadow: 'var(--shadow-sm)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {m.content}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div style={{ display: 'flex', marginBottom: 10 }}>
            <div style={{
              padding: '12px 16px',
              borderRadius: '18px 18px 18px 4px',
              background: 'var(--bg-card)',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex', gap: 4, alignItems: 'center',
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--text-tertiary)',
                  animation: 'bounce 1.2s ease-in-out infinite',
                  animationDelay: `${i * 0.2}s`,
                }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Floating input */}
      <div style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 428,
        padding: '12px 16px',
        paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        pointerEvents: 'none',
      }}>
        {/* API key setup panel */}
        {showKeyInput && (
          <div style={{
            pointerEvents: 'all',
            background: 'var(--bg-card)',
            borderRadius: 'var(--r-xl)',
            border: '0.5px solid var(--border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            padding: '14px 16px',
            marginBottom: 10,
          }}>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Enter your Anthropic API key — stored locally only.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                autoFocus
                type="password"
                placeholder="sk-ant-..."
                value={keyDraft}
                onChange={e => setKeyDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 10,
                  border: '1px solid var(--border-strong)',
                  background: 'var(--bg-card-2)', color: 'var(--text)',
                  fontSize: 14, outline: 'none',
                }}
              />
              <button onClick={handleSaveKey}
                style={{
                  padding: '10px 16px', borderRadius: 10, border: 'none',
                  background: 'var(--accent)', color: '#fff',
                  fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}>Save</button>
            </div>
          </div>
        )}

        {/* Suggestions */}
        {messages.length === 0 && (
          <div style={{ pointerEvents: 'all', marginBottom: 8 }}>
            {suggestions.map(({ title, desc }, i) => (
              <button key={title} onClick={() => send(title)}
                style={{
                  textAlign: 'left', padding: '5px 2px',
                  background: 'none', border: 'none',
                  color: 'var(--text)', fontSize: 14,
                  cursor: 'pointer', width: '100%',
                  display: 'flex', alignItems: 'baseline', gap: 6,
                  opacity: sugPhase === 'in' ? 1 : 0,
                  transform: sugPhase === 'in' ? 'translateY(0)' : sugPhase === 'out' ? 'translateY(-8px)' : 'translateY(10px)',
                  transition: sugPhase === 'hidden'
                    ? 'none'
                    : `opacity 0.9s cubic-bezier(0.16,1,0.3,1) ${i * 0.32}s, transform 0.9s cubic-bezier(0.16,1,0.3,1) ${i * 0.32}s`,
                }}>
                <span style={{ fontWeight: 600, flexShrink: 0 }}>{title}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* Tool quick links */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, overflowX: 'auto', pointerEvents: 'all', paddingBottom: 2 }}>
          {TOOLS.map(({ to, label }) => (
            <Link key={to} to={to} style={{
              padding: '7px 14px',
              borderRadius: 20,
              background: 'var(--bg-card)',
              boxShadow: 'var(--shadow-sm)',
              border: '0.5px solid var(--border)',
              textDecoration: 'none',
              flexShrink: 0,
              fontSize: 13, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.1px',
            }}>
              {label}
            </Link>
          ))}
        </div>

        {/* Floating pill */}
        <div style={{
          pointerEvents: 'all',
          background: 'var(--bg-card)',
          borderRadius: 24,
          border: '0.5px solid var(--border)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.1)',
          padding: '10px 10px 10px 16px',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Ask anything about aviation or your PQRH handbook…"
            value={input}
            onChange={e => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            disabled={!apiKey || loading}
            style={{
              flex: 1, resize: 'none', overflow: 'hidden',
              border: 'none', background: 'transparent',
              color: 'var(--text)', fontSize: 15,
              lineHeight: 1.5, outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || !apiKey || loading}
            style={{
              width: 34, height: 34, borderRadius: '50%', border: 'none',
              background: input.trim() && apiKey && !loading ? 'var(--accent)' : 'var(--bg-card-2)',
              color: input.trim() && apiKey && !loading ? '#fff' : 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: input.trim() && apiKey && !loading ? 'pointer' : 'default',
              flexShrink: 0, transition: 'background 0.15s',
            }}>
            <IconSend size={15} />
          </button>
        </div>

        {/* Legal legend */}
        <p style={{
          pointerEvents: 'none',
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--text-tertiary)',
          marginTop: 6,
          paddingBottom: 2,
          lineHeight: 1.4,
          whiteSpace: 'nowrap',
        }}>
          PQRH AI can make mistakes. Verify before flight.
        </p>
      </div>
    </div>
  )
}
