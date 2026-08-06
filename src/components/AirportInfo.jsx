import { useState, useEffect } from 'react'
import { HomeButton } from './Shell'
import { SegControl } from './SegControl'
import AirportPickerModal from './AirportPickerModal'
import AirportDiagram from './AirportDiagram'
import ProcedureChartViewer from './ProcedureChartViewer'
import { get, put } from '../lib/db'
import { usePilotProfile } from '../context/PilotProfile'
import { getAirports } from '../lib/aerodromes'
import { classAtPoint } from '../lib/airspace'
import { isUSIdent } from '../lib/faaAirportGeometry'
import { getProcedures, getProceduresCycle } from '../lib/procedureCharts'
import { useBackOverride } from '../context/BackOverride'
import airportDetails from '../data/geo/airport_details.json'
import {
  loadWeather, substituteWeather, parseFltCat, parseWindParts, parseWind, parseVisib, parseCeiling,
  parseTemp, parseDewp, parseAltim, parseAirportName, colorizeTaf,
  parseObsAge, parseTafAge, parseFetchAge,
} from '../lib/weather'
import {
  loadAreaWeather, areaTemp, areaDewp, areaWind, areaVis,
  areaCloud, areaPressure, areaCondition,
} from '../lib/areaWeather'
import { loadNotams, validity, isActive, SOURCE_NAMES } from '../lib/notams'

const TABS = ['Weather', 'Frequencies', 'Runways', 'Procedures', 'NOTAMs']

const SEVERITY = {
  closed:         { label: 'Closed',        color: '#FF3B30', bg: 'rgba(255,59,48,0.12)' },
  unserviceable:  { label: 'Unserviceable', color: '#FF9F0A', bg: 'rgba(255,159,10,0.14)' },
  info:           { label: null,            color: 'var(--text-secondary)', bg: 'rgba(120,120,128,0.12)' },
}

// 'airport' (the official FAA airport diagram) is listed first and hidden
// when empty, unlike the others: only 886 of 2,976 charted fields publish
// one, and a "No airport procedures published" row at the other 2,090 would
// be noise. It's also reachable in one tap from the diagram card itself,
// which is where a pilot actually wants it while taxiing.
const PROCEDURE_SECTIONS = [
  { key: 'airport', label: 'Airport Diagram', hideWhenEmpty: true },
  { key: 'approach', label: 'Approach' },
  { key: 'departure', label: 'Departure' },
  { key: 'visual', label: 'Visual' },
]

function ProcedureRow({ chartName, first, onOpen }) {
  return (
    <div
      onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 16px', borderTop: first ? 'none' : '0.5px solid var(--border)',
        cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
      }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{chartName}</span>
    </div>
  )
}

function ListRow({ left, right, first }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '11px 16px', borderTop: first ? 'none' : '0.5px solid var(--border)',
    }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{left}</span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{right}</span>
    </div>
  )
}

function EmptyRow({ children }) {
  return (
    <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-tertiary)' }}>{children}</div>
  )
}

// Raw METAR/TAF text, light-card version of WeatherDetailOverlay's own
// (dark-glass) raw text display — same colorized-by-flight-category TAF
// grading, adapted to sit on this page's white cards instead of a photo.
function RawTextRow({ title, text, first, colorize, color, age }) {
  if (!text) return null
  const lines = colorize ? colorizeTaf(text) : null
  return (
    <div style={{ padding: '14px 16px', borderTop: first ? 'none' : '0.5px solid var(--border)' }}>
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
        {age && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{age}</span>}
      </div>
      {lines ? (
        <div style={{ fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6 }}>
          {lines.map((l, i) => <div key={i} style={{ color: l.color }}>{l.text}</div>)}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: color || 'var(--text-secondary)', fontFamily: 'monospace', lineHeight: 1.5 }}>
          {text}
        </p>
      )}
    </div>
  )
}


const CARD = { background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }

// The banner that has to be impossible to miss.
//
// Everything below it came from somewhere other than the airport the pilot
// typed, and a weather card that doesn't say so is worse than no card at all
// — it reads as the field's own report. Hence a tinted strip rather than a
// footnote, and hence the airport's own ident in the sentence.
function NotFromHere({ children }) {
  return (
    <div style={{
      padding: '10px 14px', background: 'rgba(255,159,10,0.12)',
      borderBottom: '0.5px solid var(--border)',
      fontSize: 12, fontWeight: 600, color: '#B26B00', lineHeight: 1.45,
    }}>
      {children}
    </div>
  )
}

// Label above value rather than beside it. Side-by-side in a half-width
// column, a gusting wind ("310° 10G15 kt") wraps back underneath its own
// label and the two collide; stacking is immune to however long the value
// turns out to be, which on a phone is the only safe assumption.
function AreaRow({ label, value, first }) {
  return (
    <div style={{
      padding: '8px 16px 9px', borderTop: first ? 'none' : '0.5px solid var(--border)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>{value}</div>
    </div>
  )
}

// Shown only for a field that publishes no observation of its own — the
// noReport gate in loadWeather, never a failed fetch. Three independent
// stand-ins, each labelled with where it actually came from:
//
//   * the nearest station that does report, of any kind. Within ON_FIELD_NM
//     this is the field's own automated station under a different identifier
//     (CYLS's is CXBI), so it is introduced as this airport's weather;
//     further out it is introduced as somewhere else's, with distance and
//     bearing
//   * the nearest actual aerodrome publishing a METAR. A different question
//     with a genuinely different answer: CXBI sits on the field but gives no
//     visibility, no altimeter and no forecast, while CYQA 31 NM away gives
//     a complete observation and a TAF. Closest is not the same as most
//     complete, so both are offered rather than one being chosen for the
//     pilot
//   * a model estimate for the airport's own coordinates, filling whatever
//     the stations leave out
//
// No flight category is derived from any of them. See areaWeather.js.
function SubstituteWeather({ icao, sub, loading, units, RawRow }) {
  if (!sub && loading) {
    return <div style={CARD}><EmptyRow>Looking for nearby weather…</EmptyRow></div>
  }
  const station = sub?.station
  const airport = sub?.airport
  const area = sub?.area
  if (!station && !airport && !area) {
    return (
      <div style={CARD}>
        <EmptyRow>{icao} publishes no weather report, and no station or forecast could be reached nearby.</EmptyRow>
      </div>
    )
  }

  return (
    <>
      {station && (
        <div style={{ ...CARD, marginBottom: 12 }}>
          <NotFromHere>
            {station.onField
              ? <>{icao} files no METAR under its own identifier. This is its on-field automated station, <b>{station.ident}</b>, {station.distNm < 1 ? 'on the airport' : `${station.distNm.toFixed(1)} nm away`}.</>
              : <>{icao} publishes no weather. This is <b>{station.ident}</b> — the nearest reporting station, {Math.round(station.distNm)} nm {station.point}. It is not {icao} weather.</>}
          </NotFromHere>
          <div style={{ padding: '12px 16px 4px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{station.name || station.ident}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 0' }}>
            <AreaRow first label="Wind" value={parseWind(station.metar, units)} />
            <AreaRow first label="Temp" value={parseTemp(station.metar, units)} />
            <AreaRow label="Visibility" value={parseVisib(station.metar, units)} />
            <AreaRow label="Dewpoint" value={parseDewp(station.metar, units)} />
          </div>
          <RawRow title={`Raw METAR · ${station.ident}`} text={station.metar?.rawOb} age={parseObsAge(station.metar)} />
          <RawRow title={`Raw TAF · ${station.ident}`} text={station.taf?.rawTAF} colorize age={parseTafAge(station.taf)} />
        </div>
      )}

      {airport && (
        <div style={{ ...CARD, marginBottom: 12 }}>
          <NotFromHere>
            Nearest airport publishing a full report: <b>{airport.ident}</b>, {Math.round(airport.distNm)} nm {airport.point}. This is {airport.ident} weather, not {icao}'s.
          </NotFromHere>
          <div style={{ padding: '12px 16px 4px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{airport.name || airport.ident}</div>
          </div>
          {/* An airport METAR carries what a bare station does not — the
              ceiling and the altimeter setting are the whole reason this
              card is worth a second lookup. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 0' }}>
            <AreaRow first label="Wind" value={parseWind(airport.metar, units)} />
            <AreaRow first label="Temp" value={parseTemp(airport.metar, units)} />
            <AreaRow label="Visibility" value={parseVisib(airport.metar, units)} />
            <AreaRow label="Dewpoint" value={parseDewp(airport.metar, units)} />
            <AreaRow label="Ceiling" value={parseCeiling(airport.metar, units)} />
            <AreaRow label="Altimeter" value={parseAltim(airport.metar, units)} />
          </div>
          <RawRow title={`Raw METAR · ${airport.ident}`} text={airport.metar?.rawOb} age={parseObsAge(airport.metar)} />
          <RawRow title={`Raw TAF · ${airport.ident}`} text={airport.taf?.rawTAF} colorize age={parseTafAge(airport.taf)} />
        </div>
      )}

      {area && (
        <div style={CARD}>
          <NotFromHere>
            Area conditions computed for {icao}'s coordinates by a weather model — not observed at the airport, and not a substitute for a briefing. No flight category.
          </NotFromHere>
          {areaCondition(area) && (
            <div style={{ padding: '12px 16px 4px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{areaCondition(area)}</div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 0' }}>
            <AreaRow first label="Wind" value={areaWind(area, units)} />
            <AreaRow first label="Temp" value={areaTemp(area, units)} />
            <AreaRow label="Visibility" value={areaVis(area, units)} />
            <AreaRow label="Dewpoint" value={areaDewp(area, units)} />
            <AreaRow label="Cloud cover" value={areaCloud(area)} />
            <AreaRow label="Pressure" value={areaPressure(area, units)} />
          </div>
          {parseFetchAge(area.observedAt) && (
            <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--border)', fontSize: 12, color: 'var(--text-tertiary)' }}>
              Model valid {parseFetchAge(area.observedAt)}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function NotamRow({ n, first }) {
  const sev = SEVERITY[n.severity] ?? SEVERITY.info
  const pending = !isActive(n)
  const when = validity(n)
  return (
    <div style={{ padding: '12px 16px', borderTop: first ? 'none' : '0.5px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: sev.color, background: sev.bg, padding: '2px 6px', borderRadius: 5,
        }}>{n.category}{sev.label ? ` · ${sev.label}` : ''}</span>
        {/* A NOTAM that starts on Tuesday is worth reading and worth not
            mistaking for one in force now. */}
        {pending && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            color: 'var(--text-tertiary)', background: 'rgba(120,120,128,0.12)',
            padding: '2px 6px', borderRadius: 5,
          }}>Not yet in effect</span>
        )}
        {n.id && (
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
            {n.id}
          </span>
        )}
      </div>
      {when && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>{when}</div>
      )}
      <p style={{
        margin: 0, fontSize: 12, fontFamily: 'monospace', lineHeight: 1.5,
        color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>{n.body}</p>
    </div>
  )
}

function GroupHeading({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--text-tertiary)', margin: '16px 2px 6px',
    }}>{children}</div>
  )
}

// The NOTAMs tab.
//
// Split into what affects this aerodrome and what is merely in force over
// the region, because the two get returned together and are worth very
// different amounts of a pilot's attention: every one of CYLS's five is a
// FIR-wide notice about space weather and sanctions, and listed flat they
// make an untroubled field look like it has five problems.
function Notams({ icao, result }) {
  if (result === undefined) {
    return <div style={CARD}><EmptyRow>Loading NOTAMs…</EmptyRow></div>
  }
  // Never say "no NOTAMs" when the truth is "nowhere to ask" — they look
  // identical on screen and mean opposite things.
  if (result.unsupported) {
    return (
      <div style={CARD}>
        <EmptyRow>
          NOTAMs aren't available for this region yet. AVIARA covers Canadian aerodromes
          through NAV CANADA and US fields through the FAA.
        </EmptyRow>
      </div>
    )
  }
  if (result.error && !result.notams.length) {
    return (
      <div style={CARD}>
        <EmptyRow>{result.error}</EmptyRow>
      </div>
    )
  }
  if (!result.notams.length) {
    return <div style={CARD}><EmptyRow>No NOTAMs in effect for {icao}</EmptyRow></div>
  }

  const local = result.notams.filter(n => n.isLocal)
  const area = result.notams.filter(n => !n.isLocal)
  const src = SOURCE_NAMES[result.source] ?? result.source

  return (
    <>
      {result.stale && (
        <div style={{ ...CARD, marginBottom: 12 }}>
          <EmptyRow>Showing a saved copy — couldn't refresh ({result.error}).</EmptyRow>
        </div>
      )}
      {local.length > 0 && (
        <>
          <GroupHeading>{icao} · {local.length} NOTAM{local.length === 1 ? '' : 's'}</GroupHeading>
          <div style={CARD}>
            {local.map((n, i) => <NotamRow key={(n.id ?? '') + i} n={n} first={i === 0} />)}
          </div>
        </>
      )}
      {area.length > 0 && (
        <>
          <GroupHeading>Area &amp; FIR-wide · {area.length}</GroupHeading>
          <div style={CARD}>
            {area.map((n, i) => <NotamRow key={(n.id ?? '') + i} n={n} first={i === 0} />)}
          </div>
        </>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '12px 2px 0', lineHeight: 1.5 }}>
        Source: {src}, {parseFetchAge(result.fetchedAt) ?? 'just now'}. Not a substitute for an official briefing.
      </div>
    </>
  )
}

// Saved airports and the home-base change event. Both keys live in the
// settings store, which is already covered by the cloud backup, so
// favourites follow the pilot to a new device for free.
export const FAVOURITES_KEY = 'favouriteAirports'
export const HOME_AIRPORT_EVENT = 'aviara-home-airport'

export default function AirportInfo() {
  const { profile } = usePilotProfile()
  const units = profile ?? {}
  const [icao, setIcao] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [info, setInfo] = useState(null)
  const [wx, setWx] = useState(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('Weather')
  const [airspaceClass, setAirspaceClass] = useState(null)
  const [procedures, setProcedures] = useState(undefined) // undefined=loading, object=data, null=none published
  const [proceduresCycle, setProceduresCycle] = useState(null)
  const [openChart, setOpenChart] = useState(null) // null | { chartName, pdfName }
  // Stand-in weather, for fields that publish none of their own only.
  const [sub, setSub] = useState(null)             // null | { station, airport, area }
  const [subLoading, setSubLoading] = useState(false)
  const [notams, setNotams] = useState(undefined)  // undefined = loading

  // Claims the swipe-back gesture while a chart is open, so it returns to
  // the Procedures list instead of falling through to CardOverlay's own
  // close — same pattern ToolsMenu/Hangar already use for their own nested
  // sub-views.
  useBackOverride(openChart ? () => setOpenChart(null) : null)

  const [favourites, setFavourites] = useState([])
  const [homeIcao, setHomeIcao] = useState(null)

  useEffect(() => {
    get('settings', 'lastAirportLookup').then(row => {
      if (row?.value) setIcao(row.value)
      else setPickerOpen(true)
    })
    get('settings', FAVOURITES_KEY).then(row => setFavourites(row?.list ?? []))
    get('settings', 'homeAirport').then(row => setHomeIcao(row?.value ?? null))
  }, [])

  useEffect(() => {
    if (!icao) return
    let cancelled = false
    setOpenChart(null)
    if (!isUSIdent(icao)) { setProcedures(null); return }
    setProcedures(undefined)
    Promise.all([getProcedures(icao), getProceduresCycle()]).then(([data, cycle]) => {
      if (cancelled) return
      setProcedures(data)
      setProceduresCycle(cycle)
    })
    return () => { cancelled = true }
  }, [icao])

  // Guarded, because switching fields fast enough makes the responses race:
  // the previous airport's lookup can land after the new one's and overwrite
  // it, leaving the new ident in the header above the old field's name and
  // weather. Seen while testing favourites — CYYZ in the header, Muskoka's
  // name underneath. Every other async effect in this file already carries
  // this guard; this one did not.
  useEffect(() => {
    if (!icao) return
    let cancelled = false
    setLoading(true)
    setInfo(null)
    setWx(null)
    setAirspaceClass(null)
    Promise.all([
      getAirports().then(list => list.find(a => a[0] === icao) ?? null),
      loadWeather(icao).catch(() => null),
    ]).then(([hit, wxResult]) => {
      if (cancelled) return
      if (hit) {
        const [ident, lat, lon, cls, name] = hit
        setInfo({ ident, lat, lon, cls, name })
      } else {
        setInfo({ ident: icao, name: null, cls: null })
      }
      setWx(wxResult)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [icao])

  // Airspace class the field itself sits in — live B/C/D lookup (same FAA
  // service the Route & Altitude checklist uses, gated to FAA-administered
  // idents only — see classAtPoint's comment on why a lat/lon box isn't
  // trustworthy here). For US fields where that service has nothing to say,
  // fall back to a simple, near-always-correct heuristic: a field with a
  // Tower frequency and no B/C hit is Class D by definition (that's what
  // distinguishes D from an uncontrolled field); no tower defaults to Class
  // G, the common case for those fields. Outside FAA/CENAMER coverage this
  // app has no real class data, so it says nothing rather than guess —
  // guessing is exactly what put "Class B" on a Canadian Class E field.
  useEffect(() => {
    if (!info || info.lat == null || info.lon == null) { setAirspaceClass(null); return }
    let cancelled = false
    const isFAA = /^(K|PA|PH)/i.test(icao)
    const hasTower = (airportDetails[icao]?.f ?? []).some(([name]) => /tower|twr/i.test(name))
    classAtPoint(info.lat, info.lon, icao).then(hit => {
      if (cancelled) return
      setAirspaceClass(hit?.cls ?? (isFAA ? (hasTower ? 'D' : 'G') : null))
    }).catch(() => {
      if (!cancelled) setAirspaceClass(isFAA ? (hasTower ? 'D' : 'G') : null)
    })
    return () => { cancelled = true }
  }, [info, icao])

  // Stand-in weather, and only for a field that publishes none of its own.
  //
  // The gate is wx.noReport — AWC answered and had nothing — rather than a
  // simple "no metar object". A failed fetch also leaves wx.metar empty, and
  // covering that case with a model estimate would quietly replace a real
  // observation with a computed one every time the network hiccuped.
  useEffect(() => {
    setSub(null)
    if (!wx?.noReport || !info || info.lat == null || info.lon == null) return
    let cancelled = false
    setSubLoading(true)
    Promise.all([
      substituteWeather(info.lat, info.lon).catch(() => ({ station: null, airport: null })),
      loadAreaWeather(icao, info.lat, info.lon).catch(() => null),
    ]).then(([stations, area]) => {
      if (cancelled) return
      setSub({ station: stations.station, airport: stations.airport, area })
      setSubLoading(false)
    })
    return () => { cancelled = true }
  }, [wx, info, icao])

  // NOTAMs are independent of the weather path — a field with a perfectly
  // good METAR can still have its only runway shut — so this loads on its
  // own rather than hanging off the substitute-weather gate.
  useEffect(() => {
    if (!icao) return
    let cancelled = false
    setNotams(undefined)
    loadNotams(icao).then(r => { if (!cancelled) setNotams(r) })
    return () => { cancelled = true }
  }, [icao])

  function selectAirport(id) {
    setIcao(id)
    setPickerOpen(false)
    setTab('Weather')
    put('settings', { key: 'lastAirportLookup', value: id })
  }

  // Favourites and home base both live in the settings store, so they ride
  // the existing cloud backup and follow the pilot to a new device without
  // any new plumbing.
  function toggleFavourite() {
    if (!icao) return
    setFavourites(prev => {
      const next = prev.includes(icao) ? prev.filter(x => x !== icao) : [...prev, icao]
      put('settings', { key: FAVOURITES_KEY, list: next }).catch(() => {})
      return next
    })
  }

  function setAsHomeAirport() {
    if (!icao) return
    setHomeIcao(icao)
    put('settings', { key: 'homeAirport', value: icao })
      // Home's airport card and the flight plan's departure default both
      // read this key once on mount. Without a nudge they would keep
      // showing the old field until something else remounted them.
      .then(() => window.dispatchEvent(new Event(HOME_AIRPORT_EVENT)))
      .catch(() => {})
  }

  const details = icao ? airportDetails[icao] : null

  // A station on the field under a different identifier is this airport's
  // weather, so it feeds the header exactly as the field's own report would
  // — CYLS's automated station files as CXBI, 0.4 nm away. A station further
  // out is somewhere else's weather and must never reach the header, where
  // nothing marks it as borrowed; it stays confined to the labelled cards in
  // the Weather tab.
  const ownMetar = wx?.metar ?? (sub?.station?.onField ? sub.station.metar : null)

  // Only ever show a flight category that was actually published. parseFltCat
  // falls back to VFR when the field is absent, and asserting VFR on the
  // strength of a station reporting neither visibility nor ceiling — which is
  // precisely what a partial AUTO station like CXBI does — would be a green
  // light with no evidence behind it.
  const cat = ownMetar?.fltCat ? parseFltCat(ownMetar) : null
  const displayName = info?.name?.trim() || (wx?.metar ? parseAirportName(wx.metar) : null)

  if (openChart) {
    return (
      <ProcedureChartViewer
        icao={icao}
        cycle={proceduresCycle}
        chartName={openChart.chartName}
        pdfName={openChart.pdfName}
        onBack={() => setOpenChart(null)}
      />
    )
  }

  return (
    <div>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <HomeButton />
        <div
          onClick={() => setPickerOpen(true)}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>
          <h2 style={{
            fontSize: 28, fontWeight: 700, letterSpacing: icao ? '0.02em' : '-0.4px', color: 'var(--text)',
            fontFamily: icao ? 'monospace' : '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
          }}>{icao || 'Search airport'}</h2>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', flexShrink: 0 }}>Change</span>
        </div>
      </div>

      {/* What can be done with the field currently on screen. Both actions
          are about THIS airport, so they sit directly under its name rather
          than in a settings screen somewhere else. */}
      {icao && (
        <div style={{ padding: '12px 20px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={toggleFavourite}
            aria-label={favourites.includes(icao) ? 'Remove from favourites' : 'Add to favourites'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', borderRadius: 20, cursor: 'pointer',
              border: favourites.includes(icao) ? 'none' : '1px solid var(--border)',
              background: favourites.includes(icao) ? 'var(--accent)' : 'var(--bg-card)',
              color: favourites.includes(icao) ? 'var(--accent-fg)' : 'var(--text)',
              fontSize: 12, fontWeight: 700, WebkitTapHighlightColor: 'transparent',
            }}>
            {favourites.includes(icao) ? '★' : '☆'} {favourites.includes(icao) ? 'Saved' : 'Save'}
          </button>

          {homeIcao === icao ? (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', borderRadius: 20,
              background: 'var(--bg-card-2)', color: 'var(--text-secondary)',
              fontSize: 12, fontWeight: 700,
            }}>⌂ Home airport</span>
          ) : (
            <button
              onClick={setAsHomeAirport}
              style={{
                padding: '7px 12px', borderRadius: 20, cursor: 'pointer',
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text)', fontSize: 12, fontWeight: 700,
                WebkitTapHighlightColor: 'transparent',
              }}>⌂ Set home airport</button>
          )}
        </div>
      )}

      {/* Saved fields, one tap away. Home is pinned first and marked, since
          it is the one a pilot reaches for most and is not necessarily
          saved as a favourite too. */}
      {(favourites.length > 0 || homeIcao) && (
        <div style={{
          padding: '10px 20px 0', display: 'flex', gap: 8,
          overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        }}>
          {[...(homeIcao ? [homeIcao] : []), ...favourites.filter(f => f !== homeIcao)].map(id => (
            <button
              key={id}
              onClick={() => selectAirport(id)}
              style={{
                flexShrink: 0, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
                border: id === icao ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: id === icao ? 'var(--accent)' : 'var(--bg-card)',
                color: id === icao ? 'var(--accent-fg)' : 'var(--text)',
                fontSize: 12, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.04em',
                WebkitTapHighlightColor: 'transparent',
              }}>
              {id === homeIcao ? '⌂ ' : ''}{id}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: '16px 18px 40px' }}>
        {icao && (
          <>
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>
                {loading && !displayName ? 'Loading…' : (displayName || icao)}
              </div>
              {airspaceClass && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Class {airspaceClass} Airspace
                </div>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <AirportDiagram
                icao={icao}
                lat={info?.lat ?? wx?.metar?.lat}
                lon={info?.lon ?? wx?.metar?.lon}
                runways={details?.r}
                cat={cat}
                loading={loading && !wx}
                temp={ownMetar ? parseTemp(ownMetar, units) : '—'}
                windDir={ownMetar ? parseWindParts(ownMetar, units).dir : null}
                windSpeed={ownMetar ? parseWindParts(ownMetar, units).speed : '—'}
                vis={ownMetar ? parseVisib(ownMetar, units) : '—'}
                officialChart={procedures?.airport?.[0] ?? null}
                onOpenOfficial={() => {
                  const [chartName, pdfName] = procedures.airport[0]
                  setOpenChart({ chartName, pdfName })
                }}
              />
            </div>

            <div style={{ marginTop: 16 }}>
              <SegControl options={TABS} value={tab} onChange={setTab} />
            </div>

            {tab === 'Weather' && (
              <div style={{ marginTop: 16 }}>
                {wx?.metar && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px',
                    fontSize: 13, color: 'var(--text-secondary)', padding: '0 2px', marginBottom: 12,
                  }}>
                    <div>Ceiling {parseCeiling(wx.metar, units)}</div>
                    <div>Altimeter {parseAltim(wx.metar, units)}</div>
                  </div>
                )}
                {(wx?.metar?.rawOb || wx?.taf?.rawTAF) ? (
                  <div style={CARD}>
                    <RawTextRow title="Raw METAR" text={wx.metar?.rawOb} color={cat?.color} age={parseObsAge(wx.metar)} first />
                    <RawTextRow title="Raw TAF" text={wx.taf?.rawTAF} colorize age={parseTafAge(wx.taf)} first={!wx.metar?.rawOb} />
                  </div>
                ) : loading ? (
                  <div style={CARD}><EmptyRow>Loading weather…</EmptyRow></div>
                ) : wx?.noReport ? (
                  <SubstituteWeather
                    icao={icao} sub={sub} loading={subLoading} units={units}
                    RawRow={RawTextRow}
                  />
                ) : (
                  // Not "no weather at this airport" — the lookup itself
                  // failed, and saying otherwise would blame the field for
                  // the network.
                  <div style={CARD}>
                    <EmptyRow>{wx?.error ? "Couldn't reach the weather service. Pull down to try again." : 'No weather available for this airport'}</EmptyRow>
                  </div>
                )}
              </div>
            )}

            {tab === 'NOTAMs' && (
              <div style={{ marginTop: 16 }}>
                <Notams icao={icao} result={notams} />
              </div>
            )}

            {tab === 'Frequencies' && (
              <div style={{ marginTop: 16, background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                {details?.f?.length
                  ? details.f.map(([name, freq], i) => (
                    <ListRow key={i} first={i === 0} left={name} right={freq.toFixed(3)} />
                  ))
                  : <EmptyRow>No frequency data</EmptyRow>}
              </div>
            )}

            {tab === 'Runways' && (
              <div style={{ marginTop: 16, background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                {details?.r?.length
                  ? details.r.map(([id1, id2, lengthFt, surface], i) => (
                    <ListRow key={i} first={i === 0} left={`${id1}/${id2}`} right={`${lengthFt} ft · ${surface}`} />
                  ))
                  : <EmptyRow>No runway data</EmptyRow>}
              </div>
            )}

            {tab === 'Procedures' && (
              <div style={{ marginTop: 16 }}>
                {!isUSIdent(icao) ? (
                  <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                    <EmptyRow>Procedure charts aren't available for this airport yet</EmptyRow>
                  </div>
                ) : procedures === undefined ? (
                  <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                    <EmptyRow>Loading procedures…</EmptyRow>
                  </div>
                ) : (
                  PROCEDURE_SECTIONS.map(({ key, label, hideWhenEmpty }) => {
                    const charts = procedures?.[key] ?? []
                    if (hideWhenEmpty && !charts.length) return null
                    return (
                      <div key={key} style={{ marginBottom: 16 }}>
                        <div style={{
                          margin: '0 2px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                          textTransform: 'uppercase', color: 'var(--text-tertiary)',
                        }}>{label}</div>
                        <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                          {charts.length
                            ? charts.map(([chartName, pdfName], i) => (
                              <ProcedureRow
                                key={pdfName} first={i === 0} chartName={chartName}
                                onOpen={() => setOpenChart({ chartName, pdfName })}
                              />
                            ))
                            : <EmptyRow>No {label.toLowerCase()} procedures published</EmptyRow>}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </>
        )}
      </div>

      {pickerOpen && (
        <AirportPickerModal
          current={icao}
          onConfirm={selectAirport}
          onClose={() => setPickerOpen(false)}
          label="Airport Lookup"
          title="Find an Airport"
          confirmLabel="View Airport"
        />
      )}
    </div>
  )
}
