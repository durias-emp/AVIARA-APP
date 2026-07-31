import { useState, useEffect, useRef, useCallback } from 'react'
import { get, put } from '../../../lib/db'
import { ExpandableCard, DoneButton } from '../shared/ui'
import { awcUrl, proxyJSON, lookupAirport } from '../shared/awc'
import { fbWindAt, stationPos } from '../../../lib/fbWinds'
import { getWBConfig } from '../../../lib/aircraftWB'
import WBChecklistItem from '../WBChecklistItem'

/* ── Density Altitude calculator ────────────────────────────── */
export function DensityAltItem({ item, isChecked, onToggle }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab]   = useState('dep') // 'dep' | 'dest'

  // Per-tab state: { elev, altSetting, oat, sourceLabel }
  const EMPTY = { elev: '', altSetting: '', oat: '', sourceLabel: '' }
  const [dep,  setDep]  = useState(EMPTY)
  const [dest, setDest] = useState(EMPTY)
  const cur  = tab === 'dep' ? dep  : dest
  const setCur = tab === 'dep' ? setDep : setDest

  const setField = (field, val) => setCur(prev => ({ ...prev, [field]: val }))

  // Persist both tabs to IndexedDB on any change
  useEffect(() => {
    if (!dep.elev && !dep.altSetting && !dep.oat && !dest.elev && !dest.altSetting && !dest.oat) return
    put('settings', { key: 'densityalt', dep, dest }).catch(() => {})
  }, [dep, dest])

  const [loading, setLoading] = useState(false)
  const [noRoute, setNoRoute] = useState(false)
  const [manualIcao, setManual] = useState('')

  const fetchForTab = useCallback(async (icao, tabKey) => {
    if (!icao) return
    try {
      const [apt, metar] = await Promise.allSettled([
        proxyJSON(awcUrl('airport', { ids: icao, format: 'json' })),
        proxyJSON(awcUrl('metar', { ids: icao, format: 'json' })),
      ])
      let autoElev = '', autoAlt = '', autoOat = ''
      if (apt.status === 'fulfilled' && apt.value?.[0]) {
        const e = apt.value[0].elev
        if (e != null) autoElev = String(Math.round(e * 3.28084))
      }
      if (metar.status === 'fulfilled' && metar.value?.[0]) {
        const d = metar.value[0]
        if (d.altim != null) autoAlt = (d.altim * 0.02953).toFixed(2)
        if (d.temp  != null) autoOat  = String(Math.round(d.temp))
        if (!autoElev && d.elev != null) autoElev = String(Math.round(d.elev * 3.28084))
      }
      if (autoElev || autoAlt || autoOat) {
        const update = { elev: autoElev, altSetting: autoAlt, oat: autoOat, sourceLabel: icao.toUpperCase() }
        if (tabKey === 'dep')  setDep(update)
        else                   setDest(update)
      }
    } catch { /* ignore */ }
  }, [])

  // On open: restore saved, then refresh both tabs from live METARs
  useEffect(() => {
    if (!open) return
    get('settings', 'densityalt').then(saved => {
      if (saved?.dep || saved?.dest) {
        if (saved.dep)  setDep(prev => ({ ...EMPTY, ...saved.dep }))
        if (saved.dest) setDest(prev => ({ ...EMPTY, ...saved.dest }))
      }
      get('settings', 'route').then(async r => {
        if (!r?.dep && !r?.dest) { setNoRoute(true); return }
        setNoRoute(false)
        setLoading(true)
        await Promise.allSettled([
          r.dep  ? fetchForTab(r.dep,  'dep')  : Promise.resolve(),
          r.dest ? fetchForTab(r.dest, 'dest') : Promise.resolve(),
        ])
        setLoading(false)
      })
    })
  }, [open])

  // Calculations for current tab
  const elevN = parseFloat(cur.elev)
  const altN  = parseFloat(cur.altSetting)
  const oatN  = parseFloat(cur.oat)
  const valid = !isNaN(elevN) && !isNaN(altN) && !isNaN(oatN)

  // Both tabs need valid data to mark complete
  const depValid  = !isNaN(parseFloat(dep.elev))  && !isNaN(parseFloat(dep.altSetting))  && !isNaN(parseFloat(dep.oat))
  const destValid = !isNaN(parseFloat(dest.elev)) && !isNaN(parseFloat(dest.altSetting)) && !isNaN(parseFloat(dest.oat))
  const bothValid = depValid && destValid

  function tabDaColor(s) {
    const e = parseFloat(s.elev), a = parseFloat(s.altSetting), o = parseFloat(s.oat)
    if (isNaN(e) || isNaN(a) || isNaN(o)) return null
    const pa  = Math.round(e + (29.92 - a) * 1000)
    const isa = 15 - 2 * (e / 1000)
    const da  = Math.round(pa + 120 * (o - isa))
    return da > 8000 ? '#FF3B30' : da > 5000 ? '#FF9500' : da > 2000 ? '#FFD60A' : 'var(--ok)'
  }

  const pressureAlt = valid ? Math.round(elevN + (29.92 - altN) * 1000) : null
  const isaTemp     = valid ? 15 - 2 * (elevN / 1000) : null
  const densityAlt  = valid ? Math.round(pressureAlt + 120 * (oatN - isaTemp)) : null

  const daColor = densityAlt == null ? 'var(--text-tertiary)'
    : densityAlt > 8000 ? '#FF3B30'
    : densityAlt > 5000 ? '#FF9500'
    : densityAlt > 2000 ? '#FFD60A'
    : 'var(--ok)'
  const daLabel = densityAlt == null ? '—'
    : densityAlt > 8000 ? 'HIGH. Significant perf loss'
    : densityAlt > 5000 ? 'ELEVATED. Check POH tables'
    : densityAlt > 2000 ? 'MODERATE. Verify climb gradient'
    : 'NORMAL. Standard conditions'

  const Field = ({ label, value, onChange, unit, placeholder }) => (
    <div style={{ flex: 1, minWidth: 80 }}>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.4px', marginBottom: 4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)', borderRadius: 8, padding: '7px 10px', gap: 4 }}>
        <input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 16, fontWeight: 600,
            color: 'var(--text)', fontFamily: 'monospace', width: 0, minWidth: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>{unit}</span>
      </div>
    </div>
  )

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      {/* ── Tab pill switcher ── */}
      <div style={{ padding: '10px 14px 0' }}>
        <div onClick={() => setTab(t => t === 'dep' ? 'dest' : 'dep')} style={{
          position: 'relative', display: 'flex',
          background: 'var(--bg-card-2)', borderRadius: 10, padding: 3,
          cursor: 'pointer', userSelect: 'none',
        }}>
          <div style={{
            position: 'absolute', top: 3, bottom: 3, width: 'calc(50% - 3px)',
            left: tab === 'dep' ? 3 : 'calc(50%)',
            background: 'var(--accent)', borderRadius: 7,
            transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1)',
            pointerEvents: 'none',
          }} />
          {[['dep', dep], ['dest', dest]].map(([key, state]) => {
            const isActive = tab === key
            const dotColor = tabDaColor(state)
            return (
              <div key={key} style={{
                flex: 1, padding: '5px 10px', zIndex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                color: isActive ? 'var(--accent-fg)' : 'var(--text-secondary)',
              }}>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '1px' }}>
                  {state.sourceLabel || (key === 'dep' ? 'DEP' : 'ARR')}
                </span>
                {dotColor && (
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    background: dotColor, flexShrink: 0,
                  }} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ padding: '0 14px 0' }}>

        {/* ── Airport header ── */}
        <div style={{ paddingTop: 14, paddingBottom: 12, marginBottom: 14 }}>
          {loading ? (
            <div style={{ height: 36, display: 'flex', alignItems: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Fetching METAR…</div>
            </div>
          ) : noRoute ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={manualIcao} onChange={e => setManual(e.target.value.toUpperCase())}
                placeholder={tab === 'dep' ? 'Departure ICAO' : 'Arrival ICAO'} maxLength={6}
                style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 8, padding: '10px 12px', fontSize: 16, fontWeight: 700,
                  color: 'var(--text)', outline: 'none', fontFamily: 'monospace', letterSpacing: '1px' }} />
              <button onClick={async () => { if (manualIcao.length >= 3) { setNoRoute(false); setLoading(true); await fetchForTab(manualIcao, tab); setLoading(false) } }}
                style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--text)', color: 'var(--bg)',
                  border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Fill</button>
            </div>
          ) : (
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.5px',
              fontFamily: 'monospace', lineHeight: 1 }}>
              {cur.sourceLabel || (tab === 'dep' ? 'DEP' : 'ARR')}
            </div>
          )}
        </div>

        {/* ── Input fields ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <Field label="Elevation" value={cur.elev} onChange={v => setField('elev', v)} unit="ft" placeholder="0" />
          <Field label="Altimeter" value={cur.altSetting} onChange={v => setField('altSetting', v)} unit="inHg" placeholder="29.92" />
          <Field label="OAT" value={cur.oat} onChange={v => setField('oat', v)} unit="°C" placeholder="15" />
        </div>

        {/* ── Results ── */}
        {valid && (
          <>
            {/* PA + ISA row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700, letterSpacing: '0.6px',
                  textTransform: 'uppercase', marginBottom: 5 }}>Pressure Alt</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: 'monospace' }}>
                    {pressureAlt.toLocaleString()}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
                </div>
              </div>
              <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700, letterSpacing: '0.6px',
                  textTransform: 'uppercase', marginBottom: 5 }}>ISA Deviation</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                    {oatN - isaTemp >= 0 ? '+' : ''}{(oatN - isaTemp).toFixed(0)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>°C</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  ISA at this elev: {isaTemp.toFixed(0)}°C
                </div>
              </div>
            </div>

            {/* Density altitude hero */}
            <div style={{ background: 'var(--bg-card-2)', borderRadius: 12, padding: '14px 14px 12px',
              marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 6 }}>Density Altitude</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 42, fontWeight: 900, color: 'var(--text)', fontFamily: 'monospace',
                  letterSpacing: '-2px', lineHeight: 1 }}>
                  {densityAlt.toLocaleString()}
                </span>
                <span style={{ fontSize: 16, color: 'var(--text-tertiary)', fontWeight: 500 }}>ft</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.2px' }}>
                {daLabel}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Blocked Done */}
      {!bothValid && !isChecked && (
        <div style={{ padding: '10px 14px 12px' }}>
          <div style={{ width: '100%', padding: '11px 0', borderRadius: 10,
            background: 'var(--bg-card-2)', color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 600,
            textAlign: 'center' }}>
            {!depValid && !destValid ? 'Fill Departure and Arrival to complete'
              : depValid  ? 'Check Arrival tab to complete'
              : 'Check Departure tab to complete'}
          </div>
        </div>
      )}
      {(bothValid || isChecked) && (
        <DoneButton isChecked={isChecked} onDone={() => { if (!isChecked) onToggle(item.id); setOpen(false) }}
          autoCheck onAutoComplete={() => onToggle(item.id)} />
      )}
    </ExpandableCard>
  )
}

/* ── Cardinal direction helper ── */
function toCardinal(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]
}

/* ── Field tooltip: fixed position, escapes any overflow:hidden parent ── */
function FieldTip({ label, tip, children, style: outerStyle }) {
  const [pos, setPos] = useState(null)
  const labelRef = useRef(null)

  const show = (e) => {
    const r = labelRef.current?.getBoundingClientRect()
    if (!r) return
    // Position below the label, clamp to viewport width
    const left = Math.min(r.left, window.innerWidth - 212)
    setPos({ top: r.bottom + 6, left })
  }
  const hide = () => setPos(null)
  const toggle = () => pos ? hide() : show()

  return (
    <div style={{ flex: 1, ...outerStyle }}>
      <div
        ref={labelRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={toggle}
        style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
          letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4,
          cursor: 'default', userSelect: 'none', display: 'inline-block' }}
      >
        {label}
      </div>
      {pos && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
          fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
          background: 'var(--bg-card)', borderRadius: 8, padding: '8px 10px',
          border: '0.5px solid var(--border-strong)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          width: 200, pointerEvents: 'none',
        }}>
          {tip}
        </div>
      )}
      {children}
    </div>
  )
}

/* ── Shared input for PerfDistItem (must be module-level to keep identity stable) ── */
function PerfSmallInput({ label, value, onChange, unit }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
        letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
        borderRadius: 7, padding: '7px 9px', gap: 3 }}>
        <input type="number" value={value} onChange={e => onChange(e.target.value)}
          placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
            fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
            width: 0, minWidth: 0 }} />
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>{unit}</span>
      </div>
    </div>
  )
}

/* ── Takeoff / Landing distance calculator ───────────────────── */
export function PerfDistItem({ item, isChecked, onToggle }) {
  const [open,    setOpen]   = useState(false)
  const [tab,     setTab]    = useState('dep') // 'dep' = Takeoff | 'arr' = Landing
  // Guards the persist effect below from firing with blank initial state
  // before the restore effect (which only runs once the card is opened) has
  // had a chance to load any previously-saved values.
  const perfRestored = useRef(false)

  // ── POH reference ─────────────────────────────────────────────
  const [toGR,    setToGR]   = useState('')    // TO ground roll
  const [toOver,  setToOver] = useState('')    // TO over 50ft
  const [ldgGR,   setLdgGR]  = useState('')    // LDG ground roll
  const [ldgOver, setLdgOver]= useState('')    // LDG over 50ft

  // ── Per-tab conditions (pohBase is per-tab) ───────────────────
  const ECOND = { da: null, icao: '', runways: [], selRwy: null, windDir: '', windSpd: '', surface: 'dry', slope: '0', pohBase: '0', pohWeight: '', actualWeight: '', loading: false }
  const [dep,  setDep]  = useState(ECOND)
  const [arr,  setArr]  = useState(ECOND)
  const cur    = tab === 'dep' ? dep  : arr
  const setCur = tab === 'dep' ? setDep : setArr
  const updCur = patch => setCur(prev => ({ ...prev, ...patch }))

  // ── DA helper ─────────────────────────────────────────────────
  const calcDA = (tabData) => {
    const { elev, altSetting, oat } = tabData || {}
    const e = parseFloat(elev), a = parseFloat(altSetting), o = parseFloat(oat)
    if (isNaN(e) || isNaN(a) || isNaN(o)) return null
    const pa = e + (29.92 - a) * 1000
    return Math.round(pa + 120 * (o - (15 - 2 * (e / 1000))))
  }

  // ── Fetch airport conditions for one tab ─────────────────────
  const fetchTab = useCallback(async (icao, isArr) => {
    const setter = isArr ? setArr : setDep
    setter(prev => ({ ...prev, loading: true }))
    try {
      const [aptRes, metarRes] = await Promise.allSettled([
        proxyJSON(awcUrl('airport', { ids: icao, format: 'json' })),
        proxyJSON(awcUrl('metar', { ids: icao, format: 'json' })),
      ])
      const patch = { icao: icao.toUpperCase(), loading: false }
      // Elevation
      if (aptRes.status === 'fulfilled' && aptRes.value?.[0]) {
        const apt = aptRes.value[0]
        if (apt.elev != null) patch.elevFt = Math.round(apt.elev * 3.28084)
        // Runways
        const rwyList = []
        for (const rwy of (apt.runways || [])) {
          const ids = (rwy.id || '').split('/')
          const align = rwy.alignment
          const grad  = rwy.gradient ?? null // slope % (positive = uphill for first end)
          if (ids[0] && align != null) {
            rwyList.push({ id: ids[0], hdg: align % 360, slope: grad })
            if (ids[1]) rwyList.push({ id: ids[1], hdg: (align + 180) % 360, slope: grad != null ? -grad : null })
          }
        }
        // Auto-fill slope from first runway if available
        if (rwyList.length && rwyList[0].slope != null) patch.slope = String(rwyList[0].slope)
        patch.runways = rwyList
        if (rwyList.length) patch.selRwy = rwyList[0]
      }
      // METAR
      if (metarRes.status === 'fulfilled' && metarRes.value?.[0]) {
        const d = metarRes.value[0]
        if (d.altim != null) patch.altSetting = (d.altim * 0.02953).toFixed(2)
        if (d.temp  != null) patch.oat = String(Math.round(d.temp))
        if (!patch.elevFt && d.elev != null) patch.elevFt = Math.round(d.elev * 3.28084)
        if (d.wdir  != null) patch.windDir = String(d.wdir)
        else if (d.wspd != null && /\bVRB\d/i.test(d.rawOb || '')) patch.windDir = 'VRB'
        if (d.wspd  != null) patch.windSpd = String(d.wspd)
      }
      // DA from fetched data
      patch.da = calcDA({ elev: patch.elevFt, altSetting: patch.altSetting, oat: patch.oat })
      setter(prev => ({ ...prev, ...patch }))
      // Auto-fill baseline altitude from airport elevation (dep tab only)
      if (patch.elevFt != null) (isArr ? setArr : setDep)(prev => ({ ...prev, pohBase: String(patch.elevFt) }))
    } catch {
      setter(prev => ({ ...prev, loading: false }))
    }
  }, [])

  // ── On open: restore + refresh ───────────────────────────────
  useEffect(() => {
    if (!open) return
    const parsePerf = v => v ? String(parseFloat(String(v).replace(/,/g, '')) || '') : ''
    Promise.all([get('settings', 'perfdist'), get('aircraft', 'profile'), get('settings', 'lastWB')]).then(([saved, profile, lastWB]) => {
      if (saved?.dep?.pohBase != null) setDep(prev => ({ ...prev, pohBase: saved.dep.pohBase }))
      if (saved?.arr?.pohBase != null) setArr(prev => ({ ...prev, pohBase: saved.arr.pohBase }))
      if (saved?.toGR     != null) setToGR(saved.toGR)
      if (saved?.toOver   != null) setToOver(saved.toOver)
      if (saved?.ldgGR    != null) setLdgGR(saved.ldgGR)
      if (saved?.ldgOver  != null) setLdgOver(saved.ldgOver)
      if (saved?.dep) setDep(prev => ({ ...prev, ...saved.dep }))
      if (saved?.arr) setArr(prev => ({ ...prev, ...saved.arr }))
      // Auto-fill POH values from aircraft profile when fields are empty
      if (!saved?.toGR    && profile?.perf?.toRoll)  setToGR(parsePerf(profile.perf.toRoll))
      if (!saved?.toOver  && profile?.perf?.to50ft)  setToOver(parsePerf(profile.perf.to50ft))
      if (!saved?.ldgGR   && profile?.perf?.ldgRoll) setLdgGR(parsePerf(profile.perf.ldgRoll))
      if (!saved?.ldgOver && profile?.perf?.ldg50ft) setLdgOver(parsePerf(profile.perf.ldg50ft))
      // Auto-fill the POH chart's baseline weight from the aircraft's max
      // takeoff weight (the weight most POH takeoff/landing charts are
      // built around), and the actual weight from the W&B checklist's
      // computed all-up weight. Both stay editable. The pilot confirms.
      const cfg = profile ? getWBConfig(profile) : null
      if (!saved?.dep?.pohWeight && cfg?.maxTOW) setDep(prev => ({ ...prev, pohWeight: String(cfg.maxTOW) }))
      if (!saved?.arr?.pohWeight && cfg?.maxTOW) setArr(prev => ({ ...prev, pohWeight: String(cfg.maxTOW) }))
      if (!saved?.dep?.actualWeight && lastWB?.weight) setDep(prev => ({ ...prev, actualWeight: String(Math.round(lastWB.weight)) }))
      if (!saved?.arr?.actualWeight && lastWB?.weight) setArr(prev => ({ ...prev, actualWeight: String(Math.round(lastWB.weight)) }))
      perfRestored.current = true
    })
    // Also pull DA from the DA card as a fallback
    get('settings', 'densityalt').then(da => {
      if (da?.dep) { const d = calcDA(da.dep); if (d) setDep(prev => ({ ...prev, da: d })) }
      if (da?.dest){ const d = calcDA(da.dest); if (d) setArr(prev => ({ ...prev, da: d })) }
    })
    get('settings', 'route').then(async r => {
      await Promise.allSettled([
        r?.dep  ? fetchTab(r.dep,  false) : Promise.resolve(),
        r?.dest ? fetchTab(r.dest, true)  : Promise.resolve(),
      ])
    })
  }, [open])

  // ── Persist ───────────────────────────────────────────────────
  useEffect(() => {
    if (!perfRestored.current) return
    put('settings', { key: 'perfdist', toGR, toOver, ldgGR, ldgOver, dep, arr }).catch(() => {})
  }, [toGR, toOver, ldgGR, ldgOver, dep, arr])

  // ── Calculations for current tab ─────────────────────────────
  const baseFt   = parseFloat(cur.pohBase) || 0
  const daFt     = cur.da ?? 0
  const slopePct = parseFloat(cur.slope) || 0
  const wDir     = parseFloat(cur.windDir)
  const wSpd     = parseFloat(cur.windSpd)
  const rwyHdg   = cur.selRwy?.hdg ?? 0
  const hwComp   = (!isNaN(wDir) && !isNaN(wSpd))
    ? Math.round(wSpd * Math.cos((wDir - rwyHdg) * Math.PI / 180)) : 0

  const daFactor   = 1 + Math.max(0, daFt - baseFt) / 1000 * 0.10
  const windFactor = hwComp >= 0
    ? Math.max(0.5, 1 - (hwComp / 9) * 0.10)
    : Math.min(2.5, 1 + (Math.abs(hwComp) / 2) * 0.10)
  const surfFactor    = cur.surface === 'wet' ? 1.20 : 1.00
  const slopeFactorTO = 1 + Math.max(0, slopePct) * 0.07 - Math.max(0, -slopePct) * 0.02
  const slopeFactorLD = 1 + Math.max(0, -slopePct) * 0.05 - Math.max(0, slopePct) * 0.02

  // Weight factor: POH ground-roll/50ft numbers are calibrated at a chart
  // baseline weight (usually max gross); distance scales roughly with the
  // square of the weight ratio (lift/energy relationship), clamped so a
  // missing or clearly-wrong weight entry can't blow up the estimate.
  const pohW    = parseFloat(cur.pohWeight) || 0
  const actualW = parseFloat(cur.actualWeight) || 0
  const weightFactor = (pohW > 0 && actualW > 0)
    ? Math.min(1.5, Math.max(0.5, (actualW / pohW) ** 2))
    : 1

  const combinedTO = daFactor * windFactor * surfFactor * slopeFactorTO * weightFactor
  const combinedLD = daFactor * windFactor * surfFactor * slopeFactorLD * weightFactor

  const calc = (base, f) => base && !isNaN(parseFloat(base)) ? Math.round(parseFloat(base) * f) : null
  const isDepTab = tab === 'dep'
  const toGRc    = calc(toGR,   combinedTO)
  const toOverc  = calc(toOver, combinedTO)
  const ldgGRc   = calc(ldgGR,  combinedLD)
  const ldgOverc = calc(ldgOver, combinedLD)
  const accelStop= calc(toGR,   combinedTO * 1.25)

  // POH filled enough to show results
  const allFilled = toGR && toOver && ldgGR && ldgOver

  // ── Sub-components ────────────────────────────────────────────
  const SmallInput = PerfSmallInput

  const HeroResult = ({ label, value, sub }) => (
    <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10,
      padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
        letterSpacing: '0.5px', textTransform: 'uppercase' }}>{label}</div>
      {value != null
        ? <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace',
                color: 'var(--text)', letterSpacing: '-0.5px' }}>{value.toLocaleString()}</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
            </div>
            {sub && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{sub}</div>}
          </>
        : <div style={{ fontSize: 13, color: 'var(--text-tertiary)', paddingTop: 4 }}>Enter POH values</div>
      }
    </div>
  )

  const pct = f => `${f >= 1 ? '+' : ''}${((f - 1) * 100).toFixed(0)}%`

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      {/* ── Tab toggle ── */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ position: 'relative', display: 'flex', background: 'var(--bg-card-2)', borderRadius: 10, padding: 3 }}>
          <div style={{
            position: 'absolute', top: 3, bottom: 3,
            width: 'calc(50% - 3px)',
            left: tab === 'dep' ? 3 : 'calc(50%)',
            background: 'var(--accent)', borderRadius: 7,
            transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1)',
            pointerEvents: 'none',
          }} />
          {[['dep', 'Takeoff'], ['arr', 'Landing']].map(([key, label]) => (
            <div key={key} onClick={() => setTab(key)} style={{
              flex: 1, padding: '6px 10px', zIndex: 1, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, letterSpacing: '0.3px',
              color: tab === key ? 'var(--accent-fg)' : 'var(--text-secondary)',
              transition: 'color 0.22s', userSelect: 'none',
            }}>
              {label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '14px 14px 0' }}>

        {/* ── Airport header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
          marginBottom: 14, paddingBottom: 14 }}>
          <div>
            {cur.loading
              ? <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Fetching…</div>
              : <>
                  <div style={{ fontSize: 34, fontWeight: 800, fontFamily: 'monospace',
                    color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1 }}>
                    {cur.icao || (tab === 'dep' ? 'DEP' : 'ARR')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {tab === 'dep' ? 'Takeoff airport' : 'Landing airport'}
                  </div>
                </>
            }
          </div>
          {/* DA badge */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
              letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 2 }}>Density Alt</div>
            {cur.da != null
              ? <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                  {cur.da.toLocaleString()} ft
                </div>
              : <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Fill DA card</div>
            }
          </div>
        </div>

        {/* ── Runway picker ── */}
        {cur.runways.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
              letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6 }}>
              {tab === 'dep' ? 'Takeoff Runway' : 'Landing Runway'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
              {cur.runways.map(r => (
                <button key={r.id} onClick={() => {
                  updCur({ selRwy: r, ...(r.slope != null ? { slope: String(r.slope) } : {}) })
                }} style={{
                  padding: '6px 8px', borderRadius: 7, cursor: 'pointer', textAlign: 'center',
                  fontSize: 12, fontWeight: 700, fontFamily: 'monospace', border: '0.5px solid',
                  borderColor: cur.selRwy?.id === r.id ? 'var(--text)' : 'var(--border)',
                  background: cur.selRwy?.id === r.id ? 'var(--text)' : 'transparent',
                  color: cur.selRwy?.id === r.id ? 'var(--bg)' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                }}>
                  {r.id}
                  <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 3, fontWeight: 400 }}>{r.hdg}°</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Wind row ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          {/* Wind direction with cardinal */}
          <FieldTip label="Wind Dir" tip="Wind direction in degrees magnetic. Auto-filled from METAR. 360=N, 090=E, 180=S, 270=W.">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 7, padding: '0 9px', height: 36, gap: 4 }}>
              <input type="text" inputMode="numeric" value={cur.windDir} onChange={e => updCur({ windDir: e.target.value })}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                {cur.windDir === 'VRB' ? '' : '°'}
              </span>
              {!isNaN(wDir) && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
                  flexShrink: 0, letterSpacing: '0.3px' }}>{toCardinal(wDir)}</span>
              )}
            </div>
          </FieldTip>

          {/* Wind speed */}
          <FieldTip label="Wind Spd" tip="Wind speed in knots from the METAR. Auto-filled on open.">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 7, padding: '0 9px', height: 36, gap: 3 }}>
              <input type="number" value={cur.windSpd} onChange={e => updCur({ windSpd: e.target.value })}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>kt</span>
            </div>
          </FieldTip>

          {/* Wind component */}
          <FieldTip label="Wind Comp" tip="Headwind (HW) shortens distances. Tailwind (TW) increases them. A 10kt tailwind adds ~50% to your roll.">
            <div style={{ height: 36, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--bg-card-2)', borderRadius: 7 }}>
              {cur.windDir === 'VRB' && !isNaN(wSpd)
                ? <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                    VRB {wSpd}kt
                  </span>
                : (!isNaN(wDir) && !isNaN(wSpd) && cur.selRwy)
                ? <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                    {hwComp >= 0 ? '+' : ''}{hwComp}kt {hwComp >= 0 ? 'HW' : 'TW'}
                  </span>
                : <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>—</span>
              }
            </div>
          </FieldTip>
        </div>

        {/* ── Surface + slope ── */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          <FieldTip label="Surface" tip="Wet runway increases landing roll by ~20%. Takeoff roll is less affected but still longer.">
            <div style={{ display: 'flex', background: 'var(--bg-card-2)', borderRadius: 7, padding: 3 }}>
              {['dry', 'wet'].map(s => (
                <button key={s} onClick={() => updCur({ surface: s })} style={{
                  flex: 1, padding: '6px 0', borderRadius: 5, border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  background: cur.surface === s ? 'var(--bg-card)' : 'transparent',
                  color: cur.surface === s ? 'var(--text)' : 'var(--text-tertiary)',
                  transition: 'all 0.15s',
                }}>{s}</button>
              ))}
            </div>
          </FieldTip>
          <FieldTip label="Slope" tip="Auto-filled from FAA runway data when available. Positive = uphill for takeoff (longer roll). Negative = downhill (shorter takeoff, longer landing).">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 7, padding: '7px 9px', gap: 3 }}>
              <input type="number" step="0.1" value={cur.slope} onChange={e => updCur({ slope: e.target.value })}
                placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>%</span>
            </div>
          </FieldTip>
        </div>

        {/* ── POH reference (shared) ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
            letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            POH Reference · Sea Level / Std Day
          </div>
        </div>

        {/* Baseline alt: full width, compact */}
        <div style={{ marginBottom: 8 }}>
          <FieldTip label="Baseline Altitude" tip="The reference altitude your POH table is based on. Almost all light aircraft use sea level (0 ft).">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 12px', gap: 8 }}>
              <input type="number" value={cur.pohBase} onChange={e => updCur({ pohBase: e.target.value })}
                placeholder="0" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace' }} />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft  ·  sea level = 0</span>
            </div>
          </FieldTip>
        </div>

        {/* Weight: POH chart baseline vs. actual, side by side */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <FieldTip label="POH Chart Weight" tip="The weight your POH takeoff/landing table is built around, usually max gross. Auto-filled from the Aircraft profile.">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 10px', gap: 3 }}>
              <input type="number" value={cur.pohWeight} onChange={e => updCur({ pohWeight: e.target.value })}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace', width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>lb</span>
            </div>
          </FieldTip>
          <FieldTip label={`Actual ${isDepTab ? 'Takeoff' : 'Landing'} Weight`} tip="Auto-filled from your Weight & Balance checklist. Confirm it matches, or edit if this leg's weight is different (e.g. landing weight after fuel burn).">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 10px', gap: 3 }}>
              <input type="number" value={cur.actualWeight} onChange={e => updCur({ actualWeight: e.target.value })}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace', width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>lb</span>
            </div>
          </FieldTip>
        </div>

        {/* 2×2 grid: Takeoff left, Landing right */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
          {[
            { label: 'TO Ground Roll',  tip: 'Distance from brake release to lift-off, per your POH.',             val: toGR,   set: setToGR   },
            { label: 'LDG Ground Roll', tip: 'Distance from touchdown to full stop, per your POH.',                val: ldgGR,  set: setLdgGR  },
            { label: 'TO Over 50ft',    tip: 'Distance from brake release to clearing a 50ft obstacle, POH value.',val: toOver, set: setToOver  },
            { label: 'LDG Over 50ft',   tip: 'Distance from 50ft height to full stop. Compare against runway length.',val:ldgOver,set: setLdgOver },
          ].map(({ label, tip, val, set }) => (
            <FieldTip key={label} label={label} tip={tip}>
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
                borderRadius: 8, padding: '8px 10px', gap: 3 }}>
                <input type="number" value={val} onChange={e => set(e.target.value)} placeholder="—"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                    fontSize: 17, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                    width: 0, minWidth: 0 }} />
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>ft</span>
              </div>
            </FieldTip>
          ))}
        </div>

        {/* ── Results ── */}
        {allFilled && (
          <>
            {/* Hero result cards */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              {isDepTab ? (
                <>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <FieldTip label="TO Ground Roll" tip="How far you'll roll on the runway before lifting off today, with all conditions applied." style={{ flex: 'unset' }}>
                      <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{toGRc?.toLocaleString() ?? '—'}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>lift-off distance</div>
                      </div>
                    </FieldTip>
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <FieldTip label="Accel-Stop" tip="If you abort the takeoff, this is how much runway you need to accelerate and then brake to a full stop. Must fit within available runway." style={{ flex: 'unset' }}>
                      <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{accelStop?.toLocaleString() ?? '—'}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>abort by here</div>
                      </div>
                    </FieldTip>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <FieldTip label="LDG Ground Roll" tip="Distance from touchdown to full stop today, with all conditions applied." style={{ flex: 'unset' }}>
                      <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{ldgGRc?.toLocaleString() ?? '—'}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>full-stop distance</div>
                      </div>
                    </FieldTip>
                  </div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <FieldTip label="LDG Over 50ft" tip="Total distance from 50ft height to full stop. This is what you compare against available runway length." style={{ flex: 'unset' }}>
                      <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{ldgOverc?.toLocaleString() ?? '—'}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>ft</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>from 50ft to stop</div>
                      </div>
                    </FieldTip>
                  </div>
                </>
              )}
            </div>

            {/* Critical number */}
            <div style={{ position: 'relative', marginBottom: 6 }}>
              <FieldTip label="Required Runway" tip="The minimum runway length needed today. Your available runway must exceed this number, if it doesn't, do not depart." style={{ flex: 'unset' }}>
                {(() => {
                  const warn = (isDepTab ? toOverc : ldgOverc) > 3000
                  return (
                    <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, padding: '12px 14px',
                      border: `1px solid ${warn ? '#FF950040' : 'transparent'}`, position: 'relative' }}>
                      {warn && (
                        <div style={{ position: 'absolute', top: 10, right: 12,
                          animation: 'warn-blink 2.4s ease-in-out infinite' }}>
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                            stroke="#FF9500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                          </svg>
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 40, fontWeight: 900, fontFamily: 'monospace', letterSpacing: '-1px', color: 'var(--text)' }}>
                          {(isDepTab ? toOverc : ldgOverc)?.toLocaleString() ?? '—'}
                        </span>
                        <span style={{ fontSize: 15, color: 'var(--text-tertiary)' }}>ft</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                        Your runway must be longer than this number
                      </div>
                    </div>
                  )
                })()}
              </FieldTip>
            </div>

            {/* Correction summary strip */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
              {[
                { label: 'DA',      factor: daFactor,                              tip: 'Effect of density altitude on distances. Higher DA = thinner air = longer roll.' },
                { label: 'Wind',    factor: windFactor,                            tip: 'Headwind shortens distances (good). Tailwind increases them significantly (bad).' },
                { label: 'Surface', factor: surfFactor,                            tip: 'Wet runway adds ~20% to landing roll. Dry has no penalty.' },
                { label: 'Slope',   factor: isDepTab ? slopeFactorTO : slopeFactorLD, tip: 'Uphill takeoff = longer roll. Downhill landing = longer roll.' },
                { label: 'Weight',  factor: weightFactor,                          tip: 'Lighter than the POH chart weight shortens distances; heavier lengthens them. Enter both weights above to apply.' },
              ].map(({ label, factor, tip }) => (
                <FieldTip key={label} label={label} tip={tip} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                  <div style={{ background: 'var(--bg-card-2)', borderRadius: 7, padding: '5px 4px' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
                      {pct(factor)}
                    </div>
                  </div>
                </FieldTip>
              ))}
              <FieldTip label="Total" tip="Combined effect of all corrections. This multiplier is applied to your POH book numbers." style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <div style={{ background: 'var(--bg-card-2)', borderRadius: 7, padding: '5px 4px',
                  border: '0.5px solid var(--border-strong)' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                    {pct(isDepTab ? combinedTO : combinedLD)}
                  </div>
                </div>
              </FieldTip>
            </div>

            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', marginBottom: 14, lineHeight: 1.4 }}>
              Planning aid only. An estimate, not a substitute for your POH performance charts. Always verify against the POH before flight.
            </div>
          </>
        )}
      </div>

      {!allFilled && !isChecked && (
        <div style={{ padding: '10px 14px 12px' }}>
          <div style={{ width: '100%', padding: '11px 0', borderRadius: 10,
            background: 'var(--bg-card-2)', color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
            Enter POH reference values to complete
          </div>
        </div>
      )}
      {(allFilled || isChecked) && (
        <DoneButton isChecked={isChecked} onDone={() => { if (!isChecked) onToggle(item.id); setOpen(false) }}
          autoCheck onAutoComplete={() => onToggle(item.id)} />
      )}
    </ExpandableCard>
  )
}

/* ── Cruise / Fuel / Endurance calculator ────────────────────── */
export function CruiseItem({ item, isChecked, onToggle }) {
  const [open, setOpen] = useState(false)

  // POH inputs
  const [tas,       setTas]       = useState('')   // cruise TAS knots
  const [burnRate,  setBurnRate]  = useState('')   // GPH
  const [fuelOnBoard, setFuelOnBoard] = useState('') // usable gallons
  const [flightRules, setFlightRules] = useState('VFR') // VFR | IFR
  const [timeOfDay, setTimeOfDay] = useState('day') // day | night. VFR reserve only (91.151)
  const [isHelicopter, setIsHelicopter] = useState(false)

  // Auto-filled
  const [routeDist, setRouteDist] = useState(null) // nm
  const [windsAloft, setWindsAloft] = useState(null) // { dir, spd, temp } at altitude
  const [cruiseAlt, setCruiseAlt] = useState('')   // ft, from altitude card or manual
  const [winding, setWinding]     = useState(false)
  const [routeBearing, setRouteBearing] = useState(null) // magnetic track dep→dest
  const [depIcao, setDepIcao]     = useState('')
  const [destIcao, setDestIcao]   = useState('')

  // Tracks whether we've done the first restore (prevents save from firing before restore)
  const cruiseRestored = useRef(false)
  useEffect(() => {
    if (!cruiseRestored.current) return
    put('settings', { key: 'cruise', tas, burnRate, fuelOnBoard, flightRules, timeOfDay }).catch(() => {})
    // Editing the altitude here updates the route record the rest of the app
    // reads, rather than a second copy of it.
    if (cruiseAlt !== '') {
      get('settings', 'route').then(r => {
        if (r && String(r.cruiseAlt ?? '') !== String(cruiseAlt)) {
          put('settings', { ...r, cruiseAlt: parseFloat(cruiseAlt) || null }).catch(() => {})
        }
      })
    }
  }, [tas, burnRate, fuelOnBoard, flightRules, cruiseAlt, timeOfDay])

  useEffect(() => {
    if (!open) return
    Promise.all([get('settings', 'cruise'), get('aircraft', 'profile')]).then(([s, profile]) => {
      if (!cruiseRestored.current) {
        // First open: seed from aircraft profile, then overlay any saved user values
        const profileTas      = profile?.vspeeds?.cruise ? String(parseFloat(profile.vspeeds.cruise) || '') : ''
        const profileBurn     = profile?.burnRate?.cruise ? String(parseFloat(profile.burnRate.cruise) || '') : ''
        const profileFuel     = profile?.fuel?.usable     ? String(parseFloat(profile.fuel.usable)     || '') : ''
        setTas(s?.tas           || profileTas)
        setBurnRate(s?.burnRate || profileBurn)
        setFuelOnBoard(s?.fuelOnBoard || profileFuel)
      }
      // Always restore non-performance fields and label
      if (profile?.fullName) setAircraftLabel(profile.fullName)
      if (s?.flightRules) setFlightRules(s.flightRules)
      if (s?.timeOfDay)   setTimeOfDay(s.timeOfDay)
      setIsHelicopter(profile?.category === 'helicopter')
      cruiseRestored.current = true
    })

    // Route distance + bearing
    get('settings', 'route').then(async r => {
      if (!r?.depPos && !r?.destPos) return
      setDepIcao(r.dep || '')
      setDestIcao(r.dest || '')
      if (r.depPos && r.destPos) {
        const [lat1, lon1] = r.depPos, [lat2, lon2] = r.destPos
        // Haversine distance
        const R = 3440.065 // nm
        const dLat = (lat2 - lat1) * Math.PI / 180
        const dLon = (lon2 - lon1) * Math.PI / 180
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2
        setRouteDist(Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))))
        // True bearing dep→dest
        const y = Math.sin(dLon) * Math.cos(lat2*Math.PI/180)
        const x = Math.cos(lat1*Math.PI/180)*Math.sin(lat2*Math.PI/180) - Math.sin(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.cos(dLon)
        setRouteBearing(((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360)
      }
    })
    // Cruise altitude lives with the route and nowhere else. It used to be
    // written here too, so the altitude the advisor recommended and the one
    // the fuel plan used could disagree.
    get('settings', 'route').then(r => {
      if (r?.cruiseAlt) setCruiseAlt(String(r.cruiseAlt))
    })

  }, [open])

  // Always-on listener: reacts to aircraft preset changes from the takeoff/landing card
  useEffect(() => {
    const onPresetChange = e => {
      const { label, tas, fuelBurn, fuelUsable } = e.detail
      if (tas)        setTas(tas)
      if (fuelBurn)   setBurnRate(fuelBurn)
      if (fuelUsable) setFuelOnBoard(fuelUsable)
      if (label)      setAircraftLabel(label)
    }
    window.addEventListener('aircraft-preset-changed', onPresetChange)
    return () => window.removeEventListener('aircraft-preset-changed', onPresetChange)
  }, [])

  const [windError, setWindError] = useState(null)
  const [aircraftLabel, setAircraftLabel] = useState('')

  // Winds aloft at the cruise altitude, for the ground speed and fuel plan.
  //
  // The parsing lives in fbWinds.js, which the route card's fallback wind
  // column also uses. This card used to carry its own copy, and the two had
  // already drifted: that one read the bulletin by splitting on whitespace,
  // which shifts every level down for a station reporting nothing at 3,000 ft,
  // dropped the temperature above 24,000 ft where the sign is implicit, and. 
  // worst: fell back to the FIRST station in the bulletin when the departure
  // was not an FB site, presenting Abilene's wind as though it were yours.
  //
  // The shared version interpolates the three nearest stations to the actual
  // field, at the actual altitude, and says which stations it used.
  useEffect(() => {
    const alt = parseFloat(cruiseAlt)
    if (!open || isNaN(alt) || alt < 1000) return
    let cancelled = false
    setWinding(true)
    setWindError(null)
    setWindsAloft(null)

    ;(async () => {
      // The departure is usually an FB station itself; when it is not, its
      // coordinates still place it among the stations that surround it.
      let pos = stationPos(depIcao)
      if (!pos && depIcao) {
        try {
          const apt = await lookupAirport(depIcao)
          if (Number.isFinite(apt?.lat) && Number.isFinite(apt?.lon)) pos = { lat: apt.lat, lon: apt.lon }
        } catch { /* falls through to the error below */ }
      }
      if (cancelled) return
      if (!pos) {
        setWindError(depIcao ? `No winds-aloft coverage near ${depIcao}` : 'Set a departure airport')
        setWinding(false)
        return
      }

      const w = await fbWindAt(pos.lat, pos.lon, alt)
      if (cancelled) return
      if (!w) {
        setWindError('Forecast unavailable')
      } else {
        setWindsAloft({
          // dir 0 / spd 0 is how this card has always shown light and variable.
          dir: w.dirDeg ?? 0,
          spd: Math.round(w.kt),
          temp: w.tempC == null ? null : Math.round(w.tempC),
          level: w.levelFt,
          station: w.nearestIdent,
          stationNm: w.nearestNm,
        })
      }
      setWinding(false)
    })()

    return () => { cancelled = true }
  }, [open, cruiseAlt, depIcao])

  // ── Calculations ─────────────────────────────────────────────
  const tasN   = parseFloat(tas)
  const burnN  = parseFloat(burnRate)
  const fobN   = parseFloat(fuelOnBoard)
  const distN  = routeDist
  const altN   = parseFloat(cruiseAlt)

  // Wind correction angle & ground speed
  let groundSpeed = tasN
  let hwComponent = 0
  if (windsAloft && routeBearing != null && !isNaN(tasN)) {
    hwComponent = Math.round(windsAloft.spd * Math.cos((windsAloft.dir - routeBearing) * Math.PI / 180))
    groundSpeed = Math.max(1, tasN - hwComponent)
  }

  const flightTimeH  = (distN && groundSpeed > 0) ? distN / groundSpeed : null
  const flightTimeMin = flightTimeH ? Math.round(flightTimeH * 60) : null
  const fuelRequired  = (flightTimeH && !isNaN(burnN)) ? flightTimeH * burnN : null
  const enduranceH    = (!isNaN(fobN) && !isNaN(burnN) && burnN > 0) ? fobN / burnN : null
  const reserveH      = (enduranceH != null && flightTimeH != null) ? enduranceH - flightTimeH : null
  const reserveMin    = reserveH != null ? Math.round(reserveH * 60) : null
  // 91.151 (VFR fuel reserve) applies to airplanes only. 30 min day / 45 min
  // night, and explicitly excludes rotorcraft. Helicopters have no codified
  // Part 91 VFR reserve minimum; 20 min is the common operator/industry
  // standard, not an FAR citation. 91.167 (IFR, 45 min after the alternate)
  // applies to both categories the same, so only the VFR side differs.
  const reqReserveMin = flightRules === 'IFR'
    ? 45
    : isHelicopter ? 20 : (timeOfDay === 'night' ? 45 : 30)
  const reserveRuleNote = flightRules === 'IFR'
    ? 'FAR 91.167. 45 min after alternate'
    : isHelicopter
      ? '20 min. Operator standard, no FAR 91.151 minimum for helicopters'
      : `FAR 91.151. 30 min day / 45 min night (${timeOfDay})`
  const goNoGo        = reserveMin != null ? reserveMin >= reqReserveMin : null

  const fmtTime = (h) => {
    if (h == null || isNaN(h)) return '—'
    const hh = Math.floor(Math.abs(h)), mm = Math.round((Math.abs(h) % 1) * 60)
    return `${hh}h ${mm.toString().padStart(2,'0')}m`
  }

  const hasBasics = !isNaN(tasN) && !isNaN(burnN)
  const hasAll    = hasBasics && !isNaN(fobN) && distN

  // Fuel bar segments (0–1)
  const tripFrac    = (fuelRequired != null && !isNaN(fobN) && fobN > 0) ? Math.min(fuelRequired / fobN, 1) : 0
  const reqResFrac  = (!isNaN(burnN) && !isNaN(fobN) && fobN > 0) ? Math.min((reqReserveMin/60*burnN) / fobN, 1 - tripFrac) : 0
  const extraFrac   = Math.max(0, 1 - tripFrac - reqResFrac)
  const reserveFuelGal = (reqReserveMin / 60) * burnN

  // Persist fuel state for AircraftItem to read
  if (!isNaN(fobN) && fobN > 0) {
    localStorage.setItem('cruise_fuel_state', JSON.stringify({
      fobN, tripFrac, reqResFrac, extraFrac,
      fuelRequired: fuelRequired ?? null,
      reserveFuelGal: !isNaN(reserveFuelGal) ? reserveFuelGal : null,
      extraGal: !isNaN(fobN) && fuelRequired != null ? Math.max(0, fobN - (fuelRequired ?? 0) - reserveFuelGal) : null,
    }))
  }

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>
      <div style={{ padding: '14px 14px 0' }}>

        {/* ── Route summary ── */}
        {(depIcao || destIcao || distN) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14, paddingBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 32, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>
                {depIcao || '—'}
              </span>
              <img
                src={isHelicopter ? '/helicopter.png' : '/modo-avion.png'}
                width={22} height={22} alt=""
                style={{ objectFit: 'contain', filter: 'var(--icon-filter)', flexShrink: 0, transform: 'rotate(90deg)' }}
              />
              <span style={{ fontSize: 32, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>
                {destIcao || '—'}
              </span>
            </div>
            {distN && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                  letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 2 }}>Distance</div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)' }}>
                  {distN} nm
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Cruise altitude + flight rules ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <FieldTip label="Cruise Altitude" tip="Your planned cruise altitude. Used to fetch winds aloft from the FAA forecast." style={{ flex: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 10px', gap: 4 }}>
              <input type="number" value={cruiseAlt} onChange={e => setCruiseAlt(e.target.value)}
                placeholder="e.g. 6500" style={{ flex: 1, background: 'none', border: 'none',
                  outline: 'none', fontSize: 16, fontWeight: 700, color: 'var(--text)',
                  fontFamily: 'monospace', width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>ft</span>
            </div>
          </FieldTip>
          <FieldTip label="Flight Rules" tip={
            isHelicopter
              ? 'Helicopters have no FAR 91.151 VFR reserve. 20 min is the common operator standard. IFR still requires 45 min per 91.167.'
              : 'VFR requires 30 min day / 45 min night fuel reserve (91.151). IFR requires 45 min (91.167). This sets your minimum reserve check.'
          } style={{ flex: 1 }}>
            <div style={{ display: 'flex', background: 'var(--bg-card-2)', borderRadius: 8, padding: 3 }}>
              {['VFR','IFR'].map(r => (
                <button key={r} onClick={() => setFlightRules(r)} style={{
                  flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 700, background: flightRules === r ? 'var(--bg-card)' : 'transparent',
                  color: flightRules === r ? 'var(--text)' : 'var(--text-tertiary)', transition: 'all 0.15s',
                }}>{r}</button>
              ))}
            </div>
          </FieldTip>
        </div>

        {/* Day/Night, only affects the airplane VFR reserve (91.151); not
            shown for IFR (flat 45 min either way) or helicopters (flat 20 min
            operator standard, no day/night split in the FARs to model). */}
        {flightRules === 'VFR' && !isHelicopter && (
          <div style={{ marginBottom: 12 }}>
            <FieldTip label="Time of Day" tip="91.151: 30 min reserve required by day, 45 min at night.">
              <div style={{ display: 'flex', background: 'var(--bg-card-2)', borderRadius: 8, padding: 3 }}>
                {['day','night'].map(t => (
                  <button key={t} onClick={() => setTimeOfDay(t)} style={{
                    flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
                    background: timeOfDay === t ? 'var(--bg-card)' : 'transparent',
                    color: timeOfDay === t ? 'var(--text)' : 'var(--text-tertiary)', transition: 'all 0.15s',
                  }}>{t}</button>
                ))}
              </div>
            </FieldTip>
          </div>
        )}

        {/* ── Winds aloft ── */}
        <div style={{ background: 'var(--bg-card-2)', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
          {/* Header */}
          <div style={{ padding: '8px 12px 6px' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.6px',
              textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
              Winds Aloft{windsAloft ? ` · ${windsAloft.level.toLocaleString()} ft` : ''}
              {/* Which station the forecast actually came from. Only shown
                  when it is far enough away to matter. Near the field it is
                  noise, but a wind interpolated from 90 NM away is a fact the
                  pilot should be able to see. */}
              {windsAloft?.station && windsAloft.stationNm > 40 && (
                <span style={{ fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'none', letterSpacing: 0 }}>
                  {' '}· nearest {windsAloft.station}, {windsAloft.stationNm} NM
                </span>
              )}
            </span>
          </div>

          {winding && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-tertiary)' }}>Fetching forecast…</div>
          )}
          {!winding && windError && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--danger)' }}>{windError}</div>
          )}
          {!winding && !windsAloft && !windError && (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-tertiary)' }}>Enter cruise altitude to fetch</div>
          )}

          {!winding && windsAloft && (
            <>
              {/* Data row */}
              <div style={{ display: 'flex' }}>
                {windsAloft.dir === 0 && windsAloft.spd === 0
                  ? <div style={{ flex: 1, padding: '10px 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Light &amp; variable</div>
                  : <>
                      <div style={{ flex: 1, padding: '10px 12px' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 4 }}>Direction</div>
                        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{windsAloft.dir}°</div>
                      </div>
                      <div style={{ flex: 1, padding: '10px 12px' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 4 }}>Speed</div>
                        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>{windsAloft.spd}<span style={{ fontSize: 11, fontWeight: 600, marginLeft: 2 }}>kt</span></div>
                      </div>
                      <div style={{ flex: 1, padding: '10px 12px' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 4 }}>Temp</div>
                        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: '-0.5px' }}>
                          {windsAloft.temp != null ? `${windsAloft.temp > 0 ? '+' : ''}${windsAloft.temp}°C` : '—'}
                        </div>
                      </div>
                    </>
                }
              </div>

              {/* Route component */}
              {routeBearing != null && (
                <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>On Route</span>
                  <span style={{ fontSize: 15, fontWeight: 800, fontFamily: 'monospace',
                    color: hwComponent >= 0 ? 'var(--text)' : 'var(--ok)' }}>
                    {hwComponent >= 0 ? '+' : ''}{hwComponent}kt {hwComponent >= 0 ? 'HW' : 'TW'}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── POH inputs ── */}
        {aircraftLabel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              Auto-filled from <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{aircraftLabel}</span>, edit to override
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <FieldTip label="Cruise TAS" tip="True Airspeed from your POH at your planned power setting and altitude. Usually found in the cruise performance table.">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 10px', gap: 4 }}>
              <input type="number" value={tas} onChange={e => setTas(e.target.value)}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>kt</span>
            </div>
          </FieldTip>
          <FieldTip label="Fuel Burn" tip="How many gallons per hour your engine burns at cruise. From POH cruise performance table at your power setting.">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 10px', gap: 4 }}>
              <input type="number" value={burnRate} onChange={e => setBurnRate(e.target.value)}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>GPH</span>
            </div>
          </FieldTip>
          <FieldTip label="Fuel on Board" tip="Usable fuel you're departing with. Do not include unusable fuel. Check your POH for usable fuel capacity.">
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card-2)',
              borderRadius: 8, padding: '8px 10px', gap: 4 }}>
              <input type="number" value={fuelOnBoard} onChange={e => setFuelOnBoard(e.target.value)}
                placeholder="—" style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: 'monospace',
                  width: 0, minWidth: 0 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>gal</span>
            </div>
          </FieldTip>
        </div>

        {/* ── Results ── */}
        {hasBasics && distN && (() => {
          // Reserve fuel in gallons
          const reserveFuel     = (reqReserveMin / 60) * burnN
          // Usable fuel per leg (full tank minus reserve)
          const usablePerLeg    = Math.max(0, fobN - reserveFuel)
          // Max range per full tank with reserve
          const rangePerLeg     = (usablePerLeg / burnN) * groundSpeed  // nm
          // Is this a multi-leg trip?
          const needsStops      = hasAll && fuelRequired != null && fuelRequired > fobN && rangePerLeg > 0
          // Number of legs needed (ceil)
          const numLegs         = needsStops ? Math.ceil(distN / rangePerLeg) : 1
          const numStops        = numLegs - 1
          // Suggested equal leg distance
          const legDist         = needsStops ? Math.round(distN / numLegs) : null
          // Leg flight time
          const legTimeH        = needsStops ? legDist / groundSpeed : null
          // Fuel per leg
          const fuelPerLeg      = needsStops ? (legTimeH * burnN) : null
          // Total trip time (legs only, no ground time)
          const totalFlightH    = needsStops ? numLegs * legTimeH : flightTimeH

          return (<>
            {/* ── Top stats row: GS · Flight Time (or Total Time) ── */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                  letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>Ground Speed</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)' }}>
                    {Math.round(groundSpeed)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>kt</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  TAS {Math.round(tasN)}kt{hwComponent !== 0 ? ` · ${hwComponent > 0 ? '−' : '+'}${Math.abs(hwComponent)}kt wind` : ''}
                </div>
              </div>
              <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                  letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>
                  {needsStops ? 'Total Flight Time' : 'Flight Time'}
                </div>
                <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)' }}>
                  {fmtTime(totalFlightH)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {needsStops ? `${numLegs} legs · excl. ground time` : `${distN} nm at ${Math.round(groundSpeed)}kt`}
                </div>
              </div>
            </div>

            {/* ── SINGLE-LEG: Fuel Required + Endurance + GO/NO-GO ── */}
            {!needsStops && hasAll && (() => {
              const extraGal = Math.max(0, fobN - (fuelRequired ?? 0) - reserveFuel)
              return (<>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                      letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>Fuel Required</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)' }}>
                        {fuelRequired?.toFixed(1)}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>gal</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {burnN} GPH × {fmtTime(flightTimeH)}
                    </div>
                  </div>
                  <div style={{ flex: 1, background: 'var(--bg-card-2)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                      letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>Endurance</div>
                    <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: 'var(--text)' }}>
                      {fmtTime(enduranceH)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {fuelOnBoard} gal ÷ {burnN} GPH
                    </div>
                  </div>
                </div>


                {/* GO / NO-GO */}
                <div style={{ borderRadius: 12, padding: '12px 14px', marginBottom: 14,
                  background: 'var(--bg-card-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                        letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>
                        Reserve after landing
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 32, fontWeight: 900, fontFamily: 'monospace',
                          color: 'var(--text)', letterSpacing: '-0.5px' }}>
                          {reserveMin != null ? Math.max(0, reserveMin) : '—'}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>min</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {flightRules} minimum: {reqReserveMin} min ({isHelicopter ? 'Helicopter' : 'Airplane'})
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 1 }}>
                        {reserveRuleNote}
                      </div>
                    </div>
                    <div style={{ padding: '8px 18px', borderRadius: 20,
                      background: goNoGo ? 'var(--ok)' : 'var(--danger)',
                      color: '#fff', fontSize: 13, fontWeight: 800, letterSpacing: '0.5px' }}>
                      {goNoGo ? 'GO' : 'NO GO'}
                    </div>
                  </div>
                </div>

              </>)
            })()}

            {/* ── MULTI-LEG: Fuel stops plan ── */}
            {needsStops && (() => {
              const legRangeNm = Math.round((usablePerLeg / burnN) * groundSpeed)
              return (
                <div style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 14,
                  border: '1px solid var(--border)', background: 'var(--bg-card-2)' }}>

                  {/* Header */}
                  <div style={{ padding: '11px 14px 10px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                        stroke="var(--text-secondary)" strokeWidth="2.5"
                        strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12h18M3 6l9-3 9 3M3 18l9 3 9-3"/>
                      </svg>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
                        letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                        Fuel Stops Required
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontSize: 22, fontWeight: 900, fontFamily: 'monospace',
                        color: 'var(--text)' }}>{numStops}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                        {numStops === 1 ? 'stop' : 'stops'}
                      </span>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
                    {[
                      { label: 'Range / tank',  val: `${legRangeNm}`,  unit: 'nm',  sub: `with ${reqReserveMin}min reserve` },
                      { label: 'Leg distance',   val: `${legDist}`,     unit: 'nm',  sub: `${numLegs} equal legs` },
                      { label: 'Fuel / leg',     val: fuelPerLeg?.toFixed(1), unit: 'gal', sub: fmtTime(legTimeH) },
                    ].map(({ label, val, unit, sub }, idx, arr) => (
                      <div key={label} style={{
                        padding: '10px 0 10px',
                        textAlign: 'center',
                        borderRight: idx < arr.length - 1 ? '0.5px solid var(--border)' : 'none',
                      }}>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                          letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 3 }}>
                          <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace',
                            color: 'var(--text)' }}>{val}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{unit}</span>
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 3 }}>{sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Leg timeline */}
                  <div style={{ padding: '12px 14px 10px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                      letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 10 }}>Trip breakdown</div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
                      {Array.from({ length: numLegs }).map((_, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                          {/* Node */}
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                            <div style={{
                              width: 8, height: 8, borderRadius: '50%',
                              background: i === 0 ? 'var(--text)' : 'var(--text-tertiary)',
                              border: '1.5px solid ' + (i === 0 ? 'var(--text)' : 'var(--border)'),
                            }} />
                            <div style={{ fontSize: 8, color: 'var(--text-tertiary)', marginTop: 4,
                              whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>
                              {i === 0 ? (depIcao || 'DEP') : `Stop ${i}`}
                            </div>
                          </div>
                          {/* Connector */}
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', margin: '0 3px', marginTop: -10 }}>
                            <div style={{ fontSize: 8, color: 'var(--text-tertiary)', marginBottom: 3 }}>
                              {legDist} nm
                            </div>
                            <div style={{ width: '100%', height: 1,
                              backgroundImage: 'repeating-linear-gradient(90deg, var(--text-tertiary) 0, var(--text-tertiary) 4px, transparent 4px, transparent 8px)',
                              opacity: 0.4 }} />
                          </div>
                        </div>
                      ))}
                      {/* Destination node */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%',
                          background: 'var(--ok)', border: '1.5px solid var(--ok)' }} />
                        <div style={{ fontSize: 8, color: 'var(--text-tertiary)', marginTop: 4,
                          letterSpacing: '0.3px' }}>{destIcao || 'DEST'}</div>
                      </div>
                    </div>
                  </div>

                  {/* Footer note */}
                  <div style={{ padding: '0 14px 11px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-tertiary)', lineHeight: 1.6,
                      paddingTop: 9 }}>
                      Equal-split estimates only. Verify fuel availability at each stop before flight.
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Show prompt when basics entered but no FOB yet */}
            {hasBasics && !hasAll && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center',
                padding: '4px 0 12px' }}>
                Enter fuel on board to complete
              </div>
            )}
          </>)
        })()}

        {!hasBasics && (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center',
            padding: '8px 0 12px' }}>
            Enter TAS and fuel burn to calculate
          </div>
        )}
      </div>

      {!hasAll && !isChecked && (
        <div style={{ padding: '10px 14px 12px' }}>
          <div style={{ width: '100%', padding: '11px 0', borderRadius: 10,
            background: 'var(--bg-card-2)', color: 'var(--text-tertiary)', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
            Fill all fields to complete
          </div>
        </div>
      )}
      {(hasAll || isChecked) && (
        <DoneButton isChecked={isChecked} onDone={() => { if (!isChecked) onToggle(item.id); setOpen(false) }}
          autoCheck onAutoComplete={() => onToggle(item.id)} />
      )}
    </ExpandableCard>
  )
}

/* ── Stable wrapper for the Weight & Balance sub-component (lives in
   its own file already). Module scope, so identity stays stable. ── */
export function WBExpand(props) { return <WBChecklistItem {...props} ExpandableCard={ExpandableCard} /> }
