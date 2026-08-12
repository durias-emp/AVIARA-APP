// The field you are over, said over the map.
//
// The runway layer draws the pavement; this says whose pavement it is. It
// appears and disappears with that layer, on the same zoom floor, because the
// two answer one question between them: a pilot who has come down to a single
// aerodrome wants its identifier, its elevation, its runways and its
// frequencies, and wants them without leaving the map to go and find a screen.
//
// It is a SECTION, not a card. It draws no background, no corners and no
// shadow of its own, because it lives inside the weather ribbon's card, under
// a hairline (see WeatherRibbon's `below`). It was a card once, floating four
// pixels under that one, and two rounded panels stacked like that read as one
// thing that had come apart; worse, expanding the weather put its panel
// underneath this one and the temperature disappeared behind it. Conditions
// here and the field here are the same question, so they are one object.
//
// In `inline` mode, which is how the map home uses it, it has no chevron of
// its own: it is the lower half of the card's one expansion, so the ident row
// is a heading rather than a control and the body is simply there. It kept its
// own accordion for one build, and the result was a resting pill carrying two
// collapsed rows and two chevrons for what a pilot reads as one glance.
//
// Either way the frequencies wait for the tap that reveals this, which is what
// pays for the frequency pack: a pilot who only ever glances at the map never
// downloads two megabytes to do it.
//
// Nothing here is presented as more official than it is. Runway positions come
// from a surveyed national source in the United States and from community data
// elsewhere, and the plate says which. The chart button opens the FAA's own
// airport diagram where the FAA publishes one, and where it does not it names
// the authority that does instead of sending a pilot to a scan of one.

import { createElement, useEffect, useMemo, useRef, useState } from 'react'
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
//
// Fragments now, not sentences. The two credits were two full lines of prose
// at the foot of a card the owner wants read at a glance, so they share one
// faint line instead: "Rwys FAA NASR 06 Aug 2026 · Freq FAA NASR 09 Jul 2026".
// Compressed, never removed. The sourcing rule is the one thing this card may
// not drop: community data announcing itself is the difference between this
// plate and one pretending to be official.
function freqCredit(source, cycles) {
  if (source === 'FAA') return `FAA NASR${cycles?.FAA ? ` ${cycles.FAA}` : ''}`
  if (source === 'AIP') return cycles?.AIP ?? 'regional eAIP'
  return 'OurAirports, community'
}

function runwayLine(r) {
  const [le, he, , , , , lengthFt, widthFt] = r
  const size = lengthFt
    ? `${lengthFt.toLocaleString()}${widthFt ? ` x ${widthFt.toLocaleString()}` : ''} ft`
    : 'length not published'
  return { name: `${le}/${he}`, size }
}

// inline: no chevron, no toggle, body always drawn. The card above owns the
// opening, and `expanded` is then only telling this component whether it is
// visible, so that the frequency pack is still fetched on the tap rather than
// on the pan that brought the field into view.
//
// expanded / onExpandedChange: see WeatherRibbon.
//
// maxBodyH: the tallest the open body may be before it scrolls inside itself.
// Unused in inline mode, where the card's own expansion is the scroller and a
// second one nested inside it would trap the flick that reaches it.
export default function AirportPlate({
  field, onOpenChart, expanded, onExpandedChange, maxBodyH, inline = false,
}) {
  const [selfOpen, setSelfOpen] = useState(false)
  const open = expanded ?? selfOpen
  const setOpen = onExpandedChange ?? setSelfOpen
  const [name, setName] = useState(null)
  const [freqs, setFreqs] = useState(null)
  const [freqSource, setFreqSource] = useState(null)
  const [chart, setChart] = useState(null)
  const ident = field?.ident ?? null

  // Walking to a different field closes the detail again. Leaving it open
  // would mean the panel silently changes what it is describing underneath a
  // pilot who is panning, which is the one thing a plate must not do.
  //
  // Only the loaded FACTS are cleared here. Whether the section is open
  // belongs to whoever is arbitrating it, and on the map home that is the
  // parent, which folds this shut on a change of field for exactly this
  // reason. From in here, "closed" and "nothing in the card is open" are the
  // same call, and it would have folded the weather away every time a pilot
  // panned across a new aerodrome.
  const lastIdent = useRef(ident)
  useEffect(() => {
    if (lastIdent.current !== ident) {
      lastIdent.current = ident
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
    ? `FAA NASR${field.cycles?.FAA ? ` ${field.cycles.FAA}` : ''}, surveyed`
    : 'OurAirports, community'

  return (
    <div style={{ color: 'var(--map-ink)' }}>
      {/* Three facts and a chevron in a row that has to survive a 375pt phone
          with the drawer's arrow beside it. The sizes below are not taste:
          measured, this row needs 244 of the 247 it gets on the narrowest
          phone the app supports, which is why the gap is 8 and not 9 and why
          the two dim figures are 11.5 and not 12.
          Inline it is a heading, so it is a div: a button inside an already
          opened panel that toggles nothing is a target that lies. */}
      {createElement(inline ? 'div' : 'button', {
        onClick: inline ? undefined : () => setOpen(!open),
        style: {
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: inline ? '10px 12px 2px' : '8px 11px',
          background: 'transparent', border: 0, cursor: inline ? 'default' : 'pointer',
          color: 'inherit', textAlign: 'left',
        },
      }, <>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px', flexShrink: 0 }}>{ident}</span>
        {elev && (
          <span style={{ fontSize: 11.5, color: 'var(--map-ink-dim)', whiteSpace: 'nowrap', flexShrink: 0 }}>{elev}</span>
        )}
        {/* The runway summary is the first thing to give way on a narrow
            phone: the identifier and the elevation are always readable, and
            this ellipses rather than pushing the chevron off the card. It is
            the collapsed row's whole reason for existing, so inline, where the
            runways themselves are two lines below, it would be saying the same
            thing twice. */}
        {!inline && !open && longest && (
          <span style={{
            fontSize: 11.5, color: 'var(--map-ink-dim)', whiteSpace: 'nowrap',
            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {longest[0]}/{longest[1]} · {longest[6].toLocaleString()} ft
          </span>
        )}
        {!inline && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            style={{ marginLeft: 'auto', opacity: 0.55, transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
            <polyline points="18 15 12 9 6 15" />
          </svg>
        )}
      </>)}

      {(inline || open) && (
        <div style={{
          padding: '0 12px 12px', minWidth: 236,
          maxHeight: inline ? undefined : maxBodyH,
          overflowY: !inline && maxBodyH ? 'auto' : undefined,
          overscrollBehavior: 'contain',
        }}>
          {name && (
            <div style={{ fontSize: 12, color: 'var(--map-ink-dim)', lineHeight: 1.35, marginBottom: 10 }}>
              {name}
            </div>
          )}

          {/* Name left, figure hard against the right edge, both sections the
              same. The numbers used to sit in a second column a fixed way in
              from the left, which put a ragged gulf of card between a short
              label and its figure and made every row a different shape. Two
              edges, nothing in between: this is how a checklist prints, and it
              is the fastest thing there is to scan. */}
          <Label>Runways</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 11 }}>
            {runways.map(r => (
              <div key={r.name} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                gap: 10, fontSize: 12.5,
              }}>
                <span style={{ fontWeight: 800, fontFamily: 'ui-monospace, Menlo, monospace', flexShrink: 0 }}>
                  {r.name}
                </span>
                <span style={{ color: 'var(--map-ink-dim)', textAlign: 'right' }}>{r.size}</span>
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
              <div key={label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                gap: 10, fontSize: 12.5,
              }}>
                <span style={{ color: 'var(--map-ink-dim)' }}>{label}</span>
                <span style={{ fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                  {fmtMhz(mhz)}
                </span>
              </div>
            ))}
          </div>

          <ChartAction chart={chart} ident={ident} onOpenChart={onOpenChart} />

          {/* One faint line, both sources on it. See freqCredit for why it is
              compressed and why it can never be removed outright. */}
          <div style={{ marginTop: 9, fontSize: 9.5, color: 'var(--map-ink-faint)', lineHeight: 1.4 }}>
            Rwys {sourceLine}{freqSource && <> · Freq {freqSource}</>}
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
      <a style={BTN} href={chart.url} target="_blank" rel="noreferrer">
        <DiagramIcon /> Search FAA charts
      </a>
    )
  }

  // Outside FAA coverage the card offers nothing rather than a paragraph.
  //
  // It used to carry a three-line notice naming the authority whose AIP holds
  // the aerodrome chart, at the owner's request gone: on a card a pilot reads
  // on every approach it was the tallest thing in the section, and what it
  // said was that the app has nothing to show. A control that exists is
  // offered; one that does not is not apologised for. Note what this does NOT
  // touch: the sourcing rule covers data the card presents, and the runway and
  // frequency figures still carry their sources in the line at the foot. No
  // chart is shown here, so no chart source is owed.
  return null
}
