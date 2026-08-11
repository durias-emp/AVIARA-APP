// What each app reports without being opened.
//
// The long rows carried this: the field's category, the fixes in the active
// plan, the messages waiting. Removing them for app tiles would have thrown all
// of it away and left a menu, which is the thing the rows existed to stop this
// screen becoming. So the reporting moves onto the tiles as badges, the way a
// phone puts a count on an icon.
//
// One hook so the tiles cannot disagree with the sections they open, and so the
// weather is fetched once for a screen that shows it in two places.

import { useEffect, useState } from 'react'
import { get } from '../lib/db'
import { loadWeather, parseFltCat } from '../lib/weather'
import { resolveHomeIdent, HOME_AIRPORT_EVENT } from '../lib/homeBase'
import { hasUnreadMessages } from '../lib/messages'

export function useHomeAirportWx() {
  const [icao, setIcao] = useState('')
  const [wx, setWx] = useState(null)   // { icao, data }

  useEffect(() => {
    let cancelled = false
    const load = () => resolveHomeIdent()
      .then(id => { if (!cancelled && id) setIcao(id) })
      .catch(() => {})
    load()
    window.addEventListener(HOME_AIRPORT_EVENT, load)
    return () => { cancelled = true; window.removeEventListener(HOME_AIRPORT_EVENT, load) }
  }, [])

  useEffect(() => {
    if (!icao) return
    let cancelled = false
    get('weather', icao).then(c => { if (!cancelled && c) setWx({ icao, data: c }) }).catch(() => {})
    loadWeather(icao).then(w => { if (!cancelled) setWx({ icao, data: w }) }).catch(() => {})
    return () => { cancelled = true }
  }, [icao])

  // Stamped with its field, so a report for the airport we just left is
  // discarded by not matching rather than by being cleared on the way in.
  const metar = wx?.icao === icao ? wx.data?.metar : null
  return { icao, cat: metar ? parseFltCat(metar) : null }
}

export function useUnreadCount(userId) {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (!userId) return
    let alive = true
    const load = () => hasUnreadMessages(userId)
      .then(({ count }) => { if (alive) setUnread(count ?? 0) })
      .catch(() => {})
    load()
    window.addEventListener('focus', load)
    return () => { alive = false; window.removeEventListener('focus', load) }
  }, [userId])
  // Derived, so a count belonging to whoever was signed in a moment ago cannot
  // survive into the signed-out badge.
  return userId ? unread : 0
}
