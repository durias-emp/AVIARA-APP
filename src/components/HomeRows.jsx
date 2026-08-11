/* ── The home rows ──────────────────────────────────────────────────────
   The instrument-panel list from main's home screen, lifted out of that
   screen so the map home can mount the same rows instead of a second, plainer
   copy of the same list.

   The point of these is not the buttons. It is what each one reports without
   being opened: the field's category and temperature, whether the medical is
   current, how many fixes are in the active plan, how many messages are
   waiting. A grid of icons and labels is a menu; this is a panel.

   Black with a hairline white border on purpose. Over a map that is sometimes
   bright sectional and sometimes dark satellite, a black card is legible
   against both, and the hairline is what keeps its edge visible when the map
   behind it happens to be dark too. They are deliberately NOT themed: a light
   theme put two white buttons at the bottom of a column of black ones, which
   is the bug this shape replaced.

   Fixed left half, glyph then label, so the eye finds the same thing in the
   same place on every row. Everything live goes right, where the rows are free
   to differ. ── */

import { useState, useEffect } from 'react'
import { get } from '../lib/db'
import { loadWeather, parseFltCat, parseWind, parseTemp } from '../lib/weather'
import { getCondition } from './WeatherAnimation'
import { loadAreaWeather, conditionFromArea, areaTemp, areaWind } from '../lib/areaWeather'
import { findAirport } from '../lib/aerodromes'
import { resolveHomeIdent, setHomeIdent, HOME_AIRPORT_EVENT } from '../lib/homeBase'
import { usePilotProfile } from '../context/PilotProfile'
import { useLogbook } from '../context/Logbook'
import { computeTotalHours } from '../lib/logbookFields'
import { useAuth } from '../context/AuthContext'
import { hasUnreadMessages } from '../lib/messages'
import { haversineNm } from '../lib/geo'
import AirportPickerModal from './AirportPickerModal'
import { IconRunways, IconHangar, IconHelmet, IconRoute, IconSky, IconFriends } from './Icons'

// Uniform size for every row, small enough that the whole list plus the
// two-up pair at the bottom fits one sheet without scrolling on the shortest
// phones the app supports.
export const HERO_HEIGHT = 64
export const ROW_GAP = 8

const CARD_BG = '#0d0d0f'
const CARD_BORDER = '1px solid rgba(255,255,255,0.18)'

export function HeroCard({ Icon, label, sublabel, right, onOpen, ariaLabel }) {
  return (
    <div style={{ padding: `${ROW_GAP}px 0 0` }}>
      <div onClick={onOpen} role="button" tabIndex={0} aria-label={ariaLabel}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 11,
          height: HERO_HEIGHT, boxSizing: 'border-box', padding: '0 14px',
          borderRadius: 16, background: CARD_BG, border: CARD_BORDER,
          cursor: 'pointer', WebkitTapHighlightColor: 'transparent', overflow: 'hidden',
        }}>
        <span style={{ color: '#fff', display: 'flex', flexShrink: 0 }}><Icon size={22} /></span>
        <span style={{ minWidth: 0, flexShrink: 0 }}>
          <span style={{
            display: 'block', fontSize: 15, fontWeight: 700, color: '#fff',
            letterSpacing: '-0.2px', whiteSpace: 'nowrap',
          }}>{label}</span>
          {sublabel && (
            <span style={{ display: 'block', fontSize: 10.5, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>
              {sublabel}
            </span>
          )}
        </span>
        <span style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 9,
          minWidth: 0, justifyContent: 'flex-end',
        }}>{right}</span>
      </div>
    </div>
  )
}

// Flight category, as a pill. Same colours the Airports page uses.
function CatPill({ cat }) {
  if (!cat) return null
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '0.05em', color: '#fff',
      background: cat.color, padding: '2px 7px', borderRadius: 20, flexShrink: 0,
    }}>{cat.label}</span>
  )
}

/* ── Module card, the compact two-up pair at the bottom of the list ── */
export function ModuleCard({ onOpen, Icon, label }) {
  return (
    <div onClick={onOpen} role="button" tabIndex={0} aria-label={`Open ${label}`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      style={{
        cursor: 'pointer',
        background: CARD_BG, border: CARD_BORDER, borderRadius: 16,
        display: 'flex', alignItems: 'center', gap: 10,
        height: HERO_HEIGHT, boxSizing: 'border-box', padding: '0 14px',
        minWidth: 0, WebkitTapHighlightColor: 'transparent',
      }}>
      <span style={{ color: '#fff', display: 'flex', flexShrink: 0 }}>
        <Icon size={22} />
      </span>
      <div style={{
        fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: '-0.2px',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </div>
    </div>
  )
}

/* ── Airports ───────────────────────────────────────────────────────────
   The field the pilot flies from, with what it is doing right now. ── */
export function AirportsHeroCard({ onOpen }) {
  const { profile } = usePilotProfile()
  const units = profile ?? {}
  const [icao, setIcao] = useState('')
  const [pickerOpen, setPicker] = useState(false)
  // Weather is stamped with the field it describes, rather than held in a bare
  // slot beside a separate loading flag. Two things fall out of that: "still
  // loading" is simply "what we have is not for this field yet", so there is no
  // flag to keep in step, and the row can never show the previous airport's
  // METAR under the new airport's name while a fetch is in flight.
  const [wx, setWx] = useState(null)   // { icao, data }

  // resolveHomeIdent rather than a raw read of settings/homeAirport: the base
  // is written in two places by two flows, and this screen showing one while
  // the planner shows the other is the disagreement that helper exists to end.
  useEffect(() => {
    let cancelled = false
    const load = (firstRun = false) => resolveHomeIdent().then(ident => {
      if (cancelled) return
      if (ident) setIcao(ident)
      else if (firstRun) setPicker(true)
    }).catch(() => {})
    load(true)
    const onChanged = () => load(false)
    window.addEventListener(HOME_AIRPORT_EVENT, onChanged)
    return () => { cancelled = true; window.removeEventListener(HOME_AIRPORT_EVENT, onChanged) }
  }, [])

  useEffect(() => {
    if (!icao) return
    let cancelled = false
    get('weather', icao).then(cached => { if (!cancelled && cached) setWx({ icao, data: cached }) })
    loadWeather(icao)
      .then(w => { if (!cancelled) setWx({ icao, data: w }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [icao])
  const metar = wx?.icao === icao ? wx.data : null
  const loading = !!icao && !metar

  // A great many fields publish no METAR, which is the whole reason the
  // Airports page grew its substitute-weather cards. Without this the row would
  // fall back to "clear" for every one of them and paint a confident blue sky
  // over an airport it knows nothing about.
  //
  // Only fetched once AWC has actually answered "nothing here" (noReport),
  // never on a failed lookup, and never for a field that does report.
  // Stamped with its field for the same reason, which also removes the reset:
  // an estimate for the airport we just left is discarded by not matching,
  // rather than by being cleared on the way in.
  const [areaWx, setAreaWx] = useState(null)   // { icao, data }
  useEffect(() => {
    if (!icao || !metar?.noReport) return
    let cancelled = false
    findAirport(icao).then(hit => {
      if (cancelled || !hit) return
      return loadAreaWeather(icao, hit.lat, hit.lon)
        .then(a => { if (!cancelled) setAreaWx({ icao, data: a }) })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [icao, metar?.noReport])
  const area = areaWx?.icao === icao ? areaWx.data : null
  const areaSky = area ? conditionFromArea(area) : null

  const sky = getCondition(metar?.metar ?? null)
  const resolved = metar?.metar ? sky : areaSky

  function confirmAirport(id) {
    setHomeIdent(id)
    setIcao(id)
    setPicker(false)
  }

  // The picker is reachable regardless of whether icao happens to be set:
  // pickerOpen can be true with an empty icao, when no base has ever been
  // chosen. An earlier version nested it inside the branch below, whose own
  // guard required !pickerOpen to be entered, so it could never render.
  if (pickerOpen) {
    return <AirportPickerModal current={icao} onConfirm={confirmAirport} onClose={() => setPicker(false)} />
  }

  if (!icao) {
    return (
      <HeroCard
        Icon={IconRunways}
        label="Airports"
        sublabel="No home airport"
        onOpen={() => setPicker(true)}
        ariaLabel="Set home airport"
        right={<span style={{ fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>+ Set</span>}
      />
    )
  }

  const cat = metar?.metar ? parseFltCat(metar.metar) : null
  // A field with no station of its own still gets the right illustration: the
  // model estimate stands in, so it does not show a sunny scene in a storm.
  const condition = resolved?.type ?? sky.type

  return (
    <HeroCard
      Icon={IconRunways}
      label="Airports"
      onOpen={() => onOpen('airports')}
      ariaLabel="Open airports"
      right={
        <>
          <span style={{
            fontSize: 13, fontWeight: 800, color: '#fff', fontFamily: 'monospace',
            letterSpacing: '0.04em', flexShrink: 0,
          }}>{icao}</span>
          <span style={{ color: '#fff', display: 'flex', flexShrink: 0, opacity: 0.95 }}>
            <IconSky type={condition} size={21} />
          </span>
          <CatPill cat={cat} />
          <span style={{
            fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.82)',
            whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums',
          }}>
            {metar?.metar
              ? `${parseTemp(metar.metar, units)} · ${parseWind(metar.metar, units)}`
              // Numbers from the model at the field's coordinates. No category
              // pill on this path (cat stays null without a published METAR),
              // so the row never asserts VFR on the strength of a forecast.
              : area ? `${areaTemp(area, units)} · ${areaWind(area, units)}`
              : loading ? 'Loading...' : '-'}
          </span>
        </>
      }
    />
  )
}

/* ── Hangar ── */
export function HangarCard({ aircraftImage, activeAircraft, aircraftCount = 0, onOpen }) {
  const empty = aircraftCount === 0
  const tail = activeAircraft?.tail || activeAircraft?.registration || activeAircraft?.name || null

  return (
    <HeroCard
      Icon={IconHangar}
      label="Hangar"
      sublabel={empty ? 'No aircraft yet' : tail}
      onOpen={() => onOpen('hangar')}
      ariaLabel={empty ? 'Add aircraft' : 'Open hangar'}
      right={
        empty ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>+ Add</span>
        ) : (
          <>
            {aircraftImage && (
              <img src={aircraftImage} alt="" style={{
                width: 46, height: 32, objectFit: 'cover', borderRadius: 7,
                border: '1px solid rgba(255,255,255,0.22)', flexShrink: 0,
              }} />
            )}
            {/* Airworthiness at a glance. Grey until there is something to
                report: a green dot for data the app does not have would be the
                same lie the pilot's medical dot deliberately avoids. */}
            <span title="Maintenance status" style={{
              width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(255,255,255,0.28)',
              boxShadow: '0 0 0 1.5px rgba(255,255,255,0.18)',
            }} />
          </>
        )
      }
    />
  )
}

/* ── Flight plan ── */
export function FlightPlanCard({ route, onOpen }) {
  // Distance is summed across the legs rather than measured origin to
  // destination, so a route that doglegs reads longer than the straight line,
  // which is the number that matters. No ETE: that needs a groundspeed this
  // row has no honest source for on the ground.
  const legs = route?.length >= 2 ? route : null
  const totalNm = legs
    ? legs.slice(1).reduce((sum, wp, i) => sum + haversineNm(legs[i].lat, legs[i].lon, wp.lat, wp.lon), 0)
    : 0

  return (
    <HeroCard
      Icon={IconRoute}
      label="FPL"
      sublabel={legs ? `${legs.length} fixes` : null}
      onOpen={() => onOpen('flight')}
      ariaLabel="Open flight planning"
      right={legs ? (
        <span style={{ textAlign: 'right', lineHeight: 1.35, minWidth: 0 }}>
          <span style={{
            display: 'block', fontSize: 12, fontWeight: 700, color: '#fff',
            fontFamily: 'monospace', letterSpacing: '0.04em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {legs[0].name} to {legs[legs.length - 1].name}
          </span>
          <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' }}>
            {totalNm.toFixed(0)} NM
          </span>
        </span>
      ) : (
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>No active route</span>
      )}
    />
  )
}

/* ── Social ─────────────────────────────────────────────────────────────
   Still Discover.jsx internally, and at /discover: this is a user-facing
   label change, not a restructuring. ── */
export function DiscoverCard({ onOpen }) {
  const { user } = useAuth()
  const [unread, setUnread] = useState(0)

  // Polled on mount and whenever the app regains focus. A standing realtime
  // subscription just to paint a badge is the first step toward a notification
  // system this pass is not building.
  useEffect(() => {
    if (!user?.id) return
    let alive = true
    const load = () => hasUnreadMessages(user.id)
      .then(({ count }) => { if (alive) setUnread(count ?? 0) })
      .catch(() => {})
    load()
    window.addEventListener('focus', load)
    return () => { alive = false; window.removeEventListener('focus', load) }
  }, [user?.id])
  // Derived rather than reset on sign-out: a count belonging to whoever was
  // signed in a moment ago must not survive into the signed-out badge, and
  // deriving it means there is no stale write to race.
  const shown = user?.id ? unread : 0

  return (
    <HeroCard
      Icon={IconFriends}
      label="Social"
      onOpen={() => onOpen('discover')}
      ariaLabel="Open social"
      right={shown > 0 ? (
        <span style={{
          minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10,
          background: 'var(--danger)', color: '#fff',
          fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{shown > 99 ? '99+' : shown}</span>
      ) : null}
    />
  )
}

/* ── Pilot ──────────────────────────────────────────────────────────────
   Grey, deliberately, for incomplete or unknown. A dot sitting next to the
   word "Medical" is a claim about the medical, and showing green for one
   nobody has entered would be the app asserting something it does not know. ── */
const STATUS_DOT = {
  expired:  'var(--danger)',
  expiring: 'var(--warn)',
  valid:    'var(--ok)',
}
function statusDotColor(status) {
  return STATUS_DOT[status] ?? 'rgba(255,255,255,0.35)'
}

function StatusLine({ label, status }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
      <span>{label}</span>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: statusDotColor(status),
        boxShadow: '0 0 0 1.5px rgba(255,255,255,0.55)',
      }} />
    </div>
  )
}

export function PilotRow({ currencyCards, onOpen }) {
  const { entries } = useLogbook()
  const totalHours = computeTotalHours(entries)

  return (
    <HeroCard
      Icon={IconHelmet}
      label="Pilot"
      onOpen={() => onOpen('pilot')}
      ariaLabel="Open pilot"
      right={
        <span style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3,
          fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1,
        }}>
          <StatusLine label="Currency" status={currencyCards?.current.status} />
          <StatusLine label="Medical"  status={currencyCards?.valid.status} />
          <span style={{ textAlign: 'right', fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' }}>
            TT: {totalHours.toFixed(1)}
          </span>
        </span>
      }
    />
  )
}
