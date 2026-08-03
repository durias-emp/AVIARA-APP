import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { HomeButton } from '../../components/Shell'
import { IconHome, IconSearch, IconPlane, IconPerson, IconSend } from '../../components/Icons'
import { useSocialProfile } from '../../context/SocialProfile'
import { useAuth } from '../../context/AuthContext'
import { getOrCreateConversation, hasUnreadMessages } from '../../lib/messages'
import FeedTab from './FeedTab'
import ExploreTab from './ExploreTab'
import MarketplaceTab from './MarketplaceTab'
import ProfileTab from './ProfileTab'
import Inbox from './Inbox'
import Conversation from './Conversation'

// Deliberately doesn't look like the rest of AVIARA — no BackButton/title
// header like Tools or Settings use. A bottom tab bar + a small floating
// exit button (same corner convention as MapView's own HomeButton) instead,
// so this reads as its own app you've stepped into, matching Instagram/
// TikTok's own chrome, not a section page shaped like everything else here.
//
// Tab order (left to right): Feed, Explore, Marketplace, Profile — mirrors
// Instagram's real tab bar (Home / Search / [center slot] / Profile), with
// the center slot swapped for the marketplace instead of post-creation.

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

function CreateProfile() {
  const { createProfile } = useSocialProfile()
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const username = raw.trim().toLowerCase()
  const valid = USERNAME_RE.test(username)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await createProfile(username)
    setBusy(false)
    if (err) {
      // 23505 = Postgres unique_violation — the one failure mode that's
      // actually the pilot's to fix, not a real error to apologize for.
      setError(err.code === '23505' ? 'That username is taken — try another.' : 'Something went wrong — try again.')
    }
  }

  return (
    <div style={{ padding: '32px 24px 0', position: 'relative', minHeight: '100dvh', boxSizing: 'border-box' }}>
      <div style={{ position: 'absolute', top: 20, left: 20 }}>
        <HomeButton />
      </div>
      <div style={{ paddingTop: 44 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
          Pick a username
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
          This is how other pilots will find and follow you on Discover —
          lowercase letters, numbers, and underscores, 3–20 characters.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-tertiary)', fontSize: 16, pointerEvents: 'none',
            }}>@</span>
            <input
              autoFocus
              value={raw}
              onChange={e => setRaw(e.target.value)}
              placeholder="yourhandle"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '13px 14px 13px 30px',
                borderRadius: 'var(--r-sm)', border: 'none', background: 'var(--bg-card-2)',
                color: 'var(--text)', fontSize: 16, outline: 'none', fontFamily: 'inherit',
              }}
            />
          </div>
          {raw && !valid && (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
              Lowercase letters, numbers, and underscores only — 3 to 20 characters.
            </div>
          )}
          {error && (
            <div style={{ fontSize: 12, color: 'var(--danger)', lineHeight: 1.4 }}>{error}</div>
          )}
          <button
            type="submit"
            disabled={!valid || busy}
            style={{
              width: '100%', height: 50, borderRadius: 14, border: 'none',
              cursor: (!valid || busy) ? 'default' : 'pointer',
              background: 'var(--text)', color: 'var(--bg)',
              fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px',
              opacity: (!valid || busy) ? 0.5 : 1, marginTop: 6,
            }}
          >
            {busy ? 'Creating…' : 'Create profile'}
          </button>
        </form>
      </div>
    </div>
  )
}

const TABS = [
  { key: 'feed',        label: 'Feed',        Icon: IconHome },
  { key: 'explore',      label: 'Explore',     Icon: IconSearch },
  { key: 'marketplace', label: 'Marketplace', Icon: IconPlane },
  { key: 'profile',     label: 'Profile',     Icon: IconPerson },
]
const TAB_BAR_HEIGHT = 58

function TabBar({ active, onChange }) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 500,
      display: 'flex', height: TAB_BAR_HEIGHT,
      background: 'var(--bg-card)', borderTop: '0.5px solid var(--border)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {TABS.map(({ key, label, Icon }) => {
        const isActive = active === key
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            aria-label={label}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 2, border: 'none', background: 'none', cursor: 'pointer',
              color: isActive ? 'var(--text)' : 'var(--text-tertiary)',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <Icon size={23} filled={isActive} />
          </button>
        )
      })}
    </div>
  )
}

// dmScreen: null (normal tabs) | 'inbox' (conversation list) |
// { conversationId, otherProfile } (open thread). Kept as local state, not
// a route — Discover has no router-based internal navigation anywhere else
// (see the file-level comment above), and DM screens follow the same
// "own app" convention rather than introducing one just for this.
function DiscoverShell({ profile }) {
  const [tab, setTab] = useState('feed')
  const [dmScreen, setDmScreen] = useState(null)
  const [unread, setUnread] = useState(false)

  const refreshUnread = useCallback(() => {
    hasUnreadMessages(profile.id).then(({ count }) => setUnread(count > 0))
  }, [profile.id])

  useEffect(() => { refreshUnread() }, [refreshUnread])

  function openInbox() { setDmScreen('inbox') }
  function closeInbox() { setDmScreen(null); refreshUnread() }
  function openConversation(conversationId, otherProfile) { setDmScreen({ conversationId, otherProfile }) }

  async function messagePilot(pilot) {
    const { data } = await getOrCreateConversation(profile.id, pilot.id)
    if (data) openConversation(data.id, pilot)
  }

  if (dmScreen === 'inbox') {
    return <Inbox myId={profile.id} onOpen={c => openConversation(c.id, c.otherProfile)} onBack={closeInbox} />
  }
  if (dmScreen) {
    return (
      <Conversation
        myId={profile.id}
        conversationId={dmScreen.conversationId}
        otherProfile={dmScreen.otherProfile}
        onBack={() => setDmScreen('inbox')}
      />
    )
  }

  return (
    <div style={{ minHeight: '100dvh', boxSizing: 'border-box', paddingBottom: TAB_BAR_HEIGHT + 12 }}>
      <div style={{ position: 'fixed', top: 20, left: 20, zIndex: 500 }}>
        <HomeButton />
      </div>
      <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 500 }}>
        <button
          onClick={openInbox}
          aria-label="Messages"
          style={{
            width: 40, height: 40, borderRadius: '50%', border: 'none', position: 'relative',
            background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--text)', WebkitTapHighlightColor: 'transparent',
          }}>
          <IconSend size={18} />
          {unread && (
            <span style={{
              position: 'absolute', top: 3, right: 3, width: 9, height: 9, borderRadius: '50%',
              background: 'var(--danger)', border: '1.5px solid var(--bg-card)',
            }} />
          )}
        </button>
      </div>

      <div style={{ paddingTop: 76 }}>
        {tab === 'feed' && <FeedTab />}
        {tab === 'explore' && <ExploreTab myId={profile.id} onMessagePilot={messagePilot} />}
        {tab === 'marketplace' && <MarketplaceTab />}
        {tab === 'profile' && <ProfileTab profile={profile} />}
      </div>

      <TabBar active={tab} onChange={setTab} />
    </div>
  )
}

// Friends needs an account (it's inherently about other people, DMs, and a
// shared identity) even though the rest of the app doesn't. Shown instead of
// CreateProfile when signed out, so tapping "Create profile" while signed
// out doesn't silently fail with a vague error — it's a distinct message
// with a distinct action.
function SignInPrompt() {
  const navigate = useNavigate()
  return (
    <div style={{ padding: '32px 24px 0', position: 'relative', minHeight: '100dvh', boxSizing: 'border-box' }}>
      <div style={{ position: 'absolute', top: 20, left: 20 }}>
        <HomeButton />
      </div>
      <div style={{ paddingTop: 44 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
          Sign in to use Friends
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
          Following pilots, posting, and messaging need an account — everything else in AVIARA works without one.
        </p>
        <button
          onClick={() => navigate('/signin')}
          style={{
            width: '100%', height: 50, borderRadius: 14, border: 'none',
            background: 'var(--text)', color: 'var(--bg)',
            fontSize: 15, fontWeight: 700, letterSpacing: '-0.2px', cursor: 'pointer',
          }}
        >
          Sign In
        </button>
      </div>
    </div>
  )
}

export default function Discover() {
  const { user } = useAuth()
  const { profile } = useSocialProfile()

  if (!user) return <SignInPrompt />

  // undefined = still checking for a profiles row — render nothing rather
  // than flash the username prompt before that resolves.
  if (profile === null) return <CreateProfile />
  if (profile) return <DiscoverShell profile={profile} />
  return null
}
