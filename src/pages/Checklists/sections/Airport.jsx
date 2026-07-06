import { useState, useEffect } from 'react'
import FAA_CHARTS_DATA from '../../../data/faa_charts.json'
import { get } from '../../../lib/db'
import { ExpandableCard, DoneButton, CheckRow as SharedCheckRow } from '../shared/ui'
import { FAA_DTPP_BASE } from '../shared/faaData'
import { awcUrl, proxyJSON, lookupAirport } from '../shared/awc'

/* ── NOTAM / TFR panel ───────────────────────────────────────── */
export function NotamItem({ item, isChecked, onToggle }) {
  const [open, setOpen] = useState(false)
  const NOTAM_LINKS = [
    { label: 'FAA NOTAM Search', sub: 'Official FAA NOTAM system', url: 'https://notams.aim.faa.gov/notamSearch/' },
    { label: 'FAA TFR Map', sub: 'Active TFRs plotted on a map', url: 'https://tfr.faa.gov/tfr2/list.html' },
    { label: '1800wxbrief.com', sub: 'Leidos flight service — full preflight briefing', url: 'https://www.1800wxbrief.com' },
    { label: 'SkyVector', sub: 'NOTAMs and TFRs overlaid on chart', url: 'https://skyvector.com' },
  ]
  const TFR_TYPES = [
    { label: 'VIP / POTUS movement', color: '#FF3B30' },
    { label: 'Wildfire / disaster area', color: '#FF9500' },
    { label: 'Air show / sporting event', color: '#5856D6' },
    { label: 'Security / military exercise', color: '#FF3B30' },
    { label: 'Space launch operations', color: '#AF52DE' },
  ]

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>
          {/* TFR types reminder */}
          <div style={{ padding: '14px 14px 10px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              Common TFR Types
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {TFR_TYPES.map((t, i) => (
                <div key={t.label} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0',
                  borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>
          {/* NOTAM links */}
          <div style={{ borderTop: '0.5px solid var(--border)', padding: '14px 14px 4px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              Check NOTAMs
            </div>
            {NOTAM_LINKS.map((nl, i) => (
              <a key={nl.url} href={nl.url} target="_blank" rel="noreferrer" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0', borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                textDecoration: 'none',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{nl.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{nl.sub}</div>
                </div>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </a>
            ))}
          </div>
          <div style={{ borderTop: '0.5px solid var(--border)', padding: '10px 14px 10px', marginTop: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>NOTAMs change daily — always check on the day of flight.</div>
          </div>
          <DoneButton isChecked={isChecked} onDone={() => { onToggle(item.id); setOpen(false) }} />
    </ExpandableCard>
  )
}

/* ── NOTAM helpers ───────────────────────────────────────────── */
function notamCategory(text) {
  if (!text) return 'OTHER'
  const t = text.toUpperCase()
  if (/\bRWY\b|\bRUNWAY\b/.test(t))              return 'RWY'
  if (/\bTWY\b|\bTAXIWAY\b/.test(t))             return 'TWY'
  if (/\bNAV\b|ILS|VOR|NDB|ATIS|AWOS/.test(t))   return 'NAV'
  if (/\bOBST\b|\bCRANE\b|\bTOWER\b/.test(t))    return 'OBST'
  if (/\bAPCH\b|\bIAP\b|APPROACH/.test(t))        return 'APCH'
  if (/\bAD\b|AIRPORT\b|APRON/.test(t))           return 'AD'
  if (/\bTFR\b/.test(t))                          return 'TFR'
  return 'OTHER'
}

const NOTAM_CAT_COLOR = {
  RWY: '#FF9500', TWY: '#FF9500', NAV: 'var(--accent)',
  OBST: 'var(--danger)', APCH: 'var(--accent)', AD: 'var(--text-secondary)',
  TFR: 'var(--danger)', OTHER: 'var(--text-tertiary)',
}

export function NotamSection({ icao, CheckRow }) {
  const [workerUrl, setWorkerUrl]     = useState(() => localStorage.getItem('notam_worker_url') || '')
  const [showSetup, setShowSetup]     = useState(false)
  const [urlInput, setUrlInput]       = useState('')
  const [notams, setNotams]           = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)

  useEffect(() => {
    if (!workerUrl || !icao || icao === 'XXXX') return
    setLoading(true)
    setError(null)
    fetch(`${workerUrl.replace(/\/$/, '')}?icao=${icao}`)
      .then(r => r.json())
      .then(data => { setNotams(data?.items || []); setLoading(false) })
      .catch(() => { setError('Could not reach the NOTAM worker — check the URL'); setLoading(false) })
  }, [workerUrl, icao])

  const saveUrl = () => {
    const trimmed = urlInput.trim()
    localStorage.setItem('notam_worker_url', trimmed)
    setWorkerUrl(trimmed)
    setShowSetup(false)
    setNotams(null)
  }

  // No worker configured
  if (!workerUrl && !showSetup) return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, lineHeight: 1.6 }}>
        Deploy the free NOTAM worker once to load live NOTAMs inline.
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.6 }}>
        The worker file is at <strong style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>notam-worker/worker.js</strong> in your project.
        Deploy it to Cloudflare Workers (free), add your FAA API credentials as env vars, then paste the Worker URL below.
      </div>
      <button onClick={() => { setShowSetup(true); setUrlInput(workerUrl) }}
        style={{ background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 8,
          padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
        Enter Worker URL
      </button>
      <CheckRow id="apt-notam" label="NOTAMs checked" />
    </div>
  )

  // URL input form
  if (showSetup) return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Cloudflare Worker URL</div>
      <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
        placeholder="https://pqrh-notam.yourname.workers.dev"
        style={{ background: 'var(--bg-card-2)', border: '0.5px solid var(--border)', borderRadius: 7,
          padding: '8px 10px', fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'monospace' }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={saveUrl} disabled={!urlInput.trim()}
          style={{ flex: 1, background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 7,
            padding: '8px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            opacity: !urlInput.trim() ? 0.4 : 1 }}>
          Save
        </button>
        <button onClick={() => setShowSetup(false)}
          style={{ background: 'var(--bg-card-2)', color: 'var(--text-tertiary)', border: 'none',
            borderRadius: 7, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <>
      {loading && (
        <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--text-tertiary)' }}>Loading NOTAMs…</div>
      )}
      {error && !loading && (
        <div style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--danger)', marginBottom: 6 }}>{error}</div>
          <button onClick={() => { setShowSetup(true); setUrlInput(workerUrl) }}
            style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            Update Worker URL
          </button>
        </div>
      )}
      {!loading && notams && (
        <>
          <div style={{ padding: '8px 14px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              {notams.length} active NOTAM{notams.length !== 1 ? 's' : ''} for {icao}
            </span>
            <button onClick={() => { setShowSetup(true); setUrlInput(workerUrl) }}
              style={{ fontSize: 10, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Update
            </button>
          </div>
          {notams.length === 0 && (
            <div style={{ padding: '4px 14px 12px', fontSize: 12, color: 'var(--text-tertiary)' }}>No active NOTAMs.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px 10px' }}>
            {notams.map((n, i) => {
              const raw   = n.text || n.icaoMessage || n.traditionalMessage || ''
              const cat   = notamCategory(raw)
              const color = NOTAM_CAT_COLOR[cat] || 'var(--text-tertiary)'
              const eff   = n.startDate ? new Date(n.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + 'Z' : ''
              const exp   = n.endDate   ? new Date(n.endDate).toLocaleDateString('en-US',   { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + 'Z' : 'PERM'
              return (
                <div key={n.id ?? i} style={{ background: 'var(--bg-card-2)', borderRadius: 8, padding: '9px 11px', marginBottom: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.5px', color,
                      background: 'var(--bg)', borderRadius: 4, padding: '2px 6px',
                      border: `0.5px solid ${color}`, flexShrink: 0 }}>{cat}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                      {eff}{exp !== 'PERM' ? ` → ${exp}` : ' → PERM'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)',
                    lineHeight: 1.55, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{raw}</div>
                </div>
              )
            })}
          </div>
        </>
      )}
      <CheckRow id="apt-notam" label="NOTAMs checked" />
    </>
  )
}

/* ── Airport checklist ───────────────────────────────────────── */

export function AirportItem({ item, isChecked, onToggle }) {
  const [open, setOpen]             = useState(false)
  const [aptData, setAptData]       = useState(null)
  const [aptLoading, setAptLoading] = useState(false)
  const [aptError, setAptError]     = useState(null)
  const [freqOpen, setFreqOpen]     = useState(false)
  const [mapsOpen, setMapsOpen]     = useState(false)
  const [fboFreq, setFboFreq]       = useState(() => localStorage.getItem('apt_fbo_freq') || '')
  const [fboNote, setFboNote]       = useState(() => localStorage.getItem('apt_fbo_note') || '')
  const [checkedIds, setCheckedIds] = useState(new Set())
  const [destIcao, setDestIcao]     = useState('')


  const toggleSub = id => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const [landingRwy, setLandingRwy] = useState(null)
  const [aptWind, setAptWind]       = useState(null) // { dir, spd }

  useEffect(() => {
    Promise.all([
      get('settings', 'route'),
      get('settings', 'perfdist'),
    ]).then(([r, pd]) => {
      if (r?.dest) setDestIcao(r.dest.toUpperCase())
      if (pd?.arr?.selRwy) setLandingRwy(pd.arr.selRwy)
    })
  }, [open])

  useEffect(() => {
    if (!open || !destIcao) return
    proxyJSON(awcUrl('metar', { ids: destIcao, format: 'json', hours: '3' }))
      .then(data => {
        const m = Array.isArray(data) ? data[0] : null
        if (m?.wdir != null && m?.wspd != null) setAptWind({ dir: m.wdir, spd: m.wspd })
      })
      .catch(() => {})
  }, [open, destIcao])

  useEffect(() => {
    if (!open || !destIcao) return
    setAptLoading(true)
    setAptError(null)
    lookupAirport(destIcao)
      .then(d => { setAptData(d); setAptLoading(false) })
      .catch(() => { setAptError('Airport data unavailable'); setAptLoading(false) })
  }, [open, destIcao])


  const icao = destIcao || 'XXXX'

  const ExternalIcon = () => (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )

  const TOOLTIPS = {
    'apt-cfs':    'Review the Chart Supplement (A/FD) for hours of operation, fuel availability, special procedures, and any remarks specific to this airport.',
    'apt-vtpc':   'Check the airport diagram for runway layout, taxiways, and hot spots. Confirm ATIS is received and current altimeter/active runway are noted.',
    'apt-hours':  'Verify the airport and any required services (tower, FBO, customs) are open for your planned arrival time.',
    'apt-taxi':   'Study the taxi chart before landing. Know your route from the runway to parking before you touch down.',
    'apt-taxi-a': 'Identify all runway incursion hot spots marked on the airport diagram. These are areas with a history of confusion or incidents.',
    'apt-taxi-b': 'Note your planned parking location — FBO ramp, transient parking, helipad, or customs ramp — so you taxi with purpose.',
    'apt-light':  'Confirm runway, taxiway, and ramp lighting is available and operational if arriving at night or in low visibility.',
    'apt-sat':    'Use the satellite view to familiarize yourself with the airport environment, surroundings, and any construction or obstacles not shown on charts.',
    'apt-notam':  'Check all active NOTAMs for this airport — runway closures, NAVAID outages, TFRs, and construction that may affect your arrival.',
    'apt-svc-a':  'Confirm fuel type and availability, oil if needed, parking arrangements, and any amenities required for crew or passengers.',
    'apt-caution':'Review any airport-specific cautions — noise abatement, bird activity, terrain, noise-sensitive areas, or special local procedures.',
    'apt-fbo':    'Contact the FBO in advance to confirm parking, ground handling, and any special arrival requirements.',
    'apt-fbo-a':  'Note the FBO ground frequency so you can call them on the radio during taxi-in for marshallers or parking guidance.',
  }

  const CheckRow = ({ id, label }) => (
    <SharedCheckRow id={id} label={label} checked={checkedIds.has(id)} onToggle={toggleSub} tooltip={TOOLTIPS[id]} />
  )

  const SectionCard = ({ title, children }) => (
    <div style={{ borderTop: '0.5px solid var(--border)' }}>
      <div style={{ padding: '11px 14px 0' }}>
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
          letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 2 }}>{title}</div>
      </div>
      {children}
    </div>
  )

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      {/* ── Airport info ── */}
      <div style={{ padding: '14px 14px 0' }}>
        {aptLoading && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', paddingBottom: 12 }}>Loading airport data...</div>
        )}
        {aptError && (
          <div style={{ fontSize: 11, color: 'var(--danger)', paddingBottom: 12 }}>{aptError}</div>
        )}
        {!aptLoading && !aptData && !aptError && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', paddingBottom: 12 }}>
            {destIcao ? `Looking up ${destIcao}...` : 'Set a destination in the Route card to load airport data.'}
          </div>
        )}
        {aptData && (() => {
          const FREQ_GROUPS = [
            { key: 'ATIS',      label: 'ATIS',      match: t => /atis|asos|awos|d-atis/i.test(t) },
            { key: 'ARRIVAL',   label: 'Arrival',   match: t => /approach|arrival|apch/i.test(t) },
            { key: 'TOWER',     label: 'Tower',     match: t => /tower|twr/i.test(t) },
            { key: 'GROUND',    label: 'Ground',    match: t => /ground|gnd/i.test(t) },
            { key: 'CLEARANCE', label: 'Clnc Del',  match: t => /clearance|clnc|delivery/i.test(t) },
            { key: 'DEPARTURE', label: 'Departure', match: t => /departure|dep(?!loyed)/i.test(t) },
            { key: 'UNICOM',    label: 'Unicom',    match: t => /unicom|ctaf/i.test(t) },
          ]
          const grouped = {}
          const used = new Set()
          FREQ_GROUPS.forEach(g => {
            const matches = (aptData.frequencies || []).filter(f => g.match(f.type || ''))
            if (matches.length) { grouped[g.key] = matches; matches.forEach(f => used.add(f.freq + f.type)) }
          })
          const others = (aptData.frequencies || []).filter(f => !used.has(f.freq + f.type))

          // Wind component on landing runway
          const lrwy = landingRwy ? (aptData.runways?.find(rw => rw.id === landingRwy.id) || landingRwy) : null
          const hwComp = aptWind && lrwy?.hdg != null
            ? Math.round(aptWind.spd * Math.cos((aptWind.dir - lrwy.hdg) * Math.PI / 180))
            : null

          return (
            <div style={{ marginBottom: 14 }}>
              {/* ── Header row: big ICAO + name + elev ── */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)',
                    letterSpacing: '1px', lineHeight: 1 }}>{aptData.icaoId}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.3 }}>
                    {aptData.name}
                    {aptData.state ? ` · ${aptData.state}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                  {aptData.elev && (
                    <>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)',
                        textTransform: 'uppercase', letterSpacing: '0.5px' }}>Field Elev</div>
                      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                        {aptData.elev.replace(' ft','')}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-tertiary)', marginLeft: 3 }}>ft</span>
                      </div>
                    </>
                  )}
                  {aptData.tower != null && (
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      Tower <strong style={{ color: 'var(--text)' }}>{aptData.tower ? 'Yes' : 'No'}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Runway display ── */}
              {aptData.runways?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)',
                    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                    {lrwy ? 'Landing Runway' : 'Runways'}
                  </div>

                  {lrwy ? (
                    /* Single selected landing runway card */
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                      borderRadius: 10, padding: '10px 14px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace',
                          color: 'var(--text)', letterSpacing: '1px', lineHeight: 1 }}>{lrwy.id}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {lrwy.hdg != null && (
                            <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                              {String(lrwy.hdg).padStart(3, '0')}°
                            </span>
                          )}
                          {lrwy.len && (
                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{lrwy.len}</span>
                          )}
                          {lrwy.sfc && (
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{lrwy.sfc}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        {hwComp != null && (
                          <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace',
                            color: hwComp >= 0 ? 'var(--text)' : 'var(--danger)' }}>
                            {hwComp >= 0 ? '+' : ''}{hwComp}kt {hwComp >= 0 ? 'HW' : 'TW'}
                          </span>
                        )}
                        {aptWind && (
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                            {aptWind.dir}° / {aptWind.spd}kt
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* All runways as pills when no landing runway chosen */
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                      {aptData.runways.map(r => (
                        <div key={r.id} style={{
                          padding: '6px 8px', borderRadius: 7, textAlign: 'center',
                          fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
                          border: '0.5px solid var(--border)', background: 'transparent',
                          color: 'var(--text-secondary)',
                        }}>
                          {r.id}
                          {r.hdg != null && (
                            <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 3, fontWeight: 400 }}>{r.hdg}°</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}


            </div>
          )
        })()}
      </div>

      {/* ── Charts & Diagrams ── */}
      <SectionCard title="">
        {/* 2×2 grid: Airport Diagram, Chart Supplement, Satellite Image, NOTAMs */}
        {(() => {
          const ident = icao.replace(/^K/, '').toUpperCase()
          const apdChart = (FAA_CHARTS_DATA[ident] || []).find(([code]) => code === 'APD')
          const apdUrl = apdChart ? `${FAA_DTPP_BASE}${apdChart[2]}` : null
          const gridBtn = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center',
            gap: 6, padding: '13px 12px', borderRadius: 11,
            background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
            textDecoration: 'none', cursor: 'pointer', width: '100%', textAlign: 'left' }
          return (
            <div style={{ padding: '10px 14px 4px',
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {/* Airport Diagram */}
              <a href={apdUrl || `https://skyvector.com/airport/${icao}`} target="_blank" rel="noreferrer" style={gridBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <path d="M3 9h18M9 21V9"/>
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Airport Diagram</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
                    {apdUrl ? 'FAA Official · PDF' : 'SkyVector'}
                  </div>
                </div>
              </a>
              {/* Chart Supplement */}
              <a href={`https://skyvector.com/airport/${icao}`} target="_blank" rel="noreferrer" style={gridBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Chart Supplement</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>SkyVector</div>
                </div>
              </a>
              {/* Satellite Image */}
              <button onClick={() => setMapsOpen(true)} style={{ ...gridBtn, border: '0.5px solid var(--border)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Satellite Image</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>open in maps</div>
                </div>
              </button>
              {/* NOTAMs */}
              <a href="https://notams.aim.faa.gov/notamSearch/" target="_blank" rel="noreferrer" style={gridBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>NOTAMs</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>FAA Official</div>
                </div>
              </a>
            </div>
          )
        })()}

        {/* iOS-style action sheet (Satellite Image) */}
        {mapsOpen && (
          <>
            <div onClick={() => setMapsOpen(false)} style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
              zIndex: 1000, backdropFilter: 'blur(2px)',
            }} />
            <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1001, padding: '0 12px 20px' }}>
              <div style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ background: 'rgba(30,30,32,0.97)', padding: '12px 16px 6px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginBottom: 6 }}>
                    Open satellite view of {icao}
                  </div>
                </div>
                {[
                  { label: 'Apple Maps',  sub: 'Maps',             url: `https://maps.apple.com/?q=${icao}+airport&t=k` },
                  { label: 'Google Maps', sub: 'maps.google.com',  url: `https://www.google.com/maps/search/?api=1&query=${icao}+airport&maptype=satellite` },
                  { label: 'Waze',        sub: 'waze.com',         url: `https://waze.com/ul?q=${icao}+airport` },
                ].map((opt, i) => (
                  <a key={opt.label} href={opt.url} target="_blank" rel="noreferrer"
                    onClick={() => setMapsOpen(false)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 16px', borderTop: '0.5px solid rgba(255,255,255,0.08)',
                      background: 'rgba(30,30,32,0.97)', textDecoration: 'none',
                    }}>
                    <span style={{ fontSize: 16, color: 'var(--accent)', fontWeight: 500 }}>{opt.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{opt.sub}</span>
                  </a>
                ))}
              </div>
              <button onClick={() => setMapsOpen(false)} style={{
                width: '100%', padding: '16px', borderRadius: 14,
                background: 'rgba(30,30,32,0.97)', border: 'none', cursor: 'pointer',
                fontSize: 16, fontWeight: 700, color: 'var(--accent)',
              }}>Cancel</button>
            </div>
          </>
        )}

        {/* Frequencies — card button that drops down the list */}
        {aptData?.frequencies?.length > 0 && (
          <div style={{ padding: '4px 14px 4px' }}>
            <div style={{
              borderRadius: 11, background: 'var(--bg-card-2)', border: '0.5px solid var(--border)', overflow: 'hidden',
            }}>
              <button onClick={() => setFreqOpen(o => !o)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '13px 16px', background: 'none', border: 'none',
                cursor: 'pointer', gap: 10, textAlign: 'left',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.86a16 16 0 0 0 6.06 6.06l.96-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                  </svg>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Frequencies</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
                      {icao} · {aptData.frequencies.length} frequencies
                    </div>
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: freqOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {freqOpen && (
                <div style={{ borderTop: '0.5px solid var(--border)' }}>
                  {aptData.frequencies.map((f, i) => (
                    <div key={f.freq + f.type + i} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '9px 16px',
                      borderTop: i > 0 ? '0.5px solid var(--border)' : 'none',
                    }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{f.type}</span>
                      <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)' }}>{f.freq}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ padding: '10px 14px 4px' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.2px' }}>Checklist</span>
        </div>

        {/* Charts & Diagrams group */}
        <div style={{ padding: '6px 14px 0' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Charts &amp; Diagrams</span>
        </div>
        <div style={{ margin: '4px 14px 0', borderRadius: 11, border: '0.5px solid var(--border)' }}>
          <CheckRow id="apt-cfs"   label="Chart Supplement reviewed" />
          <CheckRow id="apt-vtpc"  label="Airport Diagram / ATIS checked" />
          <CheckRow id="apt-hours" label="Hours of Operation confirmed" />
          <CheckRow id="apt-notam" label="NOTAMs checked" />
        </div>

        {/* Ground Familiarization group */}
        <div style={{ padding: '10px 14px 0' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Ground Familiarization</span>
        </div>
        <div style={{ margin: '4px 14px 0', borderRadius: 11, border: '0.5px solid var(--border)' }}>
          <CheckRow id="apt-taxi"   label="Taxi Chart reviewed" />
          <CheckRow id="apt-taxi-a" label="Hotspots identified" />
          <CheckRow id="apt-taxi-b" label="Planned parking noted (FBO / Helipads / Ramps)" />
          <CheckRow id="apt-light"  label="Lighting available confirmed" />
          <CheckRow id="apt-sat"    label="Satellite image familiarization done" />
        </div>

        {/* Services & Ops group */}
        <div style={{ padding: '10px 14px 0' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Services &amp; Ops</span>
        </div>
        <div style={{ margin: '4px 14px 0', borderRadius: 11, border: '0.5px solid var(--border)' }}>
          <CheckRow id="apt-svc-a"   label="Fuel / oil / parking / amenities confirmed" />
          <CheckRow id="apt-caution" label="Airport cautions reviewed" />
        </div>

        {/* FBO / Arrival group */}
        <div style={{ padding: '10px 14px 0' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>FBO / Arrival</span>
        </div>
        <div style={{ margin: '4px 14px 12px', borderRadius: 11, border: '0.5px solid var(--border)' }}>
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '0.5px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>FBO Frequency</div>
              <input
                defaultValue={fboFreq}
                onChange={e => localStorage.setItem('apt_fbo_freq', e.target.value)}
                placeholder="e.g. 122.95"
                style={{
                  width: '100%', background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                  borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--text)',
                  fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>Special Remarks / Procedures</div>
              <textarea
                defaultValue={fboNote}
                onChange={e => localStorage.setItem('apt_fbo_note', e.target.value)}
                placeholder="Parking instructions, contact info, special procedures..."
                rows={3}
                style={{
                  width: '100%', background: 'var(--bg-card-2)', border: '0.5px solid var(--border)',
                  borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--text)',
                  resize: 'none', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
          <CheckRow id="apt-fbo"   label="FBO / Airport informed of arrival and intention" />
          <CheckRow id="apt-fbo-a" label="FBO frequency noted" />
        </div>
      </SectionCard>

      <div style={{ borderTop: '0.5px solid var(--border)', height: 4 }} />
      <DoneButton
        isChecked={isChecked}
        onDone={() => { if (!isChecked) onToggle(item.id); setOpen(false) }}
        checkedIds={checkedIds}
        subIds={['apt-cfs','apt-vtpc','apt-hours','apt-notam','apt-taxi','apt-taxi-a','apt-taxi-b','apt-light','apt-sat','apt-svc-a','apt-caution','apt-fbo','apt-fbo-a']}
        autoCheck onAutoComplete={() => onToggle(item.id)}
      />
    </ExpandableCard>
  )
}
