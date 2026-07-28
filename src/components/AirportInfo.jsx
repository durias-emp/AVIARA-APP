import { useState, useEffect } from 'react'
import { BackButton } from './Shell'
import AirportPickerModal from './AirportPickerModal'
import { get, put } from '../lib/db'
import { usePilotProfile } from '../context/PilotProfile'
import { getAirports } from '../lib/aerodromes'
import airportDetails from '../data/geo/airport_details.json'
import {
  loadWeather, parseFltCat, parseWind, parseVisib, parseCeiling,
  parseTemp, parseAltim, parseAirportName,
} from '../lib/weather'

const CLASS_LABEL = ['Small airport', 'Medium airport', 'Large airport']

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: 'var(--text-tertiary)', margin: '20px 2px 8px',
    }}>
      {children}
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

export default function AirportInfo() {
  const { profile } = usePilotProfile()
  const units = profile ?? {}
  const [icao, setIcao] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [info, setInfo] = useState(null)
  const [wx, setWx] = useState(null)
  const [loading, setLoading] = useState(false)

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

  function selectAirport(id) {
    setIcao(id)
    setPickerOpen(false)
    put('settings', { key: 'lastAirportLookup', value: id })
  }

  const details = icao ? airportDetails[icao] : null
  const cat = wx?.metar ? parseFltCat(wx.metar) : null
  const displayName = info?.name?.trim() || (wx?.metar ? parseAirportName(wx.metar) : null)

  return (
    <div>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton />
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Airports</h2>
      </div>

      <div style={{ padding: '16px 18px 40px' }}>
        <div
          onClick={() => setPickerOpen(true)}
          style={{
            background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)',
            padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}>
          <span style={{
            fontSize: 18, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.06em',
            color: icao ? 'var(--text)' : 'var(--text-tertiary)',
          }}>
            {icao || 'Search airport'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>Change</span>
        </div>

        {icao && (
          <>
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>
                {loading && !displayName ? 'Loading…' : (displayName || icao)}
              </div>
              {info?.cls != null && CLASS_LABEL[info.cls] && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {CLASS_LABEL[info.cls]}
                </div>
              )}
            </div>

            <div style={{
              marginTop: 16, background: 'var(--bg-card)', borderRadius: 20,
              boxShadow: 'var(--shadow-sm)', padding: '16px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 34, fontWeight: 800, color: 'var(--text)', letterSpacing: '-1px' }}>
                  {wx?.metar ? parseTemp(wx.metar, units) : loading ? '…' : '—'}
                </span>
                {cat && (
                  <span style={{
                    fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: '#fff',
                    background: cat.color, padding: '4px 10px', borderRadius: 20,
                  }}>{cat.label}</span>
                )}
              </div>
              {wx?.metar ? (
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px',
                  marginTop: 14, fontSize: 13, color: 'var(--text-secondary)',
                }}>
                  <div>Wind {parseWind(wx.metar, units)}</div>
                  <div>Vis {parseVisib(wx.metar, units)}</div>
                  <div>Ceiling {parseCeiling(wx.metar, units)}</div>
                  <div>Altimeter {parseAltim(wx.metar, units)}</div>
                </div>
              ) : (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {loading ? 'Loading weather…' : 'No weather available for this airport'}
                </div>
              )}
            </div>

            <SectionLabel>Frequencies</SectionLabel>
            <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
              {details?.f?.length
                ? details.f.map(([name, freq], i) => (
                  <ListRow key={i} first={i === 0} left={name} right={freq.toFixed(3)} />
                ))
                : <EmptyRow>No frequency data</EmptyRow>}
            </div>

            <SectionLabel>Runways</SectionLabel>
            <div style={{ background: 'var(--bg-card)', borderRadius: 16, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
              {details?.r?.length
                ? details.r.map(([id1, id2, lengthFt, surface], i) => (
                  <ListRow key={i} first={i === 0} left={`${id1}/${id2}`} right={`${lengthFt} ft · ${surface}`} />
                ))
                : <EmptyRow>No runway data</EmptyRow>}
            </div>
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
