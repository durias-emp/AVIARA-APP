import { useState, useEffect } from 'react'
import { get } from '../../lib/db'
import { loadWeather, parseWind, parseVisib, parseCloudLayers, parseFltCat } from '../../lib/weather'
import { lookupAirport } from './shared/awc'

// Same reserve-minutes logic as the Cruise & Fuel checklist item (91.151 —
// airplanes only, 30 min day / 45 min night; helicopters have no codified
// Part 91 VFR reserve, 20 min is the common operator standard; 91.167 IFR
// 45 min applies to both). Kept as a small local copy rather than a shared
// import since CruiseItem's version is entangled with its own component state.
function reserveReqMinutes(flightRules, isHelicopter, timeOfDay) {
  if (flightRules === 'IFR') return 45
  return isHelicopter ? 20 : (timeOfDay === 'night' ? 45 : 30)
}

function windComponents(wdir, wspd, rwyHdg) {
  if (wdir == null || wspd == null || rwyHdg == null || isNaN(wdir) || isNaN(wspd)) return null
  const diff = (wdir - rwyHdg) * Math.PI / 180
  return {
    headwind: Math.round(wspd * Math.cos(diff)),
    crosswind: Math.round(Math.abs(wspd * Math.sin(diff))),
  }
}

function freqByType(frequencies, re) {
  const f = (frequencies || []).find(f => re.test(f.type || ''))
  return f?.freq ?? null
}

// ── ACARS-strip visual atoms ──────────────────────────────────────
// Styled after a printed dispatch/OFP release: monospace, black on paper,
// dense two-column rows, dashed section rules. Colors are hardcoded (not
// app theme tokens) since this is meant to read as a physical printout
// regardless of whether the app is in light or dark mode.
const PAPER_FG = '#111'
const PAPER_MUTE = '#555'
const PAPER_RULE = '#bbb'

function PLine({ l, r, bold, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '1px 0' }}>
      <span style={{ color: accent ? '#b00' : PAPER_MUTE }}>{l}</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: accent ? '#b00' : PAPER_FG, textAlign: 'right' }}>{r ?? '--'}</span>
    </div>
  )
}

function Rule() {
  return <div style={{ borderTop: `1px dashed ${PAPER_RULE}`, margin: '6px 0' }} />
}

// Tappable stage heading — tapping highlights only that stage (dims the
// other two) without hiding any data, so the full page still prints intact.
function StageHead({ label, active, dimmed, onClick }) {
  return (
    <div onClick={onClick} className="fp-stagehead" style={{
      cursor: 'pointer', fontWeight: 700, letterSpacing: '0.06em',
      margin: '10px 0 4px', color: PAPER_FG,
      opacity: dimmed ? 0.35 : 1, transition: 'opacity 0.15s',
      textDecoration: active ? 'underline' : 'none',
    }}>
      ═══ {label} ═══
    </div>
  )
}

export default function FlightPlanOnePager({ onClose }) {
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState(null) // null = nothing highlighted, all stages equal weight
  const [data, setData] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [route, cruise, perfdist, lastWB, selectedRunway, alternates, pilot, acProfile] = await Promise.all([
        get('settings', 'route'), get('settings', 'cruise'), get('settings', 'perfdist'),
        get('settings', 'lastWB'), get('settings', 'selectedRunway'), get('settings', 'alternates'),
        get('settings', 'pilot'), get('aircraft', 'profile'),
      ])

      const dep = route?.dep?.toUpperCase() || ''
      const dest = route?.dest?.toUpperCase() || ''

      const [depApt, destApt, depWx, destWx] = await Promise.allSettled([
        dep  ? lookupAirport(dep)  : Promise.resolve(null),
        dest ? lookupAirport(dest) : Promise.resolve(null),
        dep  ? loadWeather(dep)    : Promise.resolve(null),
        dest ? loadWeather(dest)   : Promise.resolve(null),
      ])

      if (cancelled) return
      setData({
        route, cruise, perfdist, lastWB, selectedRunway, alternates, pilot, acProfile,
        depApt: depApt.status  === 'fulfilled' ? depApt.value  : null,
        destApt: destApt.status === 'fulfilled' ? destApt.value : null,
        depWx: depWx.status   === 'fulfilled' ? depWx.value   : null,
        destWx: destWx.status  === 'fulfilled' ? destWx.value  : null,
      })
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading || !data) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 500, background: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Building flight plan…</span>
      </div>
    )
  }

  const { route, cruise, perfdist, lastWB, selectedRunway, alternates, pilot, acProfile, depApt, destApt, depWx, destWx } = data

  const dep = route?.dep?.toUpperCase() || '—'
  const dest = route?.dest?.toUpperCase() || '—'
  const isHelicopter = acProfile?.category === 'helicopter'
  const flightRules = cruise?.flightRules || 'VFR'
  const timeOfDay = cruise?.timeOfDay || 'day'
  const reqReserve = reserveReqMinutes(flightRules, isHelicopter, timeOfDay)

  // Takeoff runway comes from the distance calculator's departure tab;
  // landing runway prefers the pilot's explicit tower-assigned/wind-analysis
  // pick (settings/selectedRunway) and falls back to the distance
  // calculator's arrival tab if nothing was explicitly selected.
  const toRwy = perfdist?.dep?.selRwy || null
  const ldRwy = selectedRunway || perfdist?.arr?.selRwy || null

  const depMetar = depWx?.metar
  const destMetar = destWx?.metar
  const toWind = toRwy ? windComponents(depMetar?.wdir, depMetar?.wspd, toRwy.hdg) : null
  const ldWind = ldRwy ? windComponents(destMetar?.wdir, destMetar?.wspd, ldRwy.hdg) : null

  const depCat = depMetar ? parseFltCat(depMetar) : null
  const destCat = destMetar ? parseFltCat(destMetar) : null

  const toAlt = alternates?.toAlts?.[0]
  const ldAlt = alternates?.ldAlts?.[0]

  const aircraftLine = [acProfile?.registration, acProfile?.fullName].filter(Boolean).join(' ') || '--'
  const now = new Date()
  const dateStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getFullYear()).slice(2)}`

  const toRwyStr = toRwy ? `${toRwy.id}(${String(toRwy.hdg).padStart(3,'0')})` : '----'
  const ldRwyStr = ldRwy ? `${ldRwy.id}(${String(ldRwy.hdg).padStart(3,'0')})` : '----'
  const toFreq = freqByType(depApt?.frequencies, /ctaf|tower|twr/i) ?? '---.--'
  const ldFreq = freqByType(destApt?.frequencies, /ctaf|tower|twr/i) ?? '---.--'
  const toWindStr = depMetar ? parseWind(depMetar) : '----'
  const ldWindStr = destMetar ? parseWind(destMetar) : '----'

  function toggleStage(s) { setStage(cur => cur === s ? null : s) }
  const dim = s => stage != null && stage !== s

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#2b2b2b', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <style>{`
        @media print {
          .fp-chrome { display: none !important; }
          .fp-paper { box-shadow: none !important; margin: 0 !important; opacity: 1 !important; }
          .fp-stagehead { opacity: 1 !important; }
          body { background: #fff !important; }
        }
      `}</style>

      {/* Top bar */}
      <div className="fp-chrome" style={{
        position: 'sticky', top: 0, zIndex: 2, background: '#2b2b2b',
        padding: '16px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button onClick={onClose} style={{
          width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>FLIGHT PLAN</span>
        <button onClick={() => window.print()} style={{
          width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* ── Receipt-style paper strip ── */}
      <div className="fp-paper" style={{
        maxWidth: 400, margin: '8px auto 40px', background: '#f7f4ec', color: PAPER_FG,
        fontFamily: '"SF Mono", ui-monospace, Menlo, Consolas, monospace',
        fontSize: 12, lineHeight: 1.55, padding: '20px 18px 24px',
        boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
      }}>
        <div style={{ textAlign: 'center', fontWeight: 700, marginBottom: 2 }}>FLIGHTPLAN {acProfile?.registration || '-----'}</div>
        <div style={{ textAlign: 'center', color: PAPER_MUTE, marginBottom: 8 }}>{dateStr}   OFP 1</div>

        <PLine l={route?.wpts?.length ? [dep, ...route.wpts.map(w => w.name), dest].join(' ') : `${dep}-${dest} DCT`} r="" />
        <PLine l={aircraftLine || 'AIRCRAFT'} r={lastWB ? `TOW ${Math.round(lastWB.weight)}` : 'TOW ----'} />
        <PLine l={`CRZ ALT ${route?.cruiseAlt || '----'}`} r={`WIND ${toWindStr}`} />
        <PLine l={`RES ${reqReserve}MIN`} r={cruise?.fuelOnBoard ? `FOB ${cruise.fuelOnBoard}` : 'FOB --'} />

        <Rule />

        <PLine l={`TRIP DIST ${route?.distNm ?? '---'}NM`} r={`TC/MC ${route?.tc != null ? Math.round(route.tc) : '--'}/${route?.mc != null ? Math.round(route.mc) : '--'}`} />
        <PLine l={`SOULS ${lastWB?.souls ?? '--'}`} r={`RULES ${flightRules}${flightRules === 'VFR' ? ` ${timeOfDay.toUpperCase()}` : ''}`} />
        <PLine l={`PIC ${pilot?.name || '----'}`} r={acProfile?.color ? acProfile.color.toUpperCase() : '----'} />
        {(pilot?.phone || pilot?.email) && (
          <PLine l={pilot?.phone ? `TEL ${pilot.phone}` : ''} r={pilot?.email || ''} />
        )}
        <PLine l={`ALTN TO ${toAlt?.icao || '----'}`} r={`ALTN LD ${ldAlt?.icao || '----'}`} />

        <Rule />

        {/* WPT table — the two endpoints, ACARS-style columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 0.8fr 1.3fr', fontWeight: 700, color: PAPER_MUTE, marginBottom: 2 }}>
          <span>WPT</span><span>FREQ</span><span>RWY</span><span>WIND</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 0.8fr 1.3fr', opacity: dim('TAKEOFF') ? 0.35 : 1 }}>
          <span>{dep}</span><span>{toFreq}</span><span>{toRwyStr}</span><span>{toWindStr}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 0.8fr 1.3fr', opacity: dim('LANDING') ? 0.35 : 1 }}>
          <span>{dest}</span><span>{ldFreq}</span><span>{ldRwyStr}</span><span>{ldWindStr}</span>
        </div>

        <Rule />
        <div style={{ fontWeight: 700, marginBottom: 2 }}>ATS ROUTE:</div>
        <div style={{ marginBottom: 4 }}>
          {route?.atsTokens?.length > 2
            // Filed-style string: airways stay as tokens, direct legs get DCT
            // (e.g. "KSFO DCT SNS V25 RZS DCT KLAX")
            ? route.atsTokens.map((tok, i, arr) => {
                if (i === 0) return tok
                const isAirway = /^[A-Z]{1,2}\d{1,4}$/.test(tok) && !(route.wpts ?? []).some(w => w.name === tok && !w.via)
                const prevIsAirway = /^[A-Z]{1,2}\d{1,4}$/.test(arr[i-1]) && !(route.wpts ?? []).some(w => w.name === arr[i-1] && !w.via)
                return isAirway || prevIsAirway ? tok : `DCT ${tok}`
              }).join(' ')
            : route?.wpts?.length
              ? [dep, ...route.wpts.map(w => `DCT ${w.name}`), `DCT ${dest}`].join(' ')
              : `${dep} DCT ${dest}`}
        </div>

        {/* ── TAKEOFF ── */}
        <StageHead label="TAKEOFF" active={stage === 'TAKEOFF'} dimmed={dim('TAKEOFF')} onClick={() => toggleStage('TAKEOFF')} />
        <div style={{ opacity: dim('TAKEOFF') ? 0.35 : 1, transition: 'opacity 0.15s' }}>
          <PLine l="RWY / DA" r={`${toRwyStr}  DA ${perfdist?.dep?.da != null ? perfdist.dep.da : '----'}`} />
          <PLine l="HW / XW" r={toWind ? `${toWind.headwind >= 0 ? '+' : ''}${toWind.headwind} / ${toWind.crosswind}` : '-- / --'} />
          <PLine l="TOGR / TOOVER" r={`${perfdist?.toGR ? Math.round(perfdist.toGR) : '----'} / ${perfdist?.toOver ? Math.round(perfdist.toOver) : '----'}`} />
          <PLine l="WB" r={lastWB ? `${Math.round(lastWB.weight)}/${lastWB.maxTOW ?? '----'}` : '---- / ----'}
            accent={lastWB?.withinEnvelope === false} />
          <PLine l="CAT" r={depCat?.label ?? '----'} accent={depCat && depCat.label !== 'VFR'} />
          <PLine l="OFF BLOCK" r="___________ Z" />
        </div>

        {/* ── ENROUTE ── */}
        <StageHead label="ENROUTE" active={stage === 'ENROUTE'} dimmed={dim('ENROUTE')} onClick={() => toggleStage('ENROUTE')} />
        <div style={{ opacity: dim('ENROUTE') ? 0.35 : 1, transition: 'opacity 0.15s' }}>
          <PLine l="CRZ ALT / DIST" r={`${route?.cruiseAlt || '----'} / ${route?.distNm ?? '---'}NM`} />
          <PLine l="TAS / BURN" r={`${cruise?.tas ?? '---'} / ${cruise?.burnRate ?? '---'}GPH`} />
          <PLine l="FOB / RSV REQ" r={`${cruise?.fuelOnBoard ?? '--'}GAL / ${reqReserve}MIN`} />
          <PLine l="LOST COMM" r="SQUAWK 7600" />
        </div>

        {/* ── LANDING ── */}
        <StageHead label="LANDING" active={stage === 'LANDING'} dimmed={dim('LANDING')} onClick={() => toggleStage('LANDING')} />
        <div style={{ opacity: dim('LANDING') ? 0.35 : 1, transition: 'opacity 0.15s' }}>
          <PLine l="RWY / DA" r={`${ldRwyStr}  DA ${perfdist?.arr?.da != null ? perfdist.arr.da : '----'}`} />
          <PLine l="HW / XW" r={ldWind ? `${ldWind.headwind >= 0 ? '+' : ''}${ldWind.headwind} / ${ldWind.crosswind}` : '-- / --'} />
          <PLine l="LDGR / LDOVER" r={`${perfdist?.ldgGR ? Math.round(perfdist.ldgGR) : '----'} / ${perfdist?.ldgOver ? Math.round(perfdist.ldgOver) : '----'}`} />
          <PLine l="CAT / VIS" r={`${destCat?.label ?? '----'} / ${destMetar ? parseVisib(destMetar) : '----'}`} accent={destCat && destCat.label !== 'VFR'} />
          {(parseCloudLayers(destMetar) || []).length > 0
            ? parseCloudLayers(destMetar).map((l, i) => <PLine key={i} l={`CLD ${i+1}`} r={`${l.cover} ${l.label}`} />)
            : <PLine l="CLD" r="CLR" />
          }
        </div>

        <Rule />
        <div style={{ textAlign: 'center', fontSize: 9, color: PAPER_MUTE, marginTop: 6, lineHeight: 1.5 }}>
          COCKPIT REFERENCE ONLY — NOT A FILED ATC FLIGHT PLAN.<br />
          TO FILE, CALL 1-800-WX-BRIEF OR USE 1800WXBRIEF.COM.
        </div>
      </div>
    </div>
  )
}
