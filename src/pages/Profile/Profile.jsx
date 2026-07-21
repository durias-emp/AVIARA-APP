import { useState, useEffect } from 'react'
import { usePilotProfile } from '../../context/PilotProfile'
import { useAuth } from '../../context/AuthContext'
import { BackButton } from '../../components/Shell'
import { SegControl, UNIT_ROWS } from '../Onboarding/Onboarding'
import { get } from '../../lib/db'
import { pushAllToCloud, clearLocalData } from '../../lib/sync'
import { getCurrencyStatus, fmtDate } from '../../lib/currency'

const STATUS_COLOR = {
  valid:      { color: 'var(--ok)',     bg: 'var(--ok-light)' },
  expiring:   { color: 'var(--warn)',   bg: 'var(--warn-light)' },
  expired:    { color: 'var(--danger)', bg: 'var(--danger-light)' },
  incomplete: { color: 'var(--text-tertiary)', bg: 'var(--bg-card-2)' },
}

const STATUS_LABEL = {
  valid: 'Valid',
  expiring: 'Expiring soon',
  expired: 'Expired',
  incomplete: 'Not set',
}

function StatusRow({ label, status, expiresOn }) {
  const c = STATUS_COLOR[status.status] ?? STATUS_COLOR.incomplete
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {expiresOn && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Expires {fmtDate(expiresOn)}
          </div>
        )}
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.2px',
        color: c.color, background: c.bg,
        padding: '3px 9px', borderRadius: 10,
      }}>
        {STATUS_LABEL[status.status] ?? 'Not set'}
      </span>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder ?? ''}
      style={{
        width: '100%', padding: '11px 13px', borderRadius: 'var(--r-sm)',
        border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
        color: 'var(--text)', fontSize: 15, outline: 'none',
        fontFamily: 'inherit',
      }}
    />
  )
}

export default function Profile() {
  const { profile, setProfile } = usePilotProfile()
  const { user, signOut } = useAuth()
  const [currencyData, setCurrencyData] = useState(null)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    get('currency', 'profile').then(saved => setCurrencyData(saved ?? {}))
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    // Push a final backup while we still have a session, then wipe local
    // data so the next account starts clean, then sign out. The reload
    // resets all in-memory state and lands on the sign-in gate.
    await pushAllToCloud().catch(() => {})
    await clearLocalData().catch(() => {})
    await signOut().catch(() => {})
    window.location.reload()
  }

  if (!profile) return null

  function update(patch) {
    setProfile(patch)
  }

  let medicalStatus = { status: 'incomplete' }
  let currentStatus = { status: 'incomplete' }
  if (currencyData) {
    const toNumericClass = v => {
      if (v === 1 || v === 2 || v === 3) return v
      return { '1st': 1, '2nd': 2, '3rd': 3 }[v] ?? null
    }
    const medical = {
      examDate: currencyData.medical?.examDate || profile.medDate || '',
      dob:      currencyData.medical?.dob      || profile.dob || '',
      medClass: toNumericClass(currencyData.medical?.medClass ?? profile.medClass),
    }
    const current = {
      flightReviewDate: currencyData.current?.flightReviewDate || profile.flightReview?.completionDate || '',
    }
    const result = getCurrencyStatus({ medical, current })
    medicalStatus = result.valid
    currentStatus = result.current
  }

  return (
    <div style={{ padding: '0 0 32px' }}>
      <div style={{ padding: '18px 18px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton />
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.4px' }}>Pilot Profile</div>
      </div>

      <div style={{ padding: '0 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Name">
            <TextInput value={profile.name} onChange={v => update({ name: v })} placeholder="Pilot name" />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={profile.email} onChange={v => update({ email: v })} placeholder="you@example.com" />
          </Field>
          <Field label="Phone">
            <TextInput type="tel" value={profile.phone} onChange={v => update({ phone: v })} placeholder="+1 555 123 4567" />
          </Field>
          <Field label="Certificate">
            <TextInput value={profile.certificate} onChange={v => update({ certificate: v })} placeholder="Private, Commercial, ATP..." />
          </Field>
          <Field label="Home airport (ICAO)">
            <TextInput value={profile.homeAirport} onChange={v => update({ homeAirport: v.toUpperCase() })} placeholder="CYQB" />
          </Field>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 4px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Currency</span>
          </div>
          <StatusRow label="Medical validity" status={medicalStatus} expiresOn={medicalStatus.expiresOn} />
          <StatusRow label="Pilot currency" status={currentStatus} expiresOn={currentStatus.expiresOn} />
        </div>

        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 4px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Units</span>
          </div>
          {UNIT_ROWS.map(row => (
            <div key={row.key} style={{ padding: '10px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, letterSpacing: '0.01em' }}>{row.label}</div>
              <SegControl
                options={row.options}
                value={profile[row.key] ?? row.default}
                onChange={v => update({ [row.key]: v })}
              />
            </div>
          ))}
        </div>

        {/* Account */}
        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px 4px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Account</span>
          </div>
          {user?.email && (
            <div style={{ padding: '4px 16px 12px', fontSize: 13, color: 'var(--text-secondary)' }}>
              Signed in as <span style={{ color: 'var(--text)', fontWeight: 600 }}>{user.email}</span>
            </div>
          )}
          <div style={{ padding: '0 16px 16px' }}>
            <button
              onClick={() => setConfirmSignOut(true)}
              style={{
                width: '100%', padding: '12px', borderRadius: 'var(--r-sm)', border: 'none',
                background: 'var(--danger-light)', color: 'var(--danger)',
                fontSize: 15, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {confirmSignOut && (
        <div
          onClick={() => !signingOut && setConfirmSignOut(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 600,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 340, background: 'var(--bg-card)', borderRadius: 16,
            padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Sign out?</div>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 18 }}>
              Your data is backed up and will be restored when you sign back in. This device will be cleared.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmSignOut(false)}
                disabled={signingOut}
                style={{
                  flex: 1, padding: '12px', borderRadius: 'var(--r-sm)', border: 'none',
                  background: 'var(--bg-card-2)', color: 'var(--text)',
                  fontSize: 15, fontWeight: 600, cursor: signingOut ? 'default' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                style={{
                  flex: 1, padding: '12px', borderRadius: 'var(--r-sm)', border: 'none',
                  background: 'var(--danger)', color: '#fff',
                  fontSize: 15, fontWeight: 600, cursor: signingOut ? 'default' : 'pointer',
                  opacity: signingOut ? 0.7 : 1,
                }}
              >
                {signingOut ? 'Signing out…' : 'Sign Out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
