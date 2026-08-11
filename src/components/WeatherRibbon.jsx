// The base airport's conditions, on the map, at a glance.
//
// The menu-style home put a full weather card at the top of the screen, so
// conditions were the first thing a pilot saw. A map home that only links to
// weather buries the one number they open the app for, so it comes back here
// in the form a map can carry: a single strip, category first, tappable into
// the detail overlay that already exists.
//
// This deliberately reuses loadWeather and the same parsers the weather card
// uses. A second weather path would drift, and two answers to "is it VFR" is
// worse than none.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  loadWeather, parseFltCat, parseWind, parseVisib, parseCeiling, parseTemp, parseDewp,
  parseAirportName,
} from '../lib/weather'
import WeatherDetailOverlay from './WeatherDetailOverlay'
import { resolveRouteText, routeToText } from '../lib/routeText'
import RouteBoard from './RouteBoard'
import AirportPickerModal from './AirportPickerModal'
// The app's one saturated colour, shared so it changes in one place
// rather than four.

// Conditions age. A METAR is issued hourly and a pilot reading a two-hour-old
// observation as current is exactly the failure this app exists to prevent, so
// staleness is shown rather than hidden.
const STALE_MS = 75 * 60 * 1000

// The one card, and how wide it may get.
//
// Centred at the top of the map with the drawer's arrow to its left, so the
// cap is what keeps the two apart: 128 is that 46px button, its 14px margin,
// a 4px gap, and the same again on the right so the card stays centred rather
// than drifting off the middle of the screen. The wider cap applies only when
// the card is carrying a second section, which is the only content that needs
// the room.
const CARD_MAX = 'calc(100vw - 130px)'
const CARD_MAX_WIDE = 'calc(100vw - 128px)'

const CARD = {
  // The same floating-object treatment the round map controls use: it sits on
  // the chart rather than on the drawer, so it takes the stain's colour but not
  // the drawer's opacity.
  background: 'var(--map-ctrl-bg, var(--map-panel))', backdropFilter: 'blur(14px)',
  borderRadius: 14, boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
  // Clipped, and not a scroll container. The one row that is always visible,
  // the category and the code, is the reason the card is on the screen and
  // must not scroll away from under a finger; everything the tap reveals
  // scrolls inside the expansion instead, capped by the caller's bodyMaxH.
  overflow: 'hidden',
  // Sized by its contents, not stretched: at rest this is a state and a code,
  // and a pill with a stretch of empty space between them reads as something
  // that failed to load rather than something compact.
  width: 'fit-content',
}

// A hairline, not a gap. Conditions and the aerodrome are one readout with two
// halves, and any spacing between them would put the second pill back.
const SECTION = { borderTop: '1px solid var(--map-hairline)' }

export default function WeatherRibbon({
  icao, units = {}, style, onChangeAirport,
  // What the figures need that this strip has no business working out itself:
  // the aircraft's cruise numbers and the planned departure time.
  cruiseTas, burnGph, etd, onAltitude,
  // The route, and the way to set one. This strip started life as a weather
  // readout for the home field; a route bar is what a pilot actually reaches
  // for at the top of a moving map, and the conditions belong to whichever
  // field the route starts at rather than to a base they may be nowhere near.
  route = null, onRouteText,
  // Controlled from the parent so the weather button in the sheet opens the
  // same report this strip opens. There is one working weather screen and
  // both routes into it should land there.
  detailOpen = false, onDetailChange,
  // The aerodrome under the map, rendered inside this card's expansion under
  // a hairline: not a second pill, and not a second collapsed row either.
  //
  // It floated as its own pill once, four pixels below this one, and two
  // rounded panels stacked like that read as one thing that had come apart.
  // Folding it in as a second collapsed row fixed the floating but left the
  // resting state carrying two rows and two chevrons, which is furniture: at
  // rest a pilot wants the category and the code, and nothing else. So the
  // card shows that one row, and the tap opens everything at once, conditions
  // above and the field below. They are the same question asked twice.
  below = null,
  // Whether the card is open. Controlled from the parent on the map home,
  // which is the only place that knows what else is on the screen. Left
  // uncontrolled it keeps its own state.
  expanded, onExpandedChange,
  // The tallest the opened content may get before it scrolls inside itself.
  // Conditions and a large airport's full readout together are six hundred
  // pixels, which is most of a phone, so the caller hands down whatever room
  // is left above the drawer.
  bodyMaxH,
}) {
  const [wx, setWx] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selfOpen, setSelfOpen] = useState(false)   // the inline expansion
  const open = expanded ?? selfOpen
  const setOpen = onExpandedChange ?? setSelfOpen

  const [routeDraft, setRouteDraft] = useState('')
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeBad, setRouteBad] = useState([])
  // Seeded from the route each time the box is opened, rather than kept in
  // step with it: a pilot halfway through typing should not have their text
  // rewritten because the map finished resolving the previous version.
  //
  // Stamped with the opening rather than written by an effect, so there is no
  // synchronous setState during a render and no frame where the box shows the
  // last route while the new one is already on the map.
  const [draftFor, setDraftFor] = useState(null)
  const routeText = routeToText(route)
  const draft = draftFor === routeText ? routeDraft : routeText
  function openWith(next) {
    if (next) { setDraftFor(routeText); setRouteDraft(routeText) }
    setOpen(next)
  }

  async function submitRoute() {
    setRouteBusy(true)
    const { points, bad } = await resolveRouteText(draft)
    setRouteBusy(false)
    setRouteBad(bad)
    onRouteText?.(points.length >= 2 ? points : null)
  }

  const [picker, setPicker] = useState(false)  // choosing a different base
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async (id) => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      setWx(await loadWeather(id))
    } catch (e) {
      setError(e.message ?? 'Weather unavailable')
    } finally {
      setLoading(false)
    }
  }, [])

  // Deferred by a microtask rather than called straight from the effect body:
  // load() flips the loading flag immediately, and a setState synchronous with
  // the effect makes React render twice before paint for no benefit.
  useEffect(() => {
    if (!icao) return
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) load(icao) })
    return () => { cancelled = true }
  }, [icao, load])

  // Coming back to the app after a while is exactly when the observation on
  // screen is most likely to be out of date.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') load(icao)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [icao, load])

  // No base set yet. The strip becomes the invitation to set one rather than
  // disappearing: a pilot who has not chosen a home airport is exactly the one
  // who needs the control to be visible.
  if (!icao) {
    return (<>
      <div style={{ ...CARD, maxWidth: below ? CARD_MAX_WIDE : CARD_MAX, ...style }}>
        <button onClick={() => setPicker(true)} style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '9px 14px', border: 'none', background: 'none',
          cursor: 'pointer',
          fontSize: 12.5, fontWeight: 700, color: 'var(--map-ctrl-ink, var(--map-ink))',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Set home airport
        </button>
        {/* The field under the map still gets said, even by a pilot who has
            never set a home airport. That is the newest install there is, and
            the one most likely to be looking at somewhere it does not know.
            Open on sight here, because there is no conditions panel above it
            for a tap to reveal and nothing else in the card to compete with
            it. It still scrolls inside the room the caller gives it. */}
        {below && (
          <div style={{
            ...SECTION,
            maxHeight: bodyMaxH, overflowY: bodyMaxH ? 'auto' : undefined,
            overscrollBehavior: 'contain',
          }}>{below}</div>
        )}
      </div>
      {picker && createPortal(
        <AirportPickerModal
          onConfirm={(id) => { setPicker(false); onChangeAirport?.(id) }}
          onClose={() => setPicker(false)} />,
        document.body,
      )}
    </>)
  }

  const metar = wx?.metar
  const cat = parseFltCat(metar)
  // Ticked from state rather than read during render: a clock read while
  // rendering makes the same props produce different output. Ticking also
  // means the badge appears on its own as the observation ages, without
  // waiting for a refetch that may never come.
  const stale = wx?.fetchedAt != null && now - wx.fetchedAt > STALE_MS

  // The four the weather card shows, with the icons it uses, so the two are
  // recognisably the same readout rather than two dialects of it.
  const metrics = metar ? [
    { icon: '/wind.png',       value: parseWind(metar, units) },
    { icon: '/cloud.png',      value: parseCeiling(metar, units) },
    { icon: '/visibility.png', value: parseVisib(metar, units) },
    { icon: '/droplet.png',    value: parseDewp(metar, units) },
  ].filter(m => m.value) : []

  return (<>
    <div style={{ ...CARD, maxWidth: below ? CARD_MAX_WIDE : CARD_MAX, ...style }}>
      {/* Collapsed, this is the whole thing: what the field is doing, and
          which field. That is the glance a pilot takes, and a strip of
          numbers across the top of a chart is furniture the rest of the time.
          It is also the only row that survives the tap, so it never scrolls
          away from the finger that opened the card. */}
      {/* The whole strip expands. Changing the base used to live on the code
          itself, which turned out to be most of the pill: tapping what looks
          like a weather readout opened an airport picker, and the weather was
          almost unreachable. Reading conditions is the frequent act and moving
          base is the rare one, so the frequent one gets the whole target and
          the rare one gets a labelled control inside. */}
      <button onClick={() => openWith(!open)} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 7, width: '100%',
        padding: '6px 12px', border: 'none', background: 'none',
        cursor: 'pointer',
      }}>
        <span style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.3px',
          color: cat.color, background: cat.bg, padding: '4px 7px', borderRadius: 7,
          flexShrink: 0,
        }}>{metar ? cat.label : loading ? '···' : '--'}</span>

        {/* The route, when there is one, is what this bar is for. The single
            field is what it falls back to, because a bar that says nothing
            until a route exists is a bar a pilot has no reason to look at. */}
        <span style={{
          fontSize: 13.5, fontWeight: 700, color: 'var(--map-ctrl-ink, var(--map-ink))',
          letterSpacing: '0.4px', flexShrink: 0, maxWidth: '52vw',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {route?.length >= 2
            ? `${route[0].name} \u2192 ${route[route.length - 1].name}`
            : icao}
        </span>
        {route?.length > 2 && (
          <span style={{
            fontSize: 10.5, fontWeight: 700, flexShrink: 0,
            color: 'var(--map-ctrl-ink-faint, var(--map-ink-faint))',
          }}>{route.length} fixes</span>
        )}

        {stale && (
          <span title="Observation is over an hour old" style={{
            fontSize: 9.5, fontWeight: 800, color: '#FF9500',
            background: 'rgba(255,149,0,0.16)', padding: '3px 5px',
            borderRadius: 5, flexShrink: 0,
          }}>OLD</span>
        )}

        {!metar && !loading && (
          <span style={{ fontSize: 12, color: 'var(--map-ctrl-ink-faint, var(--map-ink-faint))' }}>
            {error ? 'No weather' : 'Tap for weather'}
          </span>
        )}

        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(60,60,67,0.45)"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 240ms cubic-bezier(0.4,0,0.2,1)',
          }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Expands downward. Grid rows rather than max-height so it animates to
          its real height: a guessed max-height either clips the content or
          leaves the easing running against empty space. */}
      <div style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        transition: 'grid-template-rows 260ms cubic-bezier(0.4,0,0.2,1)',
      }}>
        {/* Width zero while closed, not just height. A grid row collapsed to
            0fr still contributes its content's WIDTH, so the airport name and
            the metric grid were setting the width of a pill showing two short
            words: it measured 231px for something that needs about 120. */}
        <div style={{ overflow: 'hidden', minHeight: 0, width: open ? 'auto' : 0 }}>
          {/* The scroller, and the only one in the card. Everything the tap
              reveals lives in here, so a field with five runways and six
              frequencies under a full set of conditions runs off the bottom of
              this box rather than off the bottom of the map.
              The min width belongs to the open state only. Applied always, it
              set the width of the collapsed pill too, which is why a strip
              showing two short words still stretched halfway across the map. */}
          {/* Route entry, above the conditions, because entering a route is
              the frequent act here and reading the field it starts from is
              what follows from it. Airports, VORs, GPS fixes and the pilot's
              own saved waypoints, resolved by the same parser the planner
              uses so a route that works in one box works in the other. */}
          {open && (
            <div style={{ padding: '10px 12px 8px' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={draft}
                  onChange={e => { setDraftFor(routeText); setRouteDraft(e.target.value.toUpperCase()) }}
                  onKeyDown={e => { if (e.key === 'Enter') submitRoute() }}
                  onPointerDown={e => e.stopPropagation()}
                  placeholder="CYTZ CYYZ, or a VOR, fix or saved point"
                  spellCheck={false}
                  autoCapitalize="characters"
                  style={{
                    flex: 1, minWidth: 0, padding: '9px 11px', borderRadius: 10,
                    border: '1px solid var(--map-hairline)',
                    background: 'var(--map-fill-soft)',
                    color: 'var(--map-ctrl-ink, var(--map-ink))',
                    fontSize: 13, fontWeight: 700, fontFamily: 'monospace',
                    letterSpacing: '0.06em', outline: 'none',
                  }} />
                <button onClick={submitRoute} disabled={routeBusy} style={{
                  padding: '9px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'var(--accent)', color: 'var(--accent-fg)',
                  fontSize: 13, fontWeight: 800, flexShrink: 0,
                }}>{routeBusy ? '...' : 'Go'}</button>
              </div>
              {/* Named, not counted. "2 not found" sends a pilot back to read
                  their own route looking for which two. */}
              {routeBad.length > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)', marginTop: 6 }}>
                  Not found: {routeBad.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* The flight itself, once there is one: what it comes to on one
              page, what it looks like from the side on the next. Above the
              field's conditions because the route is what the bar is now for,
              and the conditions belong to one end of it. */}
          {open && route?.length >= 2 && (
            <RouteBoard
              route={{
                dep: route[0].name,
                depPos: [route[0].lat, route[0].lon],
                destPos: [route[route.length - 1].lat, route[route.length - 1].lon],
                wpts: route.slice(1, -1),
              }}
              etd={etd} cruiseTas={cruiseTas} burnGph={burnGph} onAltitude={onAltitude} />
          )}

          <div style={{
            minWidth: open ? 236 : 0,
            maxHeight: bodyMaxH, overflowY: bodyMaxH ? 'auto' : undefined,
            overscrollBehavior: 'contain',
          }}>
            <div style={{ padding: '2px 12px 11px' }}>
              {metar ? (<>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginBottom: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--map-ctrl-ink, var(--map-ink))', letterSpacing: '-0.8px' }}>
                    {parseTemp(metar, units) ?? '--'}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--map-ctrl-ink-dim, var(--map-ink-dim))', minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {parseAirportName(metar) || ''}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 14px' }}>
                  {metrics.map(m => (
                    <div key={m.icon} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <img src={m.icon} alt="" width={13} height={13}
                        style={{ filter: 'brightness(0)', opacity: 0.55, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--map-ctrl-ink, var(--map-ink))' }}>{m.value}</span>
                    </div>
                  ))}
                </div>

                <button onClick={() => onDetailChange?.(true)} style={{
                  marginTop: 10, width: '100%', border: 'none', cursor: 'pointer',
                  background: 'var(--map-fill)', borderRadius: 9, padding: '9px 0',
                  fontSize: 11.5, fontWeight: 700, color: 'var(--map-ctrl-ink, var(--map-ink))',
                }}>
                  Full report, METAR and TAF
                </button>
              </>) : (
                <div style={{ fontSize: 11.5, color: 'var(--map-ctrl-ink-dim, var(--map-ink-dim))', padding: '2px 0 4px' }}>
                  {loading ? 'Loading conditions…' : error ? 'Weather unavailable right now' : 'No observation'}
                </div>
              )}
            </div>

            {/* And under the hairline, the field the map is over. Same tap,
                same card, one scroll: conditions there, the aerodrome here. */}
            {below && <div style={SECTION}>{below}</div>}
          </div>
        </div>
      </div>
    </div>

    {/* The same overlay the weather card opens, portaled so the map's stacking
        context cannot trap it. */}
    {picker && createPortal(
      <AirportPickerModal
        current={icao}
        onConfirm={(id) => { setPicker(false); onChangeAirport?.(id) }}
        onClose={() => setPicker(false)} />,
      document.body,
    )}

    {detailOpen && createPortal(
      <WeatherDetailOverlay
        wx={wx} icao={icao} loading={loading} error={error} isStale={stale}
        onClose={() => onDetailChange?.(false)}
        onRefresh={() => load(icao)} />,
      document.body,
    )}
  </>)
}
