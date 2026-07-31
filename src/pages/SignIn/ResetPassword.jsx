import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'

const INPUT_STYLE = {
  width: '100%', maxWidth: '100%', boxSizing: 'border-box',
  padding: '13px 14px', borderRadius: 'var(--r-sm)',
  background: 'var(--bg-card-2)', color: 'var(--text)',
  fontSize: 16, outline: 'none', fontFamily: 'inherit', border: 'none',
}

// Shown when the user arrives via a password-reset email link
// (AuthContext.recovery is true). Supabase has already established a
// recovery session, so updateUser({ password }) is authorized; on success
// the recovery flag clears and the normal gate takes over.
export default function ResetPassword() {
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    const { error: err } = await updatePassword(password)
    setBusy(false)
    if (err) { setError(err.message); return }
    // On success recovery clears and the app proceeds. No further UI needed.
  }

  return (
    <div style={{
      flex: '1 0 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '24px 24px calc(24px + env(safe-area-inset-bottom))', gap: 24,
      minHeight: '100%', boxSizing: 'border-box',
    }}>
      <div>
        <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Set a new password
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5 }}>
          Choose a new password for your AVIARA account.
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          type="password" autoComplete="new-password" placeholder="New password"
          value={password} onChange={e => setPassword(e.target.value)}
          style={INPUT_STYLE}
        />
        <input
          type="password" autoComplete="new-password" placeholder="Confirm new password"
          value={confirm} onChange={e => setConfirm(e.target.value)}
          style={INPUT_STYLE}
        />

        {error && (
          <div style={{ fontSize: 12, color: 'var(--danger)', lineHeight: 1.4 }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={busy || !password || !confirm}
          style={{
            width: '100%', height: 50, borderRadius: 14, border: 'none',
            cursor: busy ? 'default' : 'pointer',
            background: 'var(--text)', color: 'var(--bg)',
            fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px',
            opacity: (!password || !confirm) ? 0.5 : 1,
          }}
        >
          {busy ? 'Saving…' : 'Save Password'}
        </button>
      </form>
    </div>
  )
}
