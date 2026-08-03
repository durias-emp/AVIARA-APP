import { useEffect, useState } from 'react'
import { listOtherPilots, listMyFollows, followUser, unfollowUser } from '../../lib/follows'
import { IconSend, IconSearch } from '../../components/Icons'

// Two halves, deliberately different maturity: the photo/video grid below
// is layout-only (no posts exist yet), but the pilot list + follow buttons
// are the real feature built earlier — moved here from the old flat
// Discover page since "browse and follow other pilots" is exactly what an
// Explore/Search tab is for.

function SkeletonGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} style={{ aspectRatio: '1 / 1', background: 'var(--bg-card-2)' }} />
      ))}
    </div>
  )
}

// status: 'accepted' -> "Following" (tap unfollows), 'pending' -> "Requested"
// (tap cancels), none -> "Follow". 'pending' can't happen yet — nothing
// sets is_private true today — but the button is written for it anyway.
function PilotRow({ pilot, status, onFollow, onUnfollow, onMessage, busy }) {
  const label = status === 'accepted' ? 'Following' : status === 'pending' ? 'Requested' : 'Follow'
  const following = status != null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-card-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0,
      }}>
        {pilot.username[0].toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
        @{pilot.username}
      </div>
      <button
        onClick={() => onMessage(pilot)}
        aria-label={`Message @${pilot.username}`}
        style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0, border: '0.5px solid var(--border)',
          background: 'transparent', color: 'var(--text)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
        }}
      >
        <IconSend size={14} />
      </button>
      <button
        onClick={() => (following ? onUnfollow(pilot.id) : onFollow(pilot))}
        disabled={busy}
        style={{
          padding: '7px 14px', borderRadius: 20, flexShrink: 0,
          border: following ? '1px solid var(--border)' : 'none',
          background: following ? 'transparent' : 'var(--text)',
          color: following ? 'var(--text)' : 'var(--bg)',
          fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {label}
      </button>
    </div>
  )
}

function SearchBar({ value, onChange }) {
  return (
    <div style={{ position: 'relative', margin: '0 16px 10px' }}>
      <span style={{
        position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
        color: 'var(--text-tertiary)', display: 'flex', pointerEvents: 'none',
      }}>
        <IconSearch size={16} />
      </span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search pilots"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 12px 10px 34px', borderRadius: 10,
          border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)',
          fontSize: 14, outline: 'none', fontFamily: 'inherit',
        }}
      />
    </div>
  )
}

function PilotsList({ myId, onMessagePilot }) {
  const [pilots, setPilots] = useState(null)
  const [statuses, setStatuses] = useState({}) // { [followeeId]: 'pending' | 'accepted' }
  const [busyId, setBusyId] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([listOtherPilots(myId), listMyFollows(myId)]).then(([p, f]) => {
      if (cancelled) return
      setPilots(p.data)
      const map = {}
      for (const row of f.data) map[row.followee_id] = row.status
      setStatuses(map)
    })
    return () => { cancelled = true }
  }, [myId])

  async function handleFollow(pilot) {
    setBusyId(pilot.id)
    const { error } = await followUser(myId, pilot.id, pilot.is_private)
    if (!error) setStatuses(s => ({ ...s, [pilot.id]: pilot.is_private ? 'pending' : 'accepted' }))
    setBusyId(null)
  }

  async function handleUnfollow(theirId) {
    setBusyId(theirId)
    const { error } = await unfollowUser(myId, theirId)
    if (!error) setStatuses(s => { const next = { ...s }; delete next[theirId]; return next })
    setBusyId(null)
  }

  const q = search.trim().toLowerCase()
  const visible = q
    ? (pilots ?? []).filter(p => p.username.toLowerCase().includes(q) || (p.display_name ?? '').toLowerCase().includes(q))
    : pilots

  if (pilots === null) return null

  if (pilots.length === 0) {
    return (
      <div style={{ padding: '0 16px', fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
        No other pilots on AVIARA yet — you're the first.
      </div>
    )
  }

  return (
    <div>
      <SearchBar value={search} onChange={setSearch} />
      {visible.length === 0 ? (
        <div style={{ padding: '0 16px', fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          No pilots match &ldquo;{search.trim()}&rdquo;.
        </div>
      ) : (
        visible.map(p => (
          <PilotRow
            key={p.id} pilot={p} status={statuses[p.id]}
            onFollow={handleFollow} onUnfollow={handleUnfollow} onMessage={onMessagePilot}
            busy={busyId === p.id}
          />
        ))
      )}
    </div>
  )
}

export default function ExploreTab({ myId, onMessagePilot }) {
  return (
    <div style={{ paddingTop: 4 }}>
      <div style={{
        margin: '12px 16px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--text-tertiary)',
      }}>
        Pilots on AVIARA
      </div>
      <PilotsList myId={myId} onMessagePilot={onMessagePilot} />

      <div style={{
        margin: '20px 16px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--text-tertiary)',
      }}>
        Photos &amp; Videos
      </div>
      <SkeletonGrid />
    </div>
  )
}
