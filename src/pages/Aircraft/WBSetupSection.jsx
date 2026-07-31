import { normalizeUserWBConfig, validateWBConfig } from '../../lib/aircraftWB'
import { Field, Chip, FuelDensityTag, WBStationRow, WBPointRow, weightNum } from './Aircraft'

// The Weight & Balance setup form — pulled out of Aircraft.jsx so it can be
// reused both by the aircraft detail view (persists every change immediately
// via `onPatchWB` etc., same as before) and the add-aircraft wizard (writes
// to local draft state until the wizard's own "Finish" step). Purely
// presentational: no direct IndexedDB access, no submit/done button of its
// own — the caller owns that.
export default function WBSetupSection({
  profile, isHelicopter,
  onPatchWB, onAddStation, onUpdateStation, onRemoveStation,
  onAddPoint, onUpdatePoint, onRemovePoint,
}) {
  const wbNormalized = normalizeUserWBConfig(profile.wbConfig, profile)
  const wbConfigured = validateWBConfig(wbNormalized)
  const wbStations = profile.wbConfig?.stations ?? []
  const wbLongPoints = profile.wbConfig?.longEnvelopePoints ?? []
  const wbLatPoints  = profile.wbConfig?.latEnvelopePoints ?? []
  const wbStationSuggestions = isHelicopter
    ? ['Pilot', 'Front Pax', 'Rear Pax', 'Baggage']
    : ['Pilot & Front Pax', 'Rear Pax', 'Baggage']

  return (<>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: -6 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
        background: wbConfigured ? 'var(--ok-light)' : 'var(--bg-card-2)',
        color: wbConfigured ? 'var(--ok)' : 'var(--text-tertiary)',
        border: wbConfigured ? 'none' : '0.5px solid var(--border)',
      }}>
        {wbConfigured ? 'Configured' : 'Setup incomplete'}
      </span>
    </div>

    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: -4 }}>
      Use <em>this aircraft's</em> actual POH and AFM values, not generic model numbers.
    </div>

    {!wbConfigured && (
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-card-2)', borderRadius: 10, padding: '9px 11px', lineHeight: 1.5 }}>
        Not configured yet — the Weight & Balance checklist item won't compute results until you fill in
        this aircraft's actual numbers below.
      </div>
    )}

    {/* Basic Empty Weight + Max Weight */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <Field label="Basic Empty Weight (lb)" type="number" value={profile.wbConfig?.bew?.weight ?? ''}
        onChange={v => onPatchWB(['bew', 'weight'], v)} placeholder={weightNum(profile.weights?.bew) || '1663'} />
      <Field label="Empty CG and Long Arm (in)" type="number" value={profile.wbConfig?.bew?.longArm ?? ''}
        onChange={v => onPatchWB(['bew', 'longArm'], v)} placeholder="39.3" />
      <Field label="Empty Lateral Arm (in), optional" type="number" value={profile.wbConfig?.bew?.latArm ?? ''}
        onChange={v => onPatchWB(['bew', 'latArm'], v)} placeholder="0.0" />
      <Field label="Max Takeoff and Gross Weight (lb)" type="number" value={profile.wbConfig?.maxTOW ?? ''}
        onChange={v => onPatchWB(['maxTOW'], v)} placeholder={weightNum(profile.weights?.mtow) || '2550'} />
    </div>

    {/* Fuel */}
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Fuel</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <Field label="Fuel Capacity (gal)" type="number" value={profile.wbConfig?.fuel?.maxGal ?? ''}
          onChange={v => onPatchWB(['fuel', 'maxGal'], v)} placeholder="53" />
        <Field label="Fuel Arm (in)" type="number" value={profile.wbConfig?.fuel?.longArm ?? ''}
          onChange={v => onPatchWB(['fuel', 'longArm'], v)} placeholder="48.0" />
      </div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 }}>
        Fuel Density (lb per gal)
      </label>
      <div style={{ position: 'relative' }}>
        <input type="number" step="0.1" inputMode="decimal"
          value={profile.wbConfig?.fuel?.lbPerGal ?? ''}
          onChange={e => onPatchWB(['fuel', 'lbPerGal'], e.target.value)}
          placeholder="6.0"
          style={{
            width: '100%', padding: '10px 128px 10px 12px', borderRadius: 'var(--r-sm)',
            border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
            color: 'var(--text)', fontSize: 15, outline: 'none', boxSizing: 'border-box',
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        <div style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          display: 'flex', gap: 4,
        }}>
          <FuelDensityTag label="Avgas" active={profile.wbConfig?.fuel?.lbPerGal === '6.0'}
            onClick={() => onPatchWB(['fuel', 'lbPerGal'], '6.0')} />
          <FuelDensityTag label="Jet A" active={profile.wbConfig?.fuel?.lbPerGal === '6.7'}
            onClick={() => onPatchWB(['fuel', 'lbPerGal'], '6.7')} />
        </div>
      </div>
    </div>

    {/* Loading stations */}
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
        Loading Stations
      </div>
      {wbStations.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
          Add one for each seat or compartment.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        {wbStations.map(s => (
          <WBStationRow key={s.id} station={s}
            onChange={(key, v) => onUpdateStation(s.id, key, v)}
            onRemove={() => onRemoveStation(s.id)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {wbStationSuggestions.map(label => (
          <Chip key={label} label={`+ ${label}`} onClick={() => onAddStation(label)} />
        ))}
        <Chip label="+ Add Station" onClick={() => onAddStation('')} accent />
      </div>
    </div>

    {/* Longitudinal envelope */}
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>
        Longitudinal CG Envelope
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
        From the POH CG envelope chart, at least 3 points.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {wbLongPoints.map((p, i) => (
          <WBPointRow key={i} point={p} fieldA="cg" fieldB="weight" labelA="CG (in)" labelB="Weight (lb)"
            onChange={(key, v) => onUpdatePoint('longEnvelopePoints', i, key, v)}
            onRemove={() => onRemovePoint('longEnvelopePoints', i)} />
        ))}
      </div>
      <Chip label="+ Add Point" onClick={() => onAddPoint('longEnvelopePoints', { cg: '', weight: '' })} accent />
    </div>

    {/* Lateral envelope — optional */}
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>
        Lateral CG Limits (optional, mainly helicopters)
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
        Leave empty if this aircraft doesn't track lateral CG.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {wbLatPoints.map((p, i) => (
          <WBPointRow key={i} point={p} fieldA="lat" fieldB="longCG" labelA="Lat CG (in)" labelB="Long CG (in)"
            onChange={(key, v) => onUpdatePoint('latEnvelopePoints', i, key, v)}
            onRemove={() => onRemovePoint('latEnvelopePoints', i)} />
        ))}
      </div>
      <Chip label="+ Add Point" onClick={() => onAddPoint('latEnvelopePoints', { lat: '', longCG: '' })} accent />
    </div>

    {/* Source */}
    <Field label="Source and W&B Report Date" value={profile.wbConfig?.source ?? ''}
      onChange={v => onPatchWB(['source'], v)} placeholder="POH Rev 3, dated May 1 2024" />

    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.6, textAlign: 'center', paddingTop: 4 }}>
      For planning purposes only. PIC is responsible for verifying W&amp;B against the aircraft's POH, AFM,
      and latest W&amp;B report. Use actual aircraft values, not generic model values.
    </div>
  </>)
}
