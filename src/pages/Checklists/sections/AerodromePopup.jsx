// A field along the route, opened from the map or the aerodromes list.
//
// The question this answers is not "what is that airport called" — it is
// "could I put the aircraft down there, and what would I find when I did".
// So the order is deliberate: how far off track, then the runways, then the
// weather, then the frequencies. A 2,000 ft grass strip and 10,000 ft of
// asphalt are very different answers, and a popup that led with the name and
// buried the runway would be answering the wrong question.
//
// Nothing here implies the field is suitable. It shows what is published and
// lets the pilot judge; the Chart Supplement is still the authority, and the
// footer says which cycle the bundled data came from.

import { useEffect, useState } from 'react'
import { lookupAirport } from '../shared/awc'
import {
  fetchMetar, nearestMetar, parseFltCat, parseWind, parseVisib,
  parseCeiling, parseTemp, parseAltim, parseObsAge,
} from '../../../lib/weather'

// The groups a pilot reaches for in the air, in the order they need them.
const FREQ_GROUPS = [
  { key: 'ctaf',  label: 'CTAF/UNICOM', match: t => /CTAF|UNICOM|MULTICOM/i.test(t) },
  { key: 'twr',   label: 'Tower',       match: t => /TOWER|TWR/i.test(t) },
  { key: 'gnd',   label: 'Ground',      match: t => /GROUND|GND/i.test(t) },
  { key: 'atis',  label: 'ATIS/AWOS',   match: t => /ATIS|AWOS|ASOS|AWSS/i.test(t) },
  { key: 'app',   label: 'Approach',    match: t => /APP|DEP|CENTER|CTR|RADAR/i.test(t) },
]

export default function AerodromePopup({ field, onClose, onSetAlternate, onDivert, onShowSectional }) {
  const [details, setDetails] = useState(null)
  const [wx, setWx] = useState(null)          // { metar, station, distNm|0 } | 'none'
  const [loading, setLoading] = useState(true)

  // No state reset here: the caller keys this component on the field's ident,
  // so a different field is a fresh mount with fresh state rather than an old
  // field's runways and weather lingering while the new ones load.
  useEffect(() => {
    if (!field) return
    let cancelled = false

    lookupAirport(field.ident)
      .then(d => { if (!cancelled) setDetails(d) })
      .catch(() => { if (!cancelled) setDetails(null) })
      .finally(() => { if (!cancelled) setLoading(false) })

    // Its own report first. Only when the field does not publish one does the
    // nearest station get asked for — one extra request, and only sometimes.
    fetchMetar(field.ident)
      .then(m => { if (!cancelled) setWx({ metar: m, station: field.ident, distNm: 0 }) })
      .catch(async () => {
        const near = await nearestMetar(field.lat, field.lon, { withinNm: 20 })
        if (!cancelled) setWx(near ?? 'none')
      })

    return () => { cancelled = true }
  }, [field?.ident])

  if (!field) return null

  const runways = details?.runways ?? []
  // Longest first: on an unplanned landing that is the number that decides.
  // parseInt copes with the "10,000 ft" formatting by reading up to the comma,
  // so lengths are compared in thousands — enough to order them, and the
  // displayed string is the real figure either way.
  const lengthOf = r => Number(String(r.len ?? '').replace(/[^\d]/g, '')) || 0
  const byLength = [...runways].sort((a, b) => lengthOf(b) - lengthOf(a))
  // Only meaningful when there are lengths to compare — badging one runway
  // "longest" out of six that all read "—" says nothing and looks like data.
  const longest = lengthOf(byLength[0] ?? {}) > 0 ? byLength[0] : null

  const metar = wx && wx !== 'none' ? wx.metar : null
  const raw = metar?.rawOb ?? null
  // parseFltCat returns the category's own descriptor, not its key.
  const cat = raw ? parseFltCat(metar) : null

  const grouped = []
  const used = new Set()
  for (const g of FREQ_GROUPS) {
    const hit = (details?.frequencies ?? []).filter(f => g.match(f.type || ''))
    hit.forEach(f => used.add(f.freq + f.type))
    if (hit.length) grouped.push({ ...g, freqs: hit })
  }
  const others = (details?.frequencies ?? []).filter(f => !used.has(f.freq + f.type))

  return (
    <div style={{
      position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 10030,
      background: 'rgba(12,12,16,0.97)', backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)', border: '0.5px solid rgba(255,255,255,0.14)',
      borderRadius: 16, padding: '13px 14px', boxShadow: '0 8px 36px rgba(0,0,0,0.6)',
      maxHeight: '72%', display: 'flex', flexDirection: 'column',
      userSelect: 'none', WebkitUserSelect: 'none',
    }}>
      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 800, fontFamily: 'monospace', letterSpacing: '1px', color: '#fff' }}>
              {field.ident}
            </span>
            {cat && (
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.5px', padding: '2px 6px',
                borderRadius: 6, background: cat.bg, color: cat.color,
              }}>{cat.label}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {details?.name || field.name || field.clsLabel}
          </div>
        </div>
        <span onClick={onClose} style={{ fontSize: 17, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>✕</span>
      </div>

      {/* Where it is relative to the flight — the reason it is in the list */}
      <div style={{ display: 'flex', gap: 14, marginTop: 9, paddingBottom: 9,
        borderBottom: '0.5px solid rgba(255,255,255,0.1)' }}>
        <Stat label="OFF TRACK" value={`${field.distNm} NM`} />
        <Stat label="ALONG ROUTE" value={`${field.alongNm} NM`} />
        {details?.elev && <Stat label="ELEVATION" value={details.elev} />}
      </div>

      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, marginTop: 9 }}>
        {/* Runways — the first thing that decides whether this is an option */}
        <Section title="Runways">
          {loading && <Muted>Loading…</Muted>}
          {!loading && !runways.length && (
            <Muted>No runway data published for {field.ident} — check the Chart Supplement.</Muted>
          )}
          {byLength.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0' }}>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: '#fff', minWidth: 34 }}>{r.id}</span>
              <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.75)' }}>{r.len ?? '—'}</span>
              {r.sfc && <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)' }}>{r.sfc}</span>}
              {r === longest && byLength.length > 1 && (
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ok)', letterSpacing: '0.4px' }}>LONGEST</span>
              )}
            </div>
          ))}
        </Section>

        {/* Weather */}
        <Section title="Weather">
          {wx === null && <Muted>Checking…</Muted>}
          {wx === 'none' && (
            <Muted>No report at {field.ident}, and no reporting station within 20 NM.</Muted>
          )}
          {metar && (
            <>
              {wx.distNm > 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--warn)', marginBottom: 4, lineHeight: 1.4 }}>
                  {field.ident} does not report. Nearest is {wx.station}, {Math.round(wx.distNm)} NM away —
                  conditions there, not here.
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 5 }}>
                <Stat label="WIND" value={parseWind(metar) ?? '—'} small />
                <Stat label="VIS" value={parseVisib(metar) ?? '—'} small />
                <Stat label="CEILING" value={parseCeiling(metar) ?? '—'} small />
                <Stat label="TEMP" value={parseTemp(metar) ?? '—'} small />
                <Stat label="ALTIMETER" value={parseAltim(metar) ?? '—'} small />
              </div>
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)',
                lineHeight: 1.45, wordBreak: 'break-word' }}>{raw}</div>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
                {parseObsAge(metar) ?? ''}
              </div>
            </>
          )}
        </Section>

        {/* Frequencies */}
        <Section title="Frequencies">
          {loading && <Muted>Loading…</Muted>}
          {!loading && !details?.frequencies?.length && (
            <Muted>None published for {field.ident} in our data — check the Chart Supplement or the AIP.</Muted>
          )}
          {grouped.map(g => (
            <div key={g.key} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0' }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', minWidth: 82, letterSpacing: '0.3px' }}>{g.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: '#fff' }}>
                {g.freqs.map(f => f.freq).join('  ')}
              </span>
            </div>
          ))}
          {others.length > 0 && (
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 3, lineHeight: 1.5 }}>
              {others.map(f => `${f.type} ${f.freq}`).join(' · ')}
            </div>
          )}
        </Section>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 7, marginTop: 10 }}>
        <button onClick={() => onSetAlternate?.(field)} style={btn(false)}>Set as alternate</button>
        <button onClick={() => onDivert?.(field)} style={btn(true)}>Divert here</button>
      </div>
      <button onClick={() => onShowSectional?.()} style={{
        marginTop: 7, width: '100%', padding: '8px 0', borderRadius: 9, cursor: 'pointer',
        background: 'transparent', border: '0.5px solid rgba(255,255,255,0.2)',
        color: 'rgba(255,255,255,0.7)', fontSize: 11.5, fontWeight: 600,
      }}>Show sectional here</button>

      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 7, lineHeight: 1.45 }}>
        {details?.freqSource
          ? `${details.freqSource.label}${details.freqSource.cycle ? ` · ${details.freqSource.cycle}` : ''}. `
          : ''}
        Published data, not a suitability assessment — check the Chart Supplement, NOTAMs and hours before using this field.
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  )
}

function Stat({ label, value, small }) {
  return (
    <div>
      <div style={{ fontSize: small ? 12 : 13.5, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.4px', marginTop: 1 }}>{label}</div>
    </div>
  )
}

function Muted({ children }) {
  return <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>{children}</div>
}

function btn(primary) {
  return {
    flex: 1, padding: '10px 0', borderRadius: 9, cursor: 'pointer',
    background: primary ? 'var(--text)' : 'rgba(255,255,255,0.08)',
    color: primary ? 'var(--bg)' : '#fff',
    border: primary ? 'none' : '0.5px solid rgba(255,255,255,0.18)',
    fontSize: 12.5, fontWeight: 700,
  }
}
