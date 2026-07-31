import { useState } from 'react'
import { BackButton } from '../../components/Shell'
import { SegControl } from '../../components/SegControl'
import { createAircraft } from '../../lib/aircraft'
import {
  CUSTOM_BLANK, FILING_CATEGORIES,
  Section, Field, VSpeed, Chip, MiniInput, RemoveButton,
} from './Aircraft'
import TemplatePickerHero from './TemplatePickerHero'
import WBSetupSection from './WBSetupSection'

const STEPS = ['Flight Plan Info', 'Fixed Numbers', 'Weight & Balance']

// New-aircraft setup — deliberately a "draft, then commit" flow rather than
// the rest of the app's autosave-per-keystroke convention: nothing is
// written to IndexedDB until Finish, so backing out mid-setup never leaves
// a half-configured aircraft behind in the Hangar list.
export default function AddAircraftWizard({ onCancel, onDone }) {
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState({ ...CUSTOM_BLANK })
  const [saving, setSaving] = useState(false)

  function patch(section, key, value) {
    setDraft(prev => section
      ? { ...prev, [section]: { ...prev[section], [key]: value } }
      : { ...prev, [key]: value })
  }

  function selectTemplate(tpl) {
    const filingCategory = tpl.category === 'helicopter' ? 'Rotorcraft' : 'Airplane'
    setDraft(prev => ({
      ...CUSTOM_BLANK, ...tpl,
      image: tpl.image ?? null,
      registration: prev.registration ?? '',
      color: prev.color ?? '',
      filingCategory,
    }))
  }

  const isHelicopter = draft.category === 'helicopter'

  async function finish() {
    setSaving(true)
    const row = await createAircraft(draft)
    setSaving(false)
    onDone(row)
  }

  function Header() {
    return (
      <div style={{ padding: '20px 18px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton onBack={step === 0 ? onCancel : () => setStep(s => s - 1)} />
        <div>
          <h2 style={{
            fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', color: 'var(--text)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif', margin: 0,
          }}>Add Aircraft</h2>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </div>
        </div>
      </div>
    )
  }

  function FooterNav({ nextLabel = 'Next', onNext, nextDisabled }) {
    return (
      <div style={{ padding: '16px 18px 32px' }}>
        <button onClick={onNext} disabled={nextDisabled || saving} style={{
          width: '100%', padding: '13px 0', borderRadius: 'var(--r-sm)', border: 'none',
          background: nextDisabled ? 'var(--bg-card-2)' : 'var(--accent)',
          color: nextDisabled ? 'var(--text-tertiary)' : 'var(--accent-fg)',
          fontSize: 15, fontWeight: 700, cursor: nextDisabled ? 'default' : 'pointer', fontFamily: 'inherit',
        }}>
          {saving ? '…' : nextLabel}
        </button>
      </div>
    )
  }

  if (step === 0) {
    return (
      <div key={step} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <Header />
        <div style={{ padding: '16px 18px 0', flex: 1 }}>
          <TemplatePickerHero selectedId={draft.id === 'custom' && !draft.fullName ? undefined : draft.id} onSelect={selectTemplate} />

          <div style={{ marginTop: 20, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Flight plan category
            </div>
            <SegControl options={FILING_CATEGORIES} value={draft.filingCategory ?? 'Airplane'}
              onChange={v => patch(null, 'filingCategory', v)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Aircraft type" value={draft.fullName ?? ''}
              onChange={v => patch(null, 'fullName', v)} placeholder="e.g. Cessna 172S" colSpan />
            <Field label="Registration" value={draft.registration ?? ''}
              onChange={v => patch(null, 'registration', v.toUpperCase())} placeholder="e.g. N4723A" />
            <Field label="Color" value={draft.color ?? ''}
              onChange={v => patch(null, 'color', v)} placeholder="e.g. White/Blue" />
          </div>
        </div>
        <FooterNav onNext={() => setStep(1)} nextDisabled={!draft.fullName?.trim()} />
      </div>
    )
  }

  if (step === 1) {
    return (
      <div key={step} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <Header />
        <div style={{ padding: '16px 18px 0', flex: 1 }}>
          <Section title="Dimensions">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Length" value={draft.dimensions?.length ?? ''}
                onChange={v => patch('dimensions', 'length', v)} placeholder="e.g. 27 ft 2 in" />
              <Field label="Height" value={draft.dimensions?.height ?? ''}
                onChange={v => patch('dimensions', 'height', v)} placeholder="e.g. 8 ft 11 in" />
              {isHelicopter ? (
                <Field label="Rotor diameter" value={draft.dimensions?.rotorDiameter ?? ''}
                  onChange={v => patch('dimensions', 'rotorDiameter', v)} placeholder="e.g. 36 ft 1 in" />
              ) : (
                <Field label="Wingspan" value={draft.dimensions?.span ?? ''}
                  onChange={v => patch('dimensions', 'span', v)} placeholder="e.g. 36 ft 1 in" />
              )}
              <Field label="Cabin width" value={draft.dimensions?.cabinWidth ?? ''}
                onChange={v => patch('dimensions', 'cabinWidth', v)} placeholder="e.g. 40 in" />
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(draft.dimensions?.extra ?? []).map(d => (
                <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <MiniInput value={d.label} onChange={v => patch('dimensions', 'extra',
                    (draft.dimensions?.extra ?? []).map(x => x.id === d.id ? { ...x, label: v } : x))} placeholder="Label" />
                  <MiniInput value={d.value} onChange={v => patch('dimensions', 'extra',
                    (draft.dimensions?.extra ?? []).map(x => x.id === d.id ? { ...x, value: v } : x))} placeholder="Value" />
                  <RemoveButton onClick={() => patch('dimensions', 'extra',
                    (draft.dimensions?.extra ?? []).filter(x => x.id !== d.id))} />
                </div>
              ))}
              <Chip label="+ Add dimension" onClick={() => patch('dimensions', 'extra',
                [...(draft.dimensions?.extra ?? []), { id: 'dim-' + Date.now(), label: '', value: '' }])} />
            </div>
          </Section>

          <Section title="Weights">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Basic Empty Weight" value={draft.weights?.bew ?? ''}
                onChange={v => patch('weights', 'bew', v)} placeholder="e.g. 1,663 lb" />
              <Field label="Max Takeoff Weight" value={draft.weights?.mtow ?? ''}
                onChange={v => patch('weights', 'mtow', v)} placeholder="e.g. 2,550 lb" />
            </div>
          </Section>

          <Section title="V-Speeds">
            {isHelicopter ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <VSpeed label="Vne  Never exceed" value={draft.vspeeds?.vne ?? ''} onChange={v => patch('vspeeds', 'vne', v)} />
                <VSpeed label="Vy   Best climb" value={draft.vspeeds?.vy ?? ''} onChange={v => patch('vspeeds', 'vy', v)} />
                <VSpeed label="Vx   Best angle" value={draft.vspeeds?.vx ?? ''} onChange={v => patch('vspeeds', 'vx', v)} />
                <VSpeed label="Autorotation" value={draft.vspeeds?.auto ?? ''} onChange={v => patch('vspeeds', 'auto', v)} />
                <VSpeed label="Cruise TAS" value={draft.vspeeds?.cruise ?? ''} onChange={v => patch('vspeeds', 'cruise', v)} />
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <VSpeed label="Vs  Stall clean" value={draft.vspeeds?.vs ?? ''} onChange={v => patch('vspeeds', 'vs', v)} />
                <VSpeed label="Vso Stall flaps" value={draft.vspeeds?.vs0 ?? ''} onChange={v => patch('vspeeds', 'vs0', v)} />
                <VSpeed label="Vr  Rotation" value={draft.vspeeds?.vr ?? ''} onChange={v => patch('vspeeds', 'vr', v)} />
                <VSpeed label="Vx  Best angle" value={draft.vspeeds?.vx ?? ''} onChange={v => patch('vspeeds', 'vx', v)} />
                <VSpeed label="Vy  Best rate" value={draft.vspeeds?.vy ?? ''} onChange={v => patch('vspeeds', 'vy', v)} />
                <VSpeed label="Vg  Best glide" value={draft.vspeeds?.vg ?? ''} onChange={v => patch('vspeeds', 'vg', v)} />
                <VSpeed label="Va  Manoeuvring" value={draft.vspeeds?.va ?? ''} onChange={v => patch('vspeeds', 'va', v)} />
                <VSpeed label="Vfe Flap extend" value={draft.vspeeds?.vfe ?? ''} onChange={v => patch('vspeeds', 'vfe', v)} />
                <VSpeed label="Vno Max struct." value={draft.vspeeds?.vno ?? ''} onChange={v => patch('vspeeds', 'vno', v)} />
                <VSpeed label="Vne Never exceed" value={draft.vspeeds?.vne ?? ''} onChange={v => patch('vspeeds', 'vne', v)} />
                <VSpeed label="Vref Approach" value={draft.vspeeds?.vref ?? ''} onChange={v => patch('vspeeds', 'vref', v)} />
                <VSpeed label="Cruise TAS" value={draft.vspeeds?.cruise ?? ''} onChange={v => patch('vspeeds', 'cruise', v)} />
              </div>
            )}
          </Section>
        </div>
        <FooterNav onNext={() => setStep(2)} />
      </div>
    )
  }

  return (
    <div key={step} style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <Header />
      <div style={{ padding: '16px 18px 0', flex: 1 }}>
        <Section title="Weight & Balance Setup">
          <WBSetupSection
            profile={draft} isHelicopter={isHelicopter}
            onPatchWB={(path, value) => {
              setDraft(prev => {
                const wb = { ...(prev.wbConfig ?? {}) }
                if (path.length === 1) wb[path[0]] = value
                else wb[path[0]] = { ...(wb[path[0]] ?? {}), [path[1]]: value }
                return { ...prev, wbConfig: wb }
              })
            }}
            onAddStation={(label = '') => setDraft(prev => ({
              ...prev, wbConfig: { ...(prev.wbConfig ?? {}), stations: [...((prev.wbConfig ?? {}).stations ?? []), { id: 'st-' + Date.now(), label, sub: '', longArm: '', latArm: '', maxWeight: '' }] },
            }))}
            onUpdateStation={(id, key, v) => setDraft(prev => ({
              ...prev, wbConfig: { ...(prev.wbConfig ?? {}), stations: ((prev.wbConfig ?? {}).stations ?? []).map(s => s.id === id ? { ...s, [key]: v } : s) },
            }))}
            onRemoveStation={id => setDraft(prev => ({
              ...prev, wbConfig: { ...(prev.wbConfig ?? {}), stations: ((prev.wbConfig ?? {}).stations ?? []).filter(s => s.id !== id) },
            }))}
            onAddPoint={(list, point) => setDraft(prev => ({
              ...prev, wbConfig: { ...(prev.wbConfig ?? {}), [list]: [...((prev.wbConfig ?? {})[list] ?? []), point] },
            }))}
            onUpdatePoint={(list, i, key, v) => setDraft(prev => ({
              ...prev, wbConfig: { ...(prev.wbConfig ?? {}), [list]: ((prev.wbConfig ?? {})[list] ?? []).map((p, pi) => pi === i ? { ...p, [key]: v } : p) },
            }))}
            onRemovePoint={(list, i) => setDraft(prev => ({
              ...prev, wbConfig: { ...(prev.wbConfig ?? {}), [list]: ((prev.wbConfig ?? {})[list] ?? []).filter((_, pi) => pi !== i) },
            }))}
          />
        </Section>
      </div>
      <FooterNav nextLabel="Finish" onNext={finish} />
    </div>
  )
}
