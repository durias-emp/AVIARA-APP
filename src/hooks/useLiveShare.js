// Whether this pilot is currently broadcasting their position, and to whom.
//
// Three modes, because the honest answer to "when should this be on" differs by
// pilot. Off is the default and stays the default: nothing about a location
// feature may become opt-out.
//
//   off        never publish. The row is deleted if one exists.
//   recording  publish only while a flight recording is running. Sharing gets
//              its start and stop from something the pilot already does, and
//              nobody is broadcast while parked or driving to the field.
//   always     publish whenever the app is open. Closest to a presence list,
//              and the one to be careful with: it broadcasts on the ground and
//              at home as readily as in the air.
//   manual     publish only while the pilot has pressed Go Live.

import { useCallback, useEffect, useRef, useState } from 'react'
import { get, put } from '../lib/db'
import { publishPosition, withdrawPosition, liveSharingAvailable } from '../lib/livePositions'

export const LIVE_SHARE_KEY = 'liveShare'
export const LIVE_SHARE_MODES = [
  { key: 'off',       label: 'Off',                sub: 'Nobody sees your position' },
  { key: 'recording', label: 'While recording',    sub: 'Only during a recorded flight' },
  { key: 'always',    label: 'Whenever app is open', sub: 'Including on the ground' },
  { key: 'manual',    label: 'Only when I go live', sub: 'You start and stop it yourself' },
]

// Often enough that a marker moves like an aircraft, seldom enough that it is
// not a write every GPS tick. A friend's position being fifteen seconds old is
// not a problem the feature has to solve.
const PUBLISH_MS = 15000

export function useLiveShare({ coords, recording }) {
  const [mode, setModeState] = useState('off')
  const [goLive, setGoLive] = useState(false)
  // Read once. A mode that arrived after the first publish decision would mean
  // publishing under a default the pilot may have turned off months ago.
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    get('settings', LIVE_SHARE_KEY)
      .then(row => { if (row?.value) setModeState(row.value) })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const setMode = useCallback(next => {
    setModeState(next)
    put('settings', { key: LIVE_SHARE_KEY, value: next }).catch(() => {})
    // Leaving manual mode drops any live session with it, so a pilot cannot end
    // up broadcasting under a mode they have switched away from.
    if (next !== 'manual') setGoLive(false)
    if (next === 'off') withdrawPosition()
  }, [])

  const sharing = loaded && liveSharingAvailable() && (
    mode === 'always' || (mode === 'recording' && recording) || (mode === 'manual' && goLive)
  )

  // Read through a ref so a new fix every second does not tear down and rebuild
  // the interval, which would publish on every fix and defeat the point of one.
  // Seeded with null rather than with coords: a ref initialised from a value
  // the compiler owns is treated as aliasing it, and writing through the alias
  // is rejected.
  const coordsRef = useRef(null)
  useEffect(() => { coordsRef.current = coords }, [coords])

  // The last thing published, so stopping can be told apart from never having
  // started. Withdrawing on every teardown would fire a delete for pilots who
  // have never shared anything.
  const publishedRef = useRef(false)

  useEffect(() => {
    if (!sharing) return
    let cancelled = false
    const send = () => {
      const c = coordsRef.current
      if (!c || cancelled) return
      publishedRef.current = true
      publishPosition({
        lat: c.lat, lon: c.lon,
        altFt: c.altFt != null ? Math.round(c.altFt) : null,
        trackDeg: c.headingDeg != null ? Math.round(c.headingDeg) : null,
        groundKt: c.speedKt != null ? Math.round(c.speedKt) : null,
      })
    }
    send()
    const t = setInterval(send, PUBLISH_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [sharing])

  // Stopping, whichever way it happened: the mode changed, the recording ended,
  // Go Live was switched off, or the screen went away.
  useEffect(() => {
    if (sharing || !publishedRef.current) return
    publishedRef.current = false
    withdrawPosition()
  }, [sharing])

  useEffect(() => () => { if (publishedRef.current) withdrawPosition() }, [])

  return { mode, setMode, sharing, goLive, setGoLive }
}
