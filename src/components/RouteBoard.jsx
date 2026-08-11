/* ── The route, as figures and as a picture ─────────────────────────────
   Two pages under the nav bar, swiped between the way a phone's home screen
   is: what the flight comes to, and what it looks like from the side.

   Both are about the SAME altitude, which is why the selector sits above them
   rather than on one page. Changing it moves the wind, the ground speed, the
   time, the fuel and the terrain clearance together, because in the aircraft
   they are one decision. ── */

import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtEte, etaFrom } from '../lib/routeFigures'
import { fetchWindsAloft, windAt, WIND_LEVELS_FT } from '../lib/windsAloft'
import { analyzeTerrain } from '../lib/terrain'
import { haversineNm, bearingDeg } from '../lib/geo'
import { magneticVariation, toMagnetic } from '../lib/magvar'
import {
  cruisingAltitudes, suggestAltitude, formatAltitude, isEastbound,
} from '../lib/cruisingAltitudes'
import { SegControl } from './SegControl'

function Figure({ label, value, sub, wide = false }) {
  return (
    <div style={{ minWidth: 0, gridColumn: wide ? 'span 2' : undefined }}>
      <div style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'var(--map-ctrl-ink-faint, var(--map-ink-faint))', whiteSpace: 'nowrap',
      }}>{label}</div>
      <div style={{
        fontSize: 17, fontWeight: 800, lineHeight: 1.15, marginTop: 2,
        color: 'var(--map-ctrl-ink, var(--map-ink))',
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>{value ?? '—'}</div>
      {sub && (
        <div style={{
          fontSize: 10, fontWeight: 600, marginTop: 1,
          color: 'var(--map-ctrl-ink-faint, var(--map-ink-faint))', whiteSpace: 'nowrap',
        }}>{sub}</div>
      )}
    </div>
  )
}

/* ── The profile ────────────────────────────────────────────────────────
   Terrain in silhouette, the planned altitude as a line across it, the
   freezing level where it falls inside the climb, and the wind along the way.

   Drawn as an SVG rather than a canvas so it scales with the card and needs no
   redraw on resize. The vertical scale is shared by terrain and altitude, or
   the clearance a pilot reads off it would be a picture of nothing. ── */
function Profile({ terrain, cruiseAlt, freezingFt, winds, lengthNm }) {
  const W = 300
  const H = 132
  const PAD_B = 16

  if (!terrain || terrain.status !== 'ok' || !terrain.centerlineFt?.length) {
    return (
      <div style={{
        height: H, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, color: 'var(--map-ctrl-ink-faint, var(--map-ink-faint))', textAlign: 'center',
        padding: '0 16px',
      }}>
        {terrain?.status === 'unavailable'
          ? 'Terrain could not be measured. It is not being reported as clear.'
          : 'Enter a route to see its profile.'}
      </div>
    )
  }

  const ground = terrain.centerlineFt
  // Headroom above whichever is higher, so neither the ground nor the altitude
  // line is ever drawn off the top of its own picture.
  const top = Math.max(cruiseAlt ?? 0, terrain.maxFt) * 1.25 + 500
  const x = i => (i / Math.max(1, ground.length - 1)) * W
  const y = ft => (H - PAD_B) - (ft / top) * (H - PAD_B)

  const groundPath = `M0,${H - PAD_B} ` +
    ground.map((ft, i) => `L${x(i).toFixed(1)},${y(ft).toFixed(1)}`).join(' ') +
    ` L${W},${H - PAD_B} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      {/* Icing, where the freezing level is low enough to matter. Drawn under
          the terrain so a band crossing a mountain does not appear to be
          inside it. */}
      {freezingFt != null && freezingFt < top && (
        <>
          <rect x="0" y="0" width={W} height={Math.max(0, y(freezingFt))}
            fill="rgba(90,160,255,0.16)" />
          <line x1="0" y1={y(freezingFt)} x2={W} y2={y(freezingFt)}
            stroke="rgba(90,160,255,0.85)" strokeWidth="1" strokeDasharray="4 3" />
          <text x="4" y={Math.max(9, y(freezingFt) - 3)} fontSize="8" fontWeight="700"
            fill="rgba(90,160,255,0.95)">0 {'°'}C {Math.round(freezingFt / 100) * 100} ft</text>
        </>
      )}

      <path d={groundPath} fill="var(--map-ctrl-ink-faint, rgba(60,60,67,0.45))" opacity="0.55" />

      {/* The planned altitude. Solid where it clears the ground by the
          thousand feet the mountain rule asks for, and red where it does not,
          because a line that looks the same either way is a line that has not
          said anything. */}
      {cruiseAlt != null && (
        <>
          {ground.map((ft, i) => {
            if (i === 0) return null
            const safe = cruiseAlt - Math.max(ft, ground[i - 1]) >= 1000
            return (
              <line key={i} x1={x(i - 1)} y1={y(cruiseAlt)} x2={x(i)} y2={y(cruiseAlt)}
                stroke={safe ? 'var(--ok)' : 'var(--danger)'} strokeWidth="2.5" strokeLinecap="round" />
            )
          })}
          <text x={W - 3} y={Math.max(9, y(cruiseAlt) - 4)} fontSize="8.5" fontWeight="800"
            textAnchor="end" fill="var(--map-ctrl-ink, var(--map-ink))">
            {cruiseAlt.toLocaleString()} ft
          </text>
        </>
      )}

      {/* Wind along the route, as an arrow every fifth of the way. One value
          for the whole leg, because that is the resolution the forecast has:
          drawing it per mile would be inventing detail. */}
      {winds && [0.1, 0.3, 0.5, 0.7, 0.9].map(f => (
        <g key={f} transform={`translate(${W * f}, 14) rotate(${winds.dir + 180})`}>
          <line x1="0" y1="-6" x2="0" y2="6" stroke="var(--map-ctrl-ink-faint, rgba(60,60,67,0.45))" strokeWidth="1.4" />
          <path d="M0,6 L-3,1 M0,6 L3,1" fill="none"
            stroke="var(--map-ctrl-ink-faint, rgba(60,60,67,0.45))" strokeWidth="1.4" />
        </g>
      ))}

      <text x="2" y={H - 4} fontSize="8" fontWeight="700"
        fill="var(--map-ctrl-ink-faint, var(--map-ink-faint))">0</text>
      <text x={W - 2} y={H - 4} fontSize="8" fontWeight="700" textAnchor="end"
        fill="var(--map-ctrl-ink-faint, var(--map-ink-faint))">
        {lengthNm ? `${Math.round(lengthNm)} NM` : ''}
      </text>
    </svg>
  )
}

export default function RouteBoard({ route, etd, cruiseTas, burnGph, onAltitude }) {
  const [page, setPage] = useState(0)
  const [rules, setRules] = useState('VFR')
  // Null until the pilot says otherwise, so the direction follows the course
  // as the route is edited. Set once, it stops following: a pilot who chose
  // westbound on a route that wanders back east meant it.
  const [dirChoice, setDirChoice] = useState(null)
  const [alt, setAlt] = useState(null)
  const [magVar, setMagVar] = useState(null)
  const [winds, setWinds] = useState(null)
  const [terrain, setTerrain] = useState(null)
  const pagerRef = useRef(null)

  const points = useMemo(() => {
    if (!route?.depPos || !route?.destPos) return []
    const mid = (route.wpts ?? []).filter(w => w?.lat != null).map(w => ({ lat: w.lat, lon: w.lon }))
    return [{ lat: route.depPos[0], lon: route.depPos[1] }, ...mid,
      { lat: route.destPos[0], lon: route.destPos[1] }]
  }, [route])

  // Summed across the legs rather than measured end to end, so a route that
  // doglegs reads as long as it is to fly.
  const distNm = useMemo(() => points.length < 2 ? null
    : points.slice(1).reduce((sum, p, i) => sum + haversineNm(points[i].lat, points[i].lon, p.lat, p.lon), 0),
  [points])

  const courseDeg = points.length >= 2
    ? bearingDeg(points[0].lat, points[0].lon, points[points.length - 1].lat, points[points.length - 1].lon)
    : null

  // Magnetic, not true. The hemispheric rule is written in magnetic, and a
  // route flown where the variation is large would be handed the wrong side of
  // it otherwise: 15 degrees is the difference between odd and even over much
  // of Canada.
  useEffect(() => {
    if (points.length < 2) return
    let cancelled = false
    const mid = points[Math.floor(points.length / 2)]
    magneticVariation(mid.lat, mid.lon).then(v => { if (!cancelled) setMagVar(v) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points)])

  const magCourse = courseDeg != null ? toMagnetic(courseDeg, magVar ?? 0) : null
  const eastbound = dirChoice ?? isEastbound(magCourse)
  const altitudes = useMemo(
    () => cruisingAltitudes({ rules, eastbound }), [rules, eastbound])

  // The suggestion stands until the pilot picks one, and is recomputed as the
  // terrain arrives or the rules change. A chosen altitude that is no longer
  // legal for the direction is dropped rather than kept: an even level on an
  // eastbound VFR leg is not a preference, it is a mistake waiting at the top
  // of the climb.
  const suggested = useMemo(
    () => suggestAltitude({ rules, magCourseDeg: magCourse, terrainMaxFt: terrain?.maxFt ?? null }),
    [rules, magCourse, terrain?.maxFt])
  const effAlt = alt != null && altitudes.includes(alt) ? alt : suggested
  useEffect(() => { onAltitude?.(effAlt) }, [effAlt, onAltitude])

  useEffect(() => {
    if (!route?.dep) return
    let cancelled = false
    fetchWindsAloft(route.dep).then(levels => { if (!cancelled) setWinds(levels) }).catch(() => {})
    return () => { cancelled = true }
  }, [route?.dep])

  // Measured once per route, not per altitude: the corridor does not change
  // when the pilot tries a different level, and each measurement is hundreds
  // of elevation lookups.
  useEffect(() => {
    if (points.length < 2) { return }
    let cancelled = false
    analyzeTerrain(points, { altFt: null })
      .then(r => { if (!cancelled) setTerrain(r) })
      .catch(() => { if (!cancelled) setTerrain({ status: 'unavailable' }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points)])

  const windHere = winds ? windAt(winds, effAlt) : null
  // Along-track component: positive is a headwind, which is the sign a pilot
  // reads it with.
  const headKt = windHere && courseDeg != null
    ? Math.round(windHere.spd * Math.cos((windHere.dir - courseDeg) * Math.PI / 180))
    : null
  const gs = cruiseTas != null && headKt != null ? Math.max(1, cruiseTas - headKt) : cruiseTas
  const hours = distNm != null && gs ? distNm / gs : null
  const fuel = hours != null && burnGph ? hours * burnGph : null
  // The forecast carries a temperature per level, so the freezing level is
  // interpolated from the levels either side rather than assumed.
  const freezingFt = useMemo(() => {
    if (!winds) return null
    let below = null, above = null
    for (const lv of WIND_LEVELS_FT) {
      const w = windAt(winds, lv)
      if (w?.temp == null) continue
      if (w.temp > 0) below = { ft: lv, t: w.temp }
      if (w.temp <= 0 && !above) above = { ft: lv, t: w.temp }
    }
    if (!below || !above || above.t === below.t) return above?.ft ?? null
    const f = below.t / (below.t - above.t)
    return Math.round(below.ft + f * (above.ft - below.ft))
  }, [winds])

  function goTo(i) {
    setPage(i)
    pagerRef.current?.scrollTo({ left: i * pagerRef.current.clientWidth, behavior: 'smooth' })
  }

  return (
    <div style={{ padding: '10px 12px 4px' }}>
      {/* The altitude, above both pages because both are about it.

          Three controls in one row: the ruleset, the direction, and the level.
          The first two decide which levels are legal and the third picks one
          from what is left, which is the order the rule itself is applied in.

          Direction is preselected from the magnetic course and stays with it
          until the pilot touches it. A route that wanders back east after they
          chose westbound should not overrule them. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SegControl
            options={['VFR', 'IFR']}
            value={rules}
            onChange={setRules} />
        </div>
        <div style={{ flex: 1.3, minWidth: 0 }}>
          <SegControl
            options={['East', 'West']}
            value={eastbound ? 'East' : 'West'}
            onChange={v => setDirChoice(v === 'East')} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <select
          value={effAlt ?? ''}
          onChange={e => setAlt(Number(e.target.value))}
          onPointerDown={e => e.stopPropagation()}
          style={{
            flex: 1, minWidth: 0, padding: '8px 9px', borderRadius: 9,
            border: '1px solid var(--map-hairline)', background: 'var(--map-fill-soft)',
            color: 'var(--map-ctrl-ink, var(--map-ink))',
            fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', outline: 'none',
          }}>
          {altitudes.map(a => (
            <option key={a} value={a}>{formatAltitude(a)}</option>
          ))}
        </select>
        {/* What the app chose and why, so a preselected level is a suggestion
            with a reason rather than a number that appeared. */}
        <span style={{
          fontSize: 10, fontWeight: 700, lineHeight: 1.25, flexShrink: 0, maxWidth: 118,
          color: 'var(--map-ctrl-ink-faint, var(--map-ink-faint))',
        }}>
          {magCourse != null
            ? `${String(Math.round(magCourse)).padStart(3, '0')}° M · ${eastbound ? 'odd' : 'even'}`
            : 'course unknown'}
          {alt == null && suggested != null ? ' · suggested' : ''}
        </span>
      </div>

      <div
        ref={pagerRef}
        onScroll={e => {
          const w = e.currentTarget.clientWidth || 1
          const i = Math.round(e.currentTarget.scrollLeft / w)
          if (i !== page) setPage(i)
        }}
        style={{
          display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory',
          gap: 0, scrollbarWidth: 'none',
        }}>
        <div style={{ flex: '0 0 100%', scrollSnapAlign: 'start', minWidth: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 12px' }}>
            <Figure label="Distance" value={distNm != null ? `${distNm.toFixed(0)} NM` : null} />
            <Figure label="ETE" value={hours != null ? fmtEte(hours) : null}
              sub={gs != null ? `${Math.round(gs)} kt GS` : null} />
            <Figure label="ETA" value={hours != null ? etaFrom(etd ?? null, hours) : null} />
            <Figure label="Wind"
              value={windHere ? `${String(windHere.dir).padStart(3, '0')}° ${windHere.spd}` : null}
              sub={headKt != null ? (headKt >= 0 ? `${headKt} kt head` : `${-headKt} kt tail`) : null} />
            <Figure label="Fuel" value={fuel != null ? `${fuel.toFixed(1)} gal` : null}
              sub={burnGph ? `${burnGph} gph` : 'set burn in Hangar'} />
            <Figure label="Terrain"
              value={terrain?.status === 'ok' ? `${terrain.maxFt.toLocaleString()} ft` : null}
              sub={terrain?.status === 'ok' && terrain.clearanceFt != null
                ? `${terrain.clearanceFt.toLocaleString()} ft below` : 'highest on track'} />
          </div>
        </div>

        <div style={{ flex: '0 0 100%', scrollSnapAlign: 'start', minWidth: 0 }}>
          <Profile terrain={terrain} cruiseAlt={effAlt} freezingFt={freezingFt}
            winds={windHere} lengthNm={terrain?.lengthNm ?? distNm} />
        </div>
      </div>

      {/* The dots, tappable as well as swipeable: a pager with no visible
          second page is a page nobody finds. */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 8 }}>
        {[0, 1].map(i => (
          <button key={i} onClick={() => goTo(i)} aria-label={i === 0 ? 'Figures' : 'Profile'}
            style={{
              width: page === i ? 16 : 6, height: 6, borderRadius: 3, padding: 0, border: 'none',
              cursor: 'pointer', transition: 'width 200ms ease',
              background: page === i
                ? 'var(--map-ctrl-ink, var(--map-ink))'
                : 'var(--map-ctrl-ink-faint, var(--map-ink-faint))',
            }} />
        ))}
      </div>
    </div>
  )
}
