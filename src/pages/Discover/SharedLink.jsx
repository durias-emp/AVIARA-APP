import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { HomeButton } from '../../components/Shell'
import { useAuth } from '../../context/AuthContext'
import { useSocialProfile } from '../../context/SocialProfile'
import { getOrCreateConversation } from '../../lib/messages'
import PostView from './PostView'
import ListingDetail from './ListingDetail'

// Where a shared link lands.
//
// Standalone pages rather than a deep link into Discover's internals.
// Discover navigates entirely by local state on purpose (see its own header
// comment), and threading a URL through that would mean giving it a second,
// parallel notion of "where am I" that only shared links ever use. These
// render the same two views Discover renders, with their own chrome.
//
// The asymmetry between the two is deliberate and follows the RLS:
//
//   a listing is public — `using (true)` in 0002 — so /m/<id> opens for
//   anyone, signed in or not. Sending an aircraft ad to a buyer who doesn't
//   have the app is most of why sharing exists at all
//
//   a post is gated by can_view_posts, so /p/<id> needs a session before
//   there is anything to show. Signed out it asks, rather than rendering an
//   empty shell that looks like the post was deleted

function Frame({ children }) {
  return (
    <div style={{ minHeight: '100dvh', boxSizing: 'border-box', paddingTop: 76, paddingBottom: 24 }}>
      <div style={{ position: 'fixed', top: 20, left: 20, zIndex: 500 }}>
        <HomeButton />
      </div>
      {children}
    </div>
  )
}

function SignInFirst({ what }) {
  const navigate = useNavigate()
  return (
    <div style={{ padding: '0 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
        Sign in to see this {what}
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
        Posts are only visible to pilots the author has accepted, so this one needs an account.
      </p>
      <button
        onClick={() => navigate('/signin')}
        style={{
          width: '100%', maxWidth: 320, height: 50, borderRadius: 14, border: 'none',
          background: 'var(--text)', color: 'var(--bg)', fontFamily: 'inherit',
          fontSize: 15, fontWeight: 700, cursor: 'pointer',
        }}>
        Sign In
      </button>
    </div>
  )
}

export function SharedPost() {
  const { postId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  return (
    <Frame>
      {user
        ? <PostView postId={postId} myId={user.id} onBack={() => navigate('/')} />
        : <SignInFirst what="post" />}
    </Frame>
  )
}

export function SharedListing() {
  const { listingId } = useParams()
  const { user } = useAuth()
  const { profile } = useSocialProfile()
  const navigate = useNavigate()
  const [opened, setOpened] = useState(null)

  // Messaging the seller needs both an account and a social profile — a
  // conversation is between two profiles. A signed-out browser still sees
  // the whole listing; only this button asks for anything.
  //
  // Friends has no route of its own (it opens as a section of Home), so
  // there is nowhere to navigate to that would land on the new thread.
  // Rather than pretend otherwise with a redirect that dumps the pilot on
  // the home screen with no explanation, this says exactly where the
  // conversation now is.
  async function messageSeller(seller) {
    if (!profile || !seller) { navigate('/signin'); return }
    const { data } = await getOrCreateConversation(profile.id, seller.id, Number(listingId))
    setOpened(data ? seller.username : false)
  }

  return (
    <Frame>
      {opened && (
        <div style={{
          margin: '0 18px 14px', padding: '12px 14px', borderRadius: 12,
          background: 'var(--accent-light)', color: 'var(--accent)',
          fontSize: 13, fontWeight: 600, lineHeight: 1.5,
        }}>
          Conversation with @{opened} is open — find it in Friends → Inbox.
        </div>
      )}
      {opened === false && (
        <div style={{
          margin: '0 18px 14px', padding: '12px 14px', borderRadius: 12,
          background: 'rgba(255,59,48,0.12)', color: 'var(--danger)',
          fontSize: 13, fontWeight: 600,
        }}>
          Couldn't start that conversation — try again from Friends.
        </div>
      )}
      <ListingDetail
        listingId={Number(listingId)}
        myId={profile?.id ?? null}
        onBack={() => navigate('/')}
        onMessageSeller={user ? messageSeller : () => navigate('/signin')}
      />
    </Frame>
  )
}
