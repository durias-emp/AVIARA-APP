// Which friends are up right now.
//
// Polled rather than subscribed. A realtime channel would be the obvious reach,
// but positions are published every fifteen seconds and read by a screen that
// is often in a pocket: a standing socket buys freshness nobody can see and
// costs a connection the app has to keep alive. The same reasoning the unread
// badge already follows.

import { useEffect, useState } from 'react'
import { listFriendsAloft } from '../lib/livePositions'

const POLL_MS = 20000

export function useFriendsAloft(enabled) {
  const [friends, setFriends] = useState([])

  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () => listFriendsAloft().then(({ data }) => {
      if (alive) setFriends(data ?? [])
    }).catch(() => {})
    load()
    const t = setInterval(load, POLL_MS)
    // Coming back to the app should not wait out the rest of an interval to
    // find out who has taken off since.
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])

  // Derived rather than cleared in the effect: switching the layer off must
  // show nobody immediately, and a list emptied by a later write would leave
  // friends on the map for one render after the pilot turned them off.
  return enabled ? friends : []
}
