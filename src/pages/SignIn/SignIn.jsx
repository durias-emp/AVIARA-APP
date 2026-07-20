import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'

const INPUT_STYLE = {
  width: '100%', maxWidth: '100%', boxSizing: 'border-box',
  padding: '13px 14px', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-card-2)', color: 'var(--text)',
  fontSize: 16, outline: 'none', fontFamily: 'inherit', border: 'none',
}

function GoogleIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81z"/>
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.94-2.92l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.94H1.28v3.1C3.26 21.3 7.31 24 12 24z"/>
      <path fill="#FBBC05" d="M5.29 14.29A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.39-2.29V6.61H1.28A11.98 11.98 0 0 0 0 12c0 1.93.46 3.76 1.28 5.39z"/>
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.45-3.45C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.28 6.61l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75z"/>
    </svg>
  )
}

export default function SignIn({ legacy = false }) {
  const { signInWithGoogle, signInWithPassword, signUp } = useAuth()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  async function handleGoogle() {
    setError(null)
    setBusy(true)
    const { error: err } = await signInWithGoogle()
    if (err) { setError(err.message); setBusy(false) }
    // On success the browser navigates away to Google, so no need to reset busy.
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setError(null)
    setNotice(null)
    setBusy(true)
    const { error: err } = mode === 'signin'
      ? await signInWithPassword(email.trim(), password)
      : await signUp(email.trim(), password)
    setBusy(false)
    if (err) { setError(err.message); return }
    if (mode === 'signup') setNotice('Check your email to confirm your account, then sign in.')
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '24px 24px calc(24px + env(safe-area-inset-bottom))', gap: 28,
      minHeight: '100dvh', boxSizing: 'border-box',
    }}>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px' }}>
          {legacy ? 'Back up your data' : 'Welcome to PQRH'}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5 }}>
          {legacy
            ? 'Everything already on this device — your profile, aircraft, and checklists — stays exactly as it is. Signing in just backs it up so you never lose it if you get a new phone.'
            : 'Sign in to keep your pilot profile, aircraft, and checklists backed up and ready on any device.'}
        </div>
      </div>

      <button
        onClick={handleGoogle}
        disabled={busy}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          width: '100%', height: 50, borderRadius: 14, border: 'none',
          background: '#ffffff', color: '#1f1f1f',
          fontSize: 15, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.3px' }}>OR</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          type="email" autoComplete="email" placeholder="Email"
          value={email} onChange={e => setEmail(e.target.value)}
          style={INPUT_STYLE}
        />
        <input
          type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          placeholder="Password"
          value={password} onChange={e => setPassword(e.target.value)}
          style={INPUT_STYLE}
        />

        {error && (
          <div style={{ fontSize: 12, color: 'var(--danger)', lineHeight: 1.4 }}>{error}</div>
        )}
        {notice && (
          <div style={{ fontSize: 12, color: 'var(--ok)', lineHeight: 1.4 }}>{notice}</div>
        )}

        <button
          type="submit"
          disabled={busy || !email.trim() || !password}
          style={{
            width: '100%', height: 50, borderRadius: 14, border: 'none',
            cursor: busy ? 'default' : 'pointer',
            background: 'var(--text)', color: 'var(--bg)',
            fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px',
            opacity: (!email.trim() || !password) ? 0.5 : 1,
          }}
        >
          {mode === 'signin' ? 'Sign In' : 'Create Account'}
        </button>
      </form>

      <button
        onClick={() => { setMode(m => m === 'signin' ? 'signup' : 'signin'); setError(null); setNotice(null) }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center',
        }}
      >
        {mode === 'signin' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
      </button>
    </div>
  )
}
