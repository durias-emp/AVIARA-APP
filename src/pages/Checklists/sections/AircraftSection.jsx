import { useState, useEffect } from 'react'
import { get } from '../../../lib/db'
import { useActiveAircraft } from '../../../context/ActiveAircraft'
import { ExpandableCard, DoneButton, CheckRow as SharedCheckRow } from '../shared/ui'

const DOC_FAR = {
  'ac-crew':     'FAR 61.3',
  'ac-airworth': 'FAR 91.203',
  'ac-reg':      'FAR 91.203',
  'ac-oplim':    'FAR 91.9',
  'ac-wb':       'FAR 91.103',
}

function DocFarBadge({ id }) {
  const far = DOC_FAR[id]
  if (!far) return null
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
      background: 'var(--bg-card)', borderRadius: 20, padding: '3px 10px', flexShrink: 0,
    }}>{far}</div>
  )
}

function GroupRowComp({ title, ids, isCurrencyCompleted: icc, checkedIds, children, defaultOpen = false }) {
  const [groupOpen, setGroupOpen] = useState(defaultOpen)
  const allCompleted = ids.every(id => icc(id) || checkedIds.has(id))
  const currencyDone = ids.some(id => icc(id))
  return (
    <div style={{ margin: '4px 14px 0' }}>
      <button
        onClick={() => setGroupOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--bg-card-2)', borderRadius: groupOpen ? '11px 11px 0 0' : 11,
          padding: '11px 14px', cursor: 'pointer', gap: 10,
          textAlign: 'left', boxSizing: 'border-box',
        }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.1px', textAlign: 'left' }}>{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {allCompleted && (
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#fff',
              background: 'var(--ok)', borderRadius: 20, padding: '3px 10px',
            }}>Completed</div>
          )}
          {!allCompleted && currencyDone && (
            <div style={{
              fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
              background: 'var(--bg-card)', borderRadius: 20, padding: '3px 10px',
            }}>Partial</div>
          )}
        </div>
      </button>
      {groupOpen && (
        <div style={{ borderTop: 'none', borderRadius: '0 0 11px 11px', overflow: 'hidden' }}>
          {children}
        </div>
      )}
    </div>
  )
}

/* ── Aircraft checklist ──────────────────────────────────────── */
export function AircraftItem({ item, isChecked, onToggle }) {
  const { aircraftId } = useActiveAircraft()
  const [open, setOpen] = useState(false)
  const [checkedIds, setCheckedIds] = useState(new Set())
  const [aircraftImage, setAircraftImage] = useState('')
  const [aircraftName, setAircraftName]   = useState('')
  const [registration, setRegistration]   = useState('')
  const [fuelState, setFuelState]         = useState(null)
  const [currencyData, setCurrencyData]   = useState(null)

  useEffect(() => {
    if (aircraftId) {
      get('aircraft', aircraftId).then(p => {
        if (p?.image)        setAircraftImage(p.image)
        if (p?.fullName)     setAircraftName(p.fullName)
        if (p?.registration) setRegistration(p.registration)
      })
    }
    get('currency', 'profile').then(c => {
      if (c) setCurrencyData(c)
    })
    try {
      const saved = localStorage.getItem('cruise_fuel_state')
      if (saved) setFuelState(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [open, aircraftId])

  // Map Aircraft checklist row IDs -> currency data fields
  const CURRENCY_DOCS_MAP = {
    'ac-crew':      c => c?.airworthy?.docs?.crew,
    'ac-airworth':  c => c?.airworthy?.docs?.airworth,
    'ac-reg':       c => c?.airworthy?.docs?.reg,
    'ac-radio':     c => c?.airworthy?.docs?.radio,
    'ac-oplim':     c => c?.airworthy?.docs?.oplim,
    'ac-wb':        c => c?.airworthy?.docs?.wb,
  }
  const CURRENCY_INSP_MAP = {
    'ac-annual': c => c?.airworthy?.annualDate,
    'ac-elt':    c => c?.airworthy?.eltDate,
    'ac-xpdr':   c => c?.airworthy?.transponderDate,
    'ac-pitot':  c => c?.airworthy?.pitotDate,
    'ac-oil':    c => c?.airworthy?.oilDate,
    'ac-100hr':  c => c?.airworthy?.hundredHrHours,
  }
  const isCurrencyCompleted = id => {
    const docFn = CURRENCY_DOCS_MAP[id]
    if (docFn) return Boolean(docFn(currencyData))
    const inspFn = CURRENCY_INSP_MAP[id]
    if (inspFn) return Boolean(inspFn(currencyData))
    return false
  }

  const toggleSub = id => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const TOOLTIPS = {
    'ac-crew':    'Pilot certificate, photo ID, and valid medical (or BasicMed) must be on your person. FAR 61.3.',
    'ac-airworth':'Certificate of Airworthiness must be in the aircraft and valid. Check for any limitations. FAR 91.203.',
    'ac-reg':     'Aircraft Registration must be aboard. FAR 91.203.',
    'ac-radio':   'FCC Radio Station License must be aboard for international flights. Domestic VFR: not required but common practice.',
    'ac-oplim':   'Operating Limitations (AFM/POH + placards) must be in the aircraft and complied with. FAR 91.9.',
    'ac-wb':      'Current Weight & Balance data must be in the aircraft. FAR 91.103.',
    'ac-annual':  'Annual inspection must be current (within 12 calendar months). FAR 91.409.',
    'ac-100hr':   '100-hour inspection required if aircraft is used for hire or flight instruction for hire. FAR 91.409.',
    'ac-oil':     'Oil change within manufacturer limits. Check oil level and quality before flight.',
    'ac-ads':     'All applicable Airworthiness Directives must be complied with and recorded. FAR 91.409.',
    'ac-equip':   'Required equipment current. ELT battery, transponder, altimeter, pitot-static checks within calendar limits. FAR 91.171.',
    'ac-fuel-req':'Fuel load meets VFR or IFR reserve requirements for planned route and conditions. FAR 91.151 / 91.167.',
    'ac-extra-oil':'Extra quart(s) of correct oil grade aboard for the flight.',
    'ac-charts-cur':'Charts and plates are current and cover the planned route, alternates, and destination.',
  }

  const CheckRow = ({ id, label, far }) => {
    const fromCurrency = isCurrencyCompleted(id)
    if (far) {
      const checked = checkedIds.has(id)
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 14px' }}>
          <button
            onClick={() => toggleSub(id)}
            style={{
              width: '100%', textAlign: 'left', background: 'transparent',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 11, padding: 0, minWidth: 0,
            }}
          >
            <div style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              background: checked ? 'var(--accent)' : 'transparent',
              border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {checked && (
                <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
                  <polyline points="2,6 5,9 10,3" stroke="var(--accent-fg)" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {label.includes(': ') ? (
                <>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.2px' }}>
                    {label.split(': ')[0]}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)' }}>
                    {' '}{label.split(': ')[1]}
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{label}</span>
              )}
            </span>
          </button>
          <DocFarBadge id={id} />
        </div>
      )
    }
    return (
      <SharedCheckRow
        id={id} label={label}
        checked={checkedIds.has(id)} onToggle={toggleSub}
        disabled={fromCurrency} completedLabel={fromCurrency ? 'Completed' : undefined}
        tooltip={TOOLTIPS[id]}
      />
    )
  }

  // Maintenance date/hours input row
  const subIds = [
    'ac-crew','ac-airworth','ac-reg','ac-radio','ac-oplim','ac-wb',
    'ac-annual','ac-100hr','ac-oil','ac-ads','ac-elt','ac-xpdr','ac-pitot',
    'ac-fuel-req','ac-extra-oil','ac-charts-cur',
  ]

  return (
    <ExpandableCard item={item} isChecked={isChecked} onToggle={onToggle} open={open} setOpen={setOpen}>

      <div style={{ margin: '14px 14px 0', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-card)' }}>
        {aircraftImage && (
          <img src={aircraftImage} alt={aircraftName || 'Aircraft'} style={{
            width: '100%', height: 160, objectFit: 'contain', display: 'block',
          }} />
        )}
        {(aircraftName || registration) && (
          <div style={{ padding: aircraftImage ? '8px 12px 4px' : '12px 12px 4px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '-0.1px' }}>
              {aircraftName}{aircraftName && registration ? ' · ' : ''}{registration}
            </div>
          </div>
        )}
        {fuelState && (
          <div style={{ padding: '8px 12px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 700,
                letterSpacing: '0.5px', textTransform: 'uppercase' }}>Fuel State</div>
              <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{fuelState.fobN} gal on board</div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-card-2)', overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${fuelState.tripFrac * 100}%`, background: 'var(--text-secondary)', borderRadius: '4px 0 0 4px' }} />
              <div style={{ width: `${fuelState.reqResFrac * 100}%`, background: '#FF9500' }} />
              <div style={{ flex: 1, background: 'var(--ok)', opacity: fuelState.extraFrac > 0 ? 1 : 0, borderRadius: '0 4px 4px 0' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
              {[
                { color: 'var(--text-secondary)', label: `Trip · ${fuelState.fuelRequired?.toFixed(1)} gal` },
                { color: '#FF9500',               label: `Reserve · ${fuelState.reserveFuelGal?.toFixed(1)} gal` },
                { color: 'var(--ok)',              label: `Extra · ${fuelState.extraGal?.toFixed(1)} gal` },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '14px 14px 4px' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.2px' }}>Checklist</span>
      </div>

      {/* Documents: CARROW. This is the per-flight question — are the papers
          in the aircraft today — so it belongs here rather than in the
          aircraft's own record. The Hangar used to carry a second copy of
          this same list; that one is gone, and 'Insurance current' came
          across with it so nothing was lost in the move. */}
      <GroupRowComp
        title="Aircraft Documents Onboard"
        ids={['ac-crew','ac-airworth','ac-reg','ac-radio','ac-oplim','ac-wb','ac-insurance']}
        isCurrencyCompleted={isCurrencyCompleted} checkedIds={checkedIds}>

        <CheckRow id="ac-crew"      label="C: Crew documents (license · photo ID · medical)" far />
        <CheckRow id="ac-airworth"  label="A: Certificate of Airworthiness" far />
        <CheckRow id="ac-reg"       label="R: Certificate of Registration" far />
        <CheckRow id="ac-radio"     label="R: Radio License (FCC / international)" far />
        <CheckRow id="ac-oplim"     label="O: Operating Limitations (AFM / POH)" far />
        <CheckRow id="ac-wb"        label="W: Weight & Balance data" far />
        <CheckRow id="ac-insurance" label="Insurance current" />
      </GroupRowComp>

      {/* The maintenance block that used to sit here — annual, 100-hr, oil,
          ELT, transponder, pitot-static, ADs — now lives in the Hangar with
          the aircraft it describes. Due dates are a property of the
          aeroplane, not of today's flight, and the Hangar's copy is the one
          that persists and feeds the IM AIRWORTHY status. */}

      {/* Fuel & Equipment */}
      <GroupRowComp
        title="Fuel & Equipment"
        ids={['ac-fuel-req','ac-extra-oil','ac-charts-cur']}
        isCurrencyCompleted={isCurrencyCompleted} checkedIds={checkedIds}>

        <CheckRow id="ac-fuel-req"   label="Fuel meets VFR / IFR reserve requirements" />
        <CheckRow id="ac-extra-oil"  label="Extra oil aboard" />
        <CheckRow id="ac-charts-cur" label="Charts current and aboard" />
      </GroupRowComp>

      <DoneButton
        isChecked={isChecked}
        onDone={() => { if (!isChecked) onToggle(item.id); setOpen(false) }}
        checkedIds={checkedIds}
        subIds={subIds}
        autoCheck onAutoComplete={() => onToggle(item.id)}
      />
    </ExpandableCard>
  )
}
