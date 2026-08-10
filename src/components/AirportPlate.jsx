// The field you are over, said over the map.
//
// The runway layer draws the pavement; this says whose pavement it is. It
// appears and disappears with that layer, on the same zoom floor, because the
// two answer one question between them: a pilot who has come down to a single
// aerodrome wants its identifier, its elevation, its runways and its
// frequencies, and wants them without leaving the map to go and find a screen.
//
// It opens as a bar rather than a card on purpose. The moment this appears is
// the moment the map matters most, and a panel covering a third of it to show
// four frequencies the pilot may not want yet is a poor trade. The bar carries
// the three things that are always wanted; a tap gets the rest, and that tap
// is also what pays for the frequency pack, so a pilot who only ever glances
// at the identifier never downloads two megabytes to do it.
//
// Nothing here is presented as more official than it is. Runway positions come
// from a surveyed national source in the United States and from community data
// elsewhere, and the plate says which. The chart button opens the FAA's own
// airport diagram where the FAA publishes one, and where it does not it names
// the authority that does instead of sending a pilot to a scan of one.

import { useEffect, useMemo, useRef, useState } from 'react'
import { getAirports, getAirportDetails } from '../lib/aerodromes'
import { officialChart } from '../lib/airportCharts'

// Which frequencies a pilot reaches for, in the order they reach for them.
// Everything else the pack holds (Center, Emergency, Ramp, Operations) is real
// but is not what you tune on the way in, and four lines is what fits.
// Radio and AFIS are here because outside the United States they are often the
// only station on the field: Ilopango's own aerodrome chart prints RDO 127.05
// beside its tower and ground, and a plate that dropped it would be quieter
// than the chart it is standing in for.
const FREQ_ORDER = [
  'D-ATIS', 'ATIS', 'AWOS', 'ASOS', 'AWSS', 'CTAF', 'UNICOM',
  'Tower', 'Ground', 'Clearance Delivery', 'Approach', 'Approach/Departure', 'Departure',
  'Radio', 'AFIS',
]

function pickFrequencies(list) {
  if (!list?.length) return []
  const byLabel = new Map()
  for (const [label, mhz] of list) {
    if (!byLabel.has(label)) byLabel.set(label, mhz)
  }
  const out = []
  for (const label of FREQ_ORDER) {
    if (byLabel.has(label)) out.push([label, byLabel.get(label)])
  }
  return out.slice(0, 6)
}

// 118 -> 118.0, 121.650 -> 121.65. A frequency is read aloud, and both a
// bare "118" and a padded "121.650" are read wrong.
function fmtMhz(mhz) {
  const s = mhz.toFixed(3).replace(/0+$/, '')
  return s.endsWith('.') ? `${s}0` : s
}

// Frequencies and runway positions come out of two different packs built from
// different sources on different cycles, so they get two credits rather than
// one. Ilopango's runway is community data and its frequencies are the
// COCESNA eAIP: saying "OurAirports" over both would be wrong about half of it.
function freqCredit(source, cycles) {
  if (source === 'FAA') return `Frequencies: FAA NASR${cycles?.FAA ? ` ${cycles.FAA}` : ''}.`
  if (source === 'AIP') return `Frequencies: ${cycles?.AIP ?? 'the regional eAIP'}.`
  return 'Frequencies: OurAirports, community data.'
}

function runwayLine(r) {
  const [le, he, , , , , lengthFt, widthFt] = r
  const size = lengthFt
    ? `${lengthFt.toLocaleString()}${widthFt ? ` x ${widthFt.toLocaleString()}` : ''} ft`
    : 'length not published'
  return { name: `${le}/${he}`, size }
}

const SHEET = {
  background: 'var(--map-panel-solid)',
  color: 'var(--map-ink)',
  borderRadius: 16,
  boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
  overflow: 'hidden',
}

export default function AirportPlate({ field, onOpenChart }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(null)
  const [freqs, setFreqs] = useState(null)
  const [freqSource, setFreqSource] = useState(null)
  const [chart, setChart] = useState(null)
  const ident = field?.ident ?? null

  // Walking to a different field closes the detail again. Leaving it open
  // would mean the panel silently changes what it is describing underneath a
  // pilot who is panning, which is the one thing a plate must not do.
  const lastIdent = useRef(ident)
  useEffect(() => {
    if (lastIdent.current !== ident) {
      lastIdent.current = ident
      setOpen(false)
      setName(null)
      setFreqs(null)
      setFreqSource(null)
      setChart(null)
    }
  }, [ident])

  // The name is cheap: airports.json is the app's core pack and is already in
  // memory in most sessions. It fills in behind the identifier rather than
  // holding the plate back, because the identifier is the part that matters.
  useEffect(() => {
    if (!ident) return
    let cancelled = false
    getAirports().then(list => {
      if (cancelled) return
      const row = list.find(a => a[0] === ident)
      setName(row?.[4] ?? null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [ident])

  // Frequencies and the chart lookup wait for the tap that asks for them.
  useEffect(() => {
    if (!open || !ident) return
    let cancelled = false
    getAirportDetails().then(det => {
      if (cancelled) return
      setFreqs(pickFrequencies(det?.[ident]?.f))
      setFreqSource(freqCredit(det?.[ident]?.s, det?._meta?.cycles))
    }).catch(() => { if (!cancelled) setFreqs([]) })
    officialChart(ident).then(c => { if (!cancelled) setChart(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [open, ident])

  const runways = useMemo(() => (field?.runways ?? []).map(runwayLine), [field])

  if (!field) return null

  const elev = field.elevFt != null ? `${field.elevFt.toLocaleString()} ft` : null
  const longest = (field.runways ?? []).reduce((best, r) => (r[6] > (best?.[6] ?? 0) ? r : best), null)
  const sourceLine = field.source === 'FAA'
    ? `Runway positions: FAA NASR${field.cycles?.FAA ? ` ${field.cycles.FAA}` : ''}, surveyed.`
    : 'Runway positions: OurAirports, community data.'

  return (
    <div style={{ ...SHEET, width: open ? 'min(340px, calc(100vw - 28px))' : 'auto', maxWidth: 'calc(100vw - 28px)' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '9px 12px', background: 'transparent', border: 0, cursor: 'pointer',
        color: 'inherit', textAlign: 'left',
      }}>
        <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.3px' }}>{ident}</span>
        {elev && (
          <span style={{ fontSize: 12, color: 'var(--map-ink-dim)', whiteSpace: 'nowrap' }}>{elev}</span>
        )}
        {!open && longest && (
          <span style={{ fontSize: 12, color: 'var(--map-ink-dim)', whiteSpace: 'nowrap' }}>
            {longest[0]}/{longest[1]} · {longest[6].toLocaleString()} ft
          </span>
        )}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          style={{ marginLeft: 'auto', opacity: 0.55, transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>

      {open && (
        <div style={{ padding: '0 12px 12px' }}>
          {name && (
            <div style={{ fontSize: 12, color: 'var(--map-ink-dim)', lineHeight: 1.35, marginBottom: 10 }}>
              {name}
            </div>
          )}

          <Label>Runways</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 11 }}>
            {runways.map(r => (
              <div key={r.name} style={{ display: 'flex', gap: 10, fontSize: 12.5 }}>
                <span style={{ fontWeight: 800, fontFamily: 'ui-monospace, Menlo, monospace', minWidth: 54 }}>
                  {r.name}
                </span>
                <span style={{ color: 'var(--map-ink-dim)' }}>{r.size}</span>
              </div>
            ))}
          </div>

          <Label>Frequencies</Label>
          <div style={{ marginBottom: 11 }}>
            {freqs === null && (
              <div style={{ fontSize: 12, color: 'var(--map-ink-faint)' }}>Loading…</div>
            )}
            {freqs?.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--map-ink-faint)' }}>None published for this field.</div>
            )}
            {freqs?.map(([label, mhz]) => (
              <div key={label} style={{ display: 'flex', gap: 10, fontSize: 12.5 }}>
                <span style={{ color: 'var(--map-ink-dim)', minWidth: 118 }}>{label}</span>
                <span style={{ fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                  {fmtMhz(mhz)}
                </span>
              </div>
            ))}
          </div>

          <ChartAction chart={chart} ident={ident} onOpenChart={onOpenChart} />

          <div style={{ marginTop: 10, fontSize: 10.5, color: 'var(--map-ink-faint)', lineHeight: 1.4 }}>
            {sourceLine}
            {freqSource && <><br />{freqSource}</>}
          </div>
        </div>
      )}
    </div>
  )
}

function Label({ children }) {
  return (
    <div style={{
      fontSize: 9.5, fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase',
      color: 'var(--map-ink-faint)', marginBottom: 5,
    }}>{children}</div>
  )
}

const BTN = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  width: '100%', padding: '10px 12px', borderRadius: 11, border: 0,
  background: 'var(--map-ink)', color: 'var(--map-ink-invert)',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'none',
}

function DiagramIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  )
}

function ChartAction({ chart, ident, onOpenChart }) {
  if (!chart) return <div style={{ fontSize: 12, color: 'var(--map-ink-faint)' }}>Checking charts…</div>

  if (chart.kind === 'faa') {
    return (
      <button style={BTN} onClick={() => onOpenChart?.({ ...chart, icao: ident })}>
        <DiagramIcon /> Airport diagram
      </button>
    )
  }

  if (chart.kind === 'faa-search') {
    return (
      <>
        <a style={BTN} href={chart.url} target="_blank" rel="noreferrer">
          <DiagramIcon /> Search FAA charts
        </a>
        <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--map-ink-faint)', lineHeight: 1.4 }}>
          No airport diagram is published for this field in the current cycle.
        </div>
      </>
    )
  }

  // Outside FAA coverage. The chart exists; this app does not carry it, and
  // says whose it is rather than offering something that is not it.
  return (
    <div style={{
      padding: '9px 11px', borderRadius: 11, background: 'var(--map-panel)',
      fontSize: 11.5, color: 'var(--map-ink-dim)', lineHeight: 1.45,
    }}>
      {chart.kind === 'authority'
        ? <>Aerodrome charts for {chart.country} are published by {chart.name}, in its AIP. This app does not carry them.</>
        : <>No official aerodrome chart source is known to this app for this field.</>}
    </div>
  )
}
