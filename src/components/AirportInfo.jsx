import { useState, useEffect } from 'react'
import { BackButton } from './Shell'
import { SegControl } from './SegControl'
import AirportPickerModal from './AirportPickerModal'
import AirportDiagram from './AirportDiagram'
import { get, put } from '../lib/db'
import { usePilotProfile } from '../context/PilotProfile'
import { getAirports } from '../lib/aerodromes'
import { classAtPoint } from '../lib/airspace'
import airportDetails from '../data/geo/airport_details.json'
import {
  loadWeather, parseFltCat, parseWindParts, parseVisib, parseCeiling,
  parseTemp, parseAltim, parseAirportName, colorizeTaf,
} from '../lib/weather'

const TABS = ['Weather', 'Frequencies', 'Runways']

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
function RawTextRow({ title, text, first, colorize, color }) {
  if (!text) return null
  const lines = colorize ? colorizeTaf(text) : null
  return (
    <div style={{ padding: '14px 16px', borderTop: first ? 'none' : '0.5px solid var(--border)' }}>
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
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

  useEffect(() => {
    get('settings', 'lastAirportLookup').then(row => {
      if (row?.value) setIcao(row.value)
      else setPickerOpen(true)
    })
  }, [])

  useEffect(() => {
    if (!icao) return
    setLoading(true)
    setInfo(null)
    setWx(null)
    setAirspaceClass(null)
    Promise.all([
      getAirports().then(list => list.find(a => a[0] === icao) ?? null),
      loadWeather(icao).catch(() => null),
    ]).then(([hit, wxResult]) => {
      if (hit) {
        const [ident, lat, lon, cls, name] = hit
        setInfo({ ident, lat, lon, cls, name })
      } else {
        setInfo({ ident: icao, name: null, cls: null })
      }
      setWx(wxResult)
      setLoading(false)
    })
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

  function selectAirport(id) {
    setIcao(id)
    setPickerOpen(false)
    setTab('Weather')
    put('settings', { key: 'lastAirportLookup', value: id })
  }

  const details = icao ? airportDetails[icao] : null
  const cat = wx?.metar ? parseFltCat(wx.metar) : null
  const displayName = info?.name?.trim() || (wx?.metar ? parseAirportName(wx.metar) : null)

  return (
    <div>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton />
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
                temp={wx?.metar ? parseTemp(wx.metar, units) : '—'}
                windDir={wx?.metar ? parseWindParts(wx.metar, units).dir : null}
                windSpeed={wx?.metar ? parseWindParts(wx.metar, units).speed : '—'}
                vis={wx?.metar ? parseVisib(wx.metar, units) : '—'}
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
                  <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                    <RawTextRow title="Raw METAR" text={wx.metar?.rawOb} color={cat?.color} first />
                    <RawTextRow title="Raw TAF" text={wx.taf?.rawTAF} colorize first={!wx.metar?.rawOb} />
                  </div>
                ) : (
                  <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                    <EmptyRow>{loading ? 'Loading weather…' : 'No weather available for this airport'}</EmptyRow>
                  </div>
                )}
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
