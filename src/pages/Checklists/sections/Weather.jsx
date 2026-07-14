import { useState, useEffect, useRef } from 'react'
import { IconRefresh } from '../../../components/Icons'
import { get, put } from '../../../lib/db'
import { ExpandableCard, DoneButton, Bone } from '../shared/ui'
import { FAA_AIRPORTS, FAA_DTPP_BASE } from '../shared/faaData'
import FAA_CHARTS_DATA from '../../../data/faa_charts.json'
import { awcUrl, proxyJSON, lookupAirport, parseMetar, bearingDeg, haversineNm } from '../shared/awc'

// Parse DMS string "28-25-45.8000N" → decimal degrees
function parseDMSAlt(dms) {
  if (!dms) return null
  const m = dms.match(/(\d+)-(\d+)-(\d+\.?\d*)\s*([NSEW])/)
  if (!m) return null
  let val = parseInt(m[1]) + parseInt(m[2])/60 + parseFloat(m[3])/3600
  if (m[4] === 'S' || m[4] === 'W') val = -val
  return val
}

export function AlternatesItem({ item, isChecked, onToggle }) {
  const [open, setOpen]       = useState(false)
  const [depIcao, setDepIcao] = useState('')
  const [destIcao, setDestIcao] = useState('')
  const [depPos, setDepPos]   = useState(null)
  const [destPos, setDestPos] = useState(null)
  const [burnRate, setBurnRate] = useState(10)

  // Takeoff alternate state
  const [toAlts, setToAlts]           = useState([])
  const [toQuery, setToQuery]         = useState('')
  const [toShowList, setToShowList]   = useState(false)
  const [toLoading, setToLoading]     = useState(false)
  const [toError, setToError]         = useState(null)
  const [toSuggestions, setToSuggestions] = useState([])
  const [toSuggestLoad, setToSuggestLoad] = useState(false)

  // Landing alternate state
  const [ldAlts, setLdAlts]           = useState([])
  const [ldQuery, setLdQuery]         = useState('')
  const [ldShowList, setLdShowList]   = useState(false)
  const [ldLoading, setLdLoading]     = useState(false)
  const [ldError, setLdError]         = useState(null)
  const [ldSuggestions, setLdSuggestions] = useState([])
  const [ldSuggestLoad, setLdSuggestLoad] = useState(false)

  const FAA_PDF_BASE = FAA_DTPP_BASE

  function altMinUrl(icao) {
    if (!icao) return null
    const ident = icao.replace(/^K/, '').toUpperCase()
    const charts = FAA_CHARTS_DATA[ident] || []
    const chart  = charts.find(([code, name]) => code === 'MIN' && name === 'ALTERNATE MINIMUMS')
    return chart ? FAA_PDF_BASE + chart[2] : null
  }

  async function fetchSuggestions(pos, excludeIcao, setSugg, setLoad) {
    if (!pos) return
    setSugg([]); setLoad(true)
    try {
      const pad = 1.2
      const bbox = `${pos[1]-pad},${pos[0]-pad},${pos[1]+pad},${pos[0]+pad}`
      const url = `https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/US_Airport/FeatureServer/0/query?where=OPERSTATUS%3D%27OPERATIONAL%27+AND+IAPEXISTS%3D1&geometry=${encodeURIComponent(bbox)}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=ICAO_ID,IDENT,NAME,LATITUDE,LONGITUDE,ELEVATION,STATE&returnGeometry=false&f=json`
      const res  = await fetch(url, { signal: AbortSignal.timeout(8000) })
      const data = await res.json()
      const nearby = (data.features || [])
        .map(f => {
          const a = f.attributes
          const lat = parseDMSAlt(a.LATITUDE), lon = parseDMSAlt(a.LONGITUDE)
          if (!a.ICAO_ID || !lat || !lon) return null
          const dist = Math.round(haversineNm(pos[0], pos[1], lat, lon))
          return { icao: a.ICAO_ID, name: a.NAME, state: a.STATE, lat, lon, elev: a.ELEVATION, dist }
        })
        .filter(a => a && a.icao !== excludeIcao && a.dist <= 70 && a.dist > 0)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 8)
      if (!nearby.length) { setLoad(false); return }
      const ids = nearby.map(a => a.icao).join(',')
      let metars = {}
      try {
        const mRes  = await fetch(awcUrl('metar', { ids, format: 'json', hours: '3' }), { signal: AbortSignal.timeout(8000) })
        const mData = await mRes.json()
        if (Array.isArray(mData)) mData.forEach(m => { metars[m.station_id || m.icaoId] = m.raw_text || '' })
      } catch { /* ignore */ }
      const withWx = nearby.map(a => ({ ...a, wx: metars[a.icao] ? parseMetar(metars[a.icao]) : null }))
      const catOrder = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3, null: 4 }
      withWx.sort((a, b) => {
        const ca = flightCatSort(a.wx), cb = flightCatSort(b.wx)
        return catOrder[ca] !== catOrder[cb] ? catOrder[ca] - catOrder[cb] : a.dist - b.dist
      })
      setSugg(withWx.slice(0, 5))
    } catch { /* ignore */ } finally { setLoad(false) }
  }

  useEffect(() => {
    if (!open) return
    get('settings', 'cruise').then(c => { if (c?.burnRate) setBurnRate(parseFloat(c.burnRate) || 10) })
    get('settings', 'route').then(r => {
      if (!r) return
      const d = (r.dep  || '').toUpperCase()
      const x = (r.dest || '').toUpperCase()
      setDepIcao(d); setDestIcao(x)
      if (r.depPos)  setDepPos(r.depPos)
      if (r.destPos) setDestPos(r.destPos)
      fetchSuggestions(r.depPos,  d, setToSuggestions, setToSuggestLoad)
      fetchSuggestions(r.destPos, x, setLdSuggestions, setLdSuggestLoad)
    }).catch(() => {})
    get('settings', 'alternates').then(a => {
      if (a?.toAlts) setToAlts(a.toAlts)
      if (a?.ldAlts) setLdAlts(a.ldAlts)
    }).catch(() => {})
  }, [open])

  // Persist chosen alternates so the Flight Plan one-pager can read them —
  // this list was previously local-only and vanished when the card closed.
  const altsRestored = useRef(false)
  useEffect(() => {
    if (!open) return
    if (!altsRestored.current) { altsRestored.current = true; return }
    put('settings', { key: 'alternates', toAlts, ldAlts }).catch(() => {})
  }, [toAlts, ldAlts, open])

  async function addAlt(icao, refPos, refIcao, setAlts, setQuery, setShowList, setLoading, setError) {
    setQuery(''); setShowList(false); setLoading(true); setError(null)
    try {
      const [apt, metarRaw] = await Promise.allSettled([
        lookupAirport(icao),
        fetch(awcUrl('metar', { ids: icao, format: 'raw', hours: '3' })).then(r => r.text()),
      ])
      if (apt.status !== 'fulfilled') throw new Error('Airport not found')
      const airport = apt.value
      const raw = metarRaw.status === 'fulfilled' ? (metarRaw.value || '').trim() : ''
      const wx = raw.length > 8 ? parseMetar(raw) : null
      let distNm = null, bearing = null
      const aLat = parseFloat(airport.lat), aLon = parseFloat(airport.lon)
      if (refPos && !isNaN(aLat) && !isNaN(aLon)) {
        distNm  = Math.round(haversineNm(refPos[0], refPos[1], aLat, aLon))
        bearing = Math.round(bearingDeg(refPos[0], refPos[1], aLat, aLon))
      }
      setAlts(prev => [...prev, { ...airport, raw, wx, distNm, bearing, refIcao }])
    } catch (e) {
      setError(e.message || 'Airport not found')
    } finally { setLoading(false) }
  }

  const fuelToAlt = (distNm) => {
    if (!distNm) return null
    return ((distNm / 120) * burnRate).toFixed(1)
  }

  function flightCat(wx) {
    if (!wx) return null
    const vis = parseFloat(wx.vis)
    const ceilMatch = (wx.clouds || '').match(/BKN(\d{3})|OVC(\d{3})/)
    const ceil = ceilMatch ? parseInt(ceilMatch[1] || ceilMatch[2]) * 100 : Infinity
    if ((!isNaN(vis) && vis < 1) || ceil < 500)  return { cat: 'LIFR' }
    if ((!isNaN(vis) && vis < 3) || ceil < 1000) return { cat: 'IFR' }
    if ((!isNaN(vis) && vis < 5) || ceil < 3000) return { cat: 'MVFR' }
    return { cat: 'VFR' }
  }
  function flightCatSort(wx) { const c = flightCat(wx); return c ? c.cat : null }

  function AltCard({ title, refIcao, refPos, alts, setAlts, query, setQuery, showList, setShowList,
    loading, setLoading, error, setError, suggestions, suggestLoad }) {

    const altMinLink = altMinUrl(refIcao)
    const matches = query.length >= 1
      ? FAA_AIRPORTS.filter(a =>
          a.icao.startsWith(query.toUpperCase()) ||
          a.name.toLowerCase().includes(query.toLowerCase()) ||
          a.city.toLowerCase().includes(query.toLowerCase())
        ).filter(a => !alts.find(x => x.icaoId === a.icao)).slice(0, 6)
      : []

    return (
      <div style={{ margin: '10px 14px 0', borderRadius: 12, border: '0.5px solid var(--border)',
        background: 'var(--bg-card-2)', overflow: 'visible' }}>
        {/* Card header */}
        <div style={{ padding: '10px 12px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</span>
          {refIcao && <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
            color: 'var(--text-secondary)' }}>{refIcao}</span>}
        </div>

        {/* Search */}
        <div style={{ padding: '8px 10px 6px', position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setShowList(true); setError(null) }}
              onFocus={() => setShowList(true)}
              onBlur={() => setTimeout(() => setShowList(false), 150)}
              placeholder="Search by ICAO, name or city…"
              style={{
                width: '100%', background: 'var(--bg)', border: '0.5px solid var(--border)',
                borderRadius: showList && matches.length ? '8px 8px 0 0' : 8,
                padding: '9px 11px', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }}
            />
            {loading && <div style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)',
              fontSize: 12, color: 'var(--text-tertiary)' }}>…</div>}
          </div>
          {showList && matches.length > 0 && (
            <div style={{ position: 'absolute', left: 10, right: 10, zIndex: 20,
              background: 'var(--bg-card-2)', border: '0.5px solid var(--border)', borderTop: 'none',
              borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
              {matches.map((a, i) => (
                <button key={a.icao} onMouseDown={() => addAlt(a.icao, refPos, refIcao, setAlts, setQuery, setShowList, setLoading, setError)}
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none',
                    borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                    padding: '8px 11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace', minWidth: 40 }}>{a.icao}</span>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)' }}>{a.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{a.city}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
        </div>

        {/* Suggestions */}
        {(suggestLoad || suggestions.length > 0) && (
          <div style={{ padding: '0 10px 6px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
              color: 'var(--text-tertiary)', marginBottom: 6 }}>Nearest with IAP · auto-detected</div>
            {suggestLoad ? (
              <div style={{ display: 'flex', gap: 6 }}>{[1,2,3].map(i => <Bone key={i} w={80} h={44} r={7} />)}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {suggestions.filter(s => !alts.find(a => a.icaoId === s.icao)).map(s => {
                  const cat = flightCat(s.wx)
                  return (
                    <button key={s.icao} onClick={() => addAlt(s.icao, refPos, refIcao, setAlts, setQuery, setShowList, setLoading, setError)}
                      style={{ width: '100%', textAlign: 'left', cursor: 'pointer',
                        background: 'var(--bg)', border: '0.5px solid var(--border)',
                        borderRadius: 8, padding: '7px 10px',
                        display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: 'var(--border-strong)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{s.icao}</span>
                          {cat && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)' }}>{cat.cat}</span>}
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{s.dist} NM</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                          {s.name}{s.state ? `, ${s.state}` : ''}{s.wx?.wind ? ` · ${s.wx.wind}` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: 16, color: 'var(--text-tertiary)', flexShrink: 0 }}>+</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Loaded alternates */}
        {alts.length > 0 && (
          <div style={{ borderTop: '0.5px solid var(--border)' }}>
            {alts.map((alt, i) => {
              const cat = flightCat(alt.wx)
              const fuel = fuelToAlt(alt.distNm)
              return (
                <div key={alt.icaoId} style={{ borderTop: i > 0 ? '0.5px solid var(--border)' : 'none', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 7 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>{alt.icaoId}</span>
                        {cat && <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-secondary)',
                          background: 'var(--accent-light)', borderRadius: 4, padding: '2px 5px',
                          border: '0.5px solid var(--border)' }}>{cat.cat}</span>}
                        {!alt.wx && <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>no WX</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {alt.name}{alt.state ? `, ${alt.state}` : ''}
                      </div>
                    </div>
                    <button onClick={() => setAlts(prev => prev.filter(a => a.icaoId !== alt.icaoId))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 13, color: 'var(--text-tertiary)', padding: '0 0 0 8px', lineHeight: 1 }}>✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: alt.wx ? 8 : 0 }}>
                    {alt.distNm != null && (
                      <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 7, padding: '6px 9px' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{alt.distNm} <span style={{ fontSize: 10, fontWeight: 500 }}>NM</span></div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.4px' }}>from {alt.refIcao || refIcao} · {alt.bearing}°</div>
                      </div>
                    )}
                    {fuel != null && (
                      <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 7, padding: '6px 9px' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{fuel} <span style={{ fontSize: 10, fontWeight: 500 }}>gal</span></div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.4px' }}>est. fuel @ {burnRate} GPH</div>
                      </div>
                    )}
                    {alt.elev && (
                      <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 7, padding: '6px 9px' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>{alt.elev}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.4px' }}>elevation</div>
                      </div>
                    )}
                  </div>
                  {alt.wx && (() => {
                    const w = alt.wx
                    return (
                      <div style={{ background: 'var(--bg)', borderRadius: 7, padding: '7px 9px', display: 'flex', flexWrap: 'wrap', gap: '3px 12px' }}>
                        {w.wind && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>WND</span>{w.wind}</div>}
                        {w.vis  && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>VIS</span>{w.vis}</div>}
                        {w.clouds && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>SKY</span>{w.clouds}</div>}
                        {w.temp && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>TMP</span>{w.temp}</div>}
                        {w.qnh  && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>ALT</span>{w.qnh}</div>}
                        {w.wx   && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}><span style={{ opacity: 0.5, marginRight: 3 }}>WX</span>{w.wx}</div>}
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        )}

        {/* Alternate Minimums link */}
        {altMinLink && (
          <a href={altMinLink} target="_blank" rel="noreferrer" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            margin: '6px 10px 10px', background: 'var(--bg)', border: '0.5px solid var(--border)',
            borderRadius: 8, padding: '8px 10px', textDecoration: 'none',
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>Alternate Minimums</div>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1 }}>{refIcao} · FAA Official · PDF</div>
            </div>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </a>
        )}
        {!altMinLink && <div style={{ height: 10 }} />}
      </div>
    )
  }

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      {/* No route set — prompt */}
      {!depPos && !destPos && !toSuggestLoad && !ldSuggestLoad && (
        <div style={{ padding: '16px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Set your route first</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              Enter departure and destination in Route &amp; Altitude — nearby alternates will auto-suggest here.
            </div>
          </div>
        </div>
      )}

      <AltCard
        title="Takeoff Alternate"
        refIcao={depIcao} refPos={depPos}
        alts={toAlts} setAlts={setToAlts}
        query={toQuery} setQuery={setToQuery}
        showList={toShowList} setShowList={setToShowList}
        loading={toLoading} setLoading={setToLoading}
        error={toError} setError={setToError}
        suggestions={toSuggestions} suggestLoad={toSuggestLoad}
      />

      <AltCard
        title="Landing Alternate"
        refIcao={destIcao} refPos={destPos}
        alts={ldAlts} setAlts={setLdAlts}
        query={ldQuery} setQuery={setLdQuery}
        showList={ldShowList} setShowList={setLdShowList}
        loading={ldLoading} setLoading={setLdLoading}
        error={ldError} setError={setLdError}
        suggestions={ldSuggestions} suggestLoad={ldSuggestLoad}
      />

      {/* IFR 1-2-3 rule */}
      <div style={{ margin: '10px 14px 12px', background: 'var(--accent-light)', borderRadius: 8,
        padding: '8px 10px', border: '0.5px solid rgba(0,122,255,0.2)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.5px', marginBottom: 3 }}>IFR 1-2-3 RULE</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Alternate required if, from 1 hr before to 1 hr after ETA, forecast ceiling &lt; 2,000 ft or visibility &lt; 3 SM at destination.
        </div>
      </div>

      <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── METAR expandable item ───────────────────────────────────── */
export function MetarItem({ item, isChecked, onToggle }) {
  const [open, setOpen]         = useState(false)
  const [dep, setDep]           = useState('')
  const [dest, setDest]         = useState('')
  const [depData, setDepData]   = useState(null)
  const [destData, setDestData] = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const FIELDS = [
    ['Wind', 'wind'], ['Variable', 'windVar'], ['Visibility', 'vis'],
    ['Weather', 'wx'], ['Clouds', 'clouds'], ['Temp', 'temp'],
    ['Dew point', 'dew'], ['QNH', 'qnh'], ['Trend', 'trend'],
  ]

  const fetchMetar = async icao => {
    if (!icao) return null
    try {
      const data = await proxyJSON(awcUrl('metar', { ids: icao, format: 'json', hours: '3' }))
      const raw  = Array.isArray(data) && data.length ? data[0].rawOb || data[0].rawob || '' : ''
      return raw ? { raw, decoded: parseMetar(raw) } : null
    } catch { return null }
  }

  async function doFetch(d, x) {
    if (!d && !x) return
    setLoading(true); setError(null)
    const [dRes, xRes] = await Promise.all([fetchMetar(d), fetchMetar(x)])
    setDepData(dRes); setDestData(xRes)
    if (!dRes && !xRes) setError('METAR unavailable — check aviationweather.gov')
    setLoading(false)
  }

  // Fetch when card opens — always reads current saved route
  useEffect(() => {
    if (!open) return
    get('settings', 'route').then(r => {
      const d = (r?.dep  || '').toUpperCase().trim()
      const x = (r?.dest || '').toUpperCase().trim()
      setDep(d); setDest(x)
      doFetch(d, x)
    })
  }, [open])

  const MetarCard = ({ label, icao, data, isLoading }) => (
    <div style={{
      margin: '10px 12px 0',
      background: 'var(--bg-card-2)',
      border: '0.5px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '0.5px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px',
            textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{label}</span>
          {icao && <span style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace',
            color: 'var(--text)', letterSpacing: '1px' }}>{icao}</span>}
        </div>
        {data?.decoded?.time && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)',
            background: 'var(--bg)', border: '0.5px solid var(--border)',
            borderRadius: 20, padding: '2px 8px' }}>{data.decoded.time}</span>
        )}
        {isLoading && !data && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Fetching…</span>
        )}
      </div>

      {/* Raw string */}
      {data?.raw && (
        <div style={{ padding: '8px 12px 4px' }}>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)',
            background: 'var(--bg)', borderRadius: 8, padding: '8px 10px',
            lineHeight: 1.5, letterSpacing: '0.2px', wordBreak: 'break-all' }}>
            {data.raw}
          </div>
        </div>
      )}

      {/* Decoded fields */}
      {data?.decoded && (
        <div style={{ padding: '4px 12px 10px' }}>
          {FIELDS.filter(([, key]) => data.decoded[key]).map(([lbl, key], i, arr) => (
            <div key={key} style={{
              display: 'flex', alignItems: 'baseline', gap: 10, padding: '6px 0',
              borderBottom: i < arr.length - 1 ? '0.5px solid var(--border)' : 'none',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', width: 68, flexShrink: 0 }}>{lbl}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1, lineHeight: 1.4 }}>
                {data.decoded[key]}
              </span>
            </div>
          ))}
        </div>
      )}

      {!data && !isLoading && icao && (
        <div style={{ padding: '10px 12px 12px', fontSize: 11, color: 'var(--text-tertiary)' }}>
          No METAR available for {icao}
        </div>
      )}
    </div>
  )

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      {/* No route set */}
      {!dep && !dest && !loading && (
        <div style={{ padding: '14px 14px 12px', borderTop: '0.5px solid var(--border)',
          fontSize: 11, color: 'var(--text-tertiary)' }}>
          Set a departure and destination in Route and Altitude to auto-load METARs.
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ padding: '10px 14px', borderTop: '0.5px solid var(--border)',
          fontSize: 11, color: 'var(--danger)' }}>{error}</div>
      )}

      {/* Departure METAR */}
      {(dep || depData) && (
        <MetarCard label="Departure" icao={dep} data={depData} isLoading={loading} />
      )}

      {/* Destination METAR */}
      {(dest || destData) && (
        <MetarCard label="Destination" icao={dest} data={destData} isLoading={loading} />
      )}

      {/* Reference links */}
      <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 14px 10px', marginTop: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="https://aviationweather.gov" target="_blank" rel="noreferrer" style={{
            flex: 1, textAlign: 'center', padding: '8px 0',
            borderRadius: 9, border: '0.5px solid var(--border)',
            background: 'var(--bg-card-2)', textDecoration: 'none',
            fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
          }}>aviationweather.gov</a>
          <button onClick={() => { setDepData(null); setDestData(null); doFetch(dep, dest) }} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '8px 0',
            borderRadius: 9, border: '0.5px solid var(--border)',
            background: 'var(--bg-card-2)',
            cursor: 'pointer',
          }}>
            <IconRefresh size={14} onDark={false} />
          </button>
        </div>
      </div>

      <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}
