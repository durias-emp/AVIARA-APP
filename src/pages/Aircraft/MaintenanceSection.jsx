// The aircraft's maintenance schedule.
//
// One list, grouped by how urgent each item is, every figure computed at
// render time against the aircraft's own counters. Nothing here writes to an
// item except logging compliance, which is the only thing that should move a
// due value.
//
// This is a planning aid, not the aircraft's maintenance record. The record is
// the logbooks and the signature of the person who did the work; this mirrors
// them so a pilot can see what is coming without opening the books, and the
// footer says so rather than leaving it implied.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadItems, loadLog, logCompliance, seedFromFixture } from '../../lib/maintenanceStore'
import { STATUS, STATUS_LABEL, summarise } from '../../lib/maintenanceStatus'

const TONE = {
  [STATUS.OVERDUE]: { fg: '#FF3B30', bg: 'rgba(255,59,48,0.14)' },
  [STATUS.DUE_SOON]: { fg: '#FF9500', bg: 'rgba(255,149,0,0.14)' },
  [STATUS.OK]: { fg: '#34C759', bg: 'rgba(52,199,89,0.13)' },
  [STATUS.UNKNOWN]: { fg: 'var(--text-secondary)', bg: 'var(--bg-card-2)' },
  [STATUS.ON_CONDITION]: { fg: 'var(--text-secondary)', bg: 'var(--bg-card-2)' },
  [STATUS.NOT_APPLICABLE]: { fg: 'var(--text-tertiary)', bg: 'var(--bg-card-2)' },
}

const fmtHours = (n) => (n == null ? null : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs`)
const fmtCycles = (n) => (n == null ? null : `${n.toLocaleString()} cyc`)
const fmtDays = (n) => {
  if (n == null) return null
  if (n < 0) return `${Math.abs(n)} days ago`
  if (n === 0) return 'today'
  if (n < 45) return `${n} days`
  return `${Math.round(n / 30.4)} months`
}

// The clock that runs out first, in its own words. Every clock is still shown
// when the item is opened; this is the one line the closed row gets.
function bindingClock(item) {
  const parts = []
  if (item.hoursLeft != null) parts.push({ v: item.hoursLeft / 1.5, s: fmtHours(item.hoursLeft) })
  if (item.cyclesLeft != null) parts.push({ v: item.cyclesLeft / 3, s: fmtCycles(item.cyclesLeft) })
  if (item.daysLeft != null) parts.push({ v: item.daysLeft, s: fmtDays(item.daysLeft) })
  if (!parts.length) return null
  return parts.sort((a, b) => a.v - b.v)[0].s
}

function Pill({ status, children }) {
  const tone = TONE[status] ?? TONE[STATUS.UNKNOWN]
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.2px',
      color: tone.fg, background: tone.bg, padding: '3px 7px', borderRadius: 6,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>{children}</span>
  )
}

function Clock({ label, value, sub }) {
  if (value == null) return null
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.3px' }}>{value}</div>
      <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.3px' }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Item({ item, onComply }) {
  const [open, setOpen] = useState(false)
  const tone = TONE[item.status] ?? TONE[STATUS.UNKNOWN]
  const clock = bindingClock(item)
  const dimmed = item.status === STATUS.NOT_APPLICABLE

  return (
    // No rule between rows. Sixteen of them stacked turned the overdue group
    // into a table, and a line every forty pixels competes with the one thing
    // on each row that is actually red. The gap does the separating; the
    // padding grew a little to take over the work the line was doing.
    <div style={{ opacity: dimmed ? 0.55 : 1 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', background: 'none', border: 'none', cursor: 'pointer',
        padding: '13px 14px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: 'inherit',
      }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{item.description}</span>
          <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {[item.itemNumber, item.category, item.isRetirement ? 'life-limited' : null]
              .filter(Boolean).join(' · ')}
          </span>
        </span>
        {clock && <Pill status={item.status}>{clock}</Pill>}
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
            <Clock label="HOURS" value={item.hoursLeft != null ? fmtHours(item.hoursLeft) : null}
              sub={item.dueAtHours != null ? `due at ${item.dueAtHours.toLocaleString()}` : null} />
            <Clock label="CYCLES" value={item.cyclesLeft != null ? fmtCycles(item.cyclesLeft) : null}
              sub={item.dueAtCycles != null ? `due at ${item.dueAtCycles.toLocaleString()}` : null} />
            <Clock label="CALENDAR" value={item.daysLeft != null ? fmtDays(item.daysLeft) : null}
              sub={item.dueDate ?? null} />
          </div>

          {/* Why a clock could not be read. Naming the missing counter is the
              difference between "we do not know" and "it is fine". */}
          {item.unreadable?.length > 0 && (
            <div style={{ fontSize: 11.5, color: '#FF9500', marginBottom: 10 }}>
              No {item.unreadable.join(' or ')} recorded for this aircraft, so this cannot be worked out.
            </div>
          )}

          {(item.reference || item.partNumber || item.serialNumber) && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
              {item.reference && <div>{item.reference}</div>}
              {(item.partNumber || item.serialNumber) && (
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {[item.partNumber && `P/N ${item.partNumber}`, item.serialNumber && `S/N ${item.serialNumber}`]
                    .filter(Boolean).join('   ')}
                </div>
              )}
            </div>
          )}

          {item.lastCompliedDate && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 10 }}>
              Last done {item.lastCompliedDate}
              {item.lastCompliedHours != null ? ` at ${item.lastCompliedHours.toLocaleString()} hrs` : ''}
            </div>
          )}

          {item.notes && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 10 }}>{item.notes}</div>
          )}

          {/* Nothing to comply with on an item that is on condition or does
              not apply, so no button that would do nothing. */}
          {item.status !== STATUS.ON_CONDITION && item.status !== STATUS.NOT_APPLICABLE && (
            <button onClick={() => onComply(item)} style={{
              width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
              background: tone.bg, color: tone.fg, fontFamily: 'inherit',
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            }}>
              {item.isRetirement ? 'Record replacement' : 'Log compliance'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Group({ status, items, onComply }) {
  const [open, setOpen] = useState(status === STATUS.OVERDUE || status === STATUS.DUE_SOON)
  if (!items.length) return null
  const tone = TONE[status] ?? TONE[STATUS.UNKNOWN]
  return (
    <div style={{
      background: 'var(--bg-card)', borderRadius: 'var(--r-lg)',
      boxShadow: 'var(--shadow-sm)', overflow: 'hidden', marginBottom: 12,
    }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', background: 'none', border: 'none', cursor: 'pointer',
        padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: 'inherit', textAlign: 'left',
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone.fg, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          {STATUS_LABEL[status]}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>{items.length}</span>
      </button>
      {/* The header keeps its own rule: it is a different kind of thing from
          the rows under it, which is exactly what the rules between the rows
          were not. */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', paddingBottom: 4 }}>
          {items.map(i => <Item key={i.id} item={i} onComply={onComply} />)}
        </div>
      )}
    </div>
  )
}

export default function MaintenanceSection({ aircraftId, registration, hobbs, cycles }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [seedNote, setSeedNote] = useState(null)
  const [complying, setComplying] = useState(null)
  const [history, setHistory] = useState([])

  // Re-read after a write. Called from an event handler, never from an effect.
  const refresh = useCallback(async () => {
    if (!aircraftId) return
    setItems(await loadItems(aircraftId))
    setHistory(await loadLog(aircraftId))
  }, [aircraftId])

  // The first load, seeding the bundled schedule if this device has none.
  //
  // Nothing is set synchronously here: the first write to state happens after
  // an await, and a guard drops the result if the aircraft changed while it
  // was in flight, so switching airframes quickly cannot leave one aircraft's
  // schedule on another's page.
  useEffect(() => {
    if (!aircraftId) return undefined
    let cancelled = false
    ;(async () => {
      const seeded = await seedFromFixture(aircraftId, registration).catch(() => ({ seeded: 0 }))
      const rows = await loadItems(aircraftId)
      const log = await loadLog(aircraftId)
      if (cancelled) return
      if (seeded.seeded) setSeedNote(`${seeded.seeded} items loaded from the ${seeded.snapshot ?? ''} sheet`.trim())
      setItems(rows)
      setHistory(log)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [aircraftId, registration])

  // Every countdown, recomputed whenever the counters move. No re-read.
  const groups = useMemo(() => summarise(items, hobbs ?? null, cycles ?? null), [items, hobbs, cycles])

  if (loading) return null

  if (!items.length) {
    return (
      <div style={{
        background: 'var(--bg-card)', borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-sm)', padding: '18px 16px',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
          No schedule for this aircraft yet
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          The maintenance sheet for {registration || 'this airframe'} has not been loaded onto this device.
          A schedule is a list of inspections and life-limited parts with the hours, cycles and dates
          each falls due at, and every countdown on this page is worked out from those against the
          airframe time above.
        </div>
      </div>
    )
  }

  const counts = [
    [STATUS.OVERDUE, groups.overdue.length],
    [STATUS.DUE_SOON, groups.dueSoon.length],
    [STATUS.OK, groups.ok.length],
  ]

  return (
    <div>
      {/* The three numbers a pilot wants before anything else. */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        {counts.map(([status, n]) => {
          const tone = TONE[status]
          return (
            <div key={status} style={{
              flex: 1, background: 'var(--bg-card)', borderRadius: 'var(--r-lg)',
              boxShadow: 'var(--shadow-sm)', padding: '12px 10px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: n ? tone.fg : 'var(--text-tertiary)', lineHeight: 1 }}>
                {n}
              </div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', marginTop: 5 }}>
                {STATUS_LABEL[status]}
              </div>
            </div>
          )
        })}
      </div>

      {seedNote && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 10 }}>{seedNote}</div>
      )}

      {hobbs == null && (
        <div style={{
          background: 'rgba(255,149,0,0.12)', color: '#FF9500', borderRadius: 10,
          padding: '10px 12px', fontSize: 11.5, lineHeight: 1.5, marginBottom: 12,
        }}>
          No airframe time recorded, so nothing measured in hours can be worked out. Set Total Airframe
          Time above and every hours-based item resolves.
        </div>
      )}

      <Group status={STATUS.OVERDUE} items={groups.overdue} onComply={setComplying} />
      <Group status={STATUS.DUE_SOON} items={groups.dueSoon} onComply={setComplying} />
      <Group status={STATUS.UNKNOWN} items={groups.unknown} onComply={setComplying} />
      <Group status={STATUS.OK} items={groups.ok} onComply={setComplying} />
      <Group status={STATUS.ON_CONDITION} items={groups.onCondition} onComply={setComplying} />
      <Group status={STATUS.NOT_APPLICABLE} items={groups.notApplicable} onComply={setComplying} />

      {complying && (
        <ComplianceForm
          item={complying}
          hobbs={hobbs}
          cycles={cycles}
          onCancel={() => setComplying(null)}
          onSaved={async () => { setComplying(null); await refresh() }}
        />
      )}

      <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', lineHeight: 1.6, marginTop: 4 }}>
        A planning aid, not the aircraft record. The logbooks and the signature of the person who did
        the work are what count.{history.length ? ` ${history.length} compliance entries recorded here.` : ''}
      </div>
    </div>
  )
}

// Logging compliance, or recording a replacement.
//
// The two are different events and the form says which one it is. An
// inspection rolls the same item forward by its interval. A life-limited part
// is replaced by a DIFFERENT part, so the form asks what went on and how much
// time it already has, and the new life is counted from that rather than
// handing the old serial number another full one.
function ComplianceForm({ item, hobbs, cycles, onCancel, onSaved }) {
  const today = new Date().toISOString().slice(0, 10)
  const [workOrder, setWorkOrder] = useState('')
  const [date, setDate] = useState(today)
  const [hours, setHours] = useState(hobbs != null ? String(hobbs) : '')
  const [cyc, setCyc] = useState(cycles != null ? String(cycles) : '')
  const [partNumber, setPartNumber] = useState(item.partNumber ?? '')
  const [serialNumber, setSerialNumber] = useState('')
  const [sinceNew, setSinceNew] = useState('0')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const replacing = item.isRetirement
  const field = {
    width: '100%', padding: '9px 10px', borderRadius: 9, fontSize: 13,
    background: 'var(--bg-card-2)', border: '1px solid var(--border)',
    color: 'var(--text)', fontFamily: 'inherit',
  }
  const label = { fontSize: 10.5, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4, display: 'block' }

  async function save() {
    setError(null)
    const h = hours.trim() === '' ? null : Number(hours)
    if (h != null && !Number.isFinite(h)) { setError('Airframe time must be a number'); return }
    if (replacing && !serialNumber.trim()) { setError('The serial number of the part fitted is required'); return }
    setSaving(true)
    try {
      await logCompliance(item, {
        workOrder, compliedDate: date, compliedHours: h,
        compliedCycles: cyc.trim() === '' ? null : parseInt(cyc, 10),
        notes,
        replacement: replacing
          ? {
            partNumber: partNumber.trim() || null,
            serialNumber: serialNumber.trim(),
            hoursSinceNew: Number(sinceNew) || 0,
            cyclesSinceNew: 0,
          }
          : null,
      })
      await onSaved()
    } catch (e) {
      setError(e?.message ?? 'Could not save')
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'flex-end',
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxHeight: '86%', overflowY: 'auto',
        background: 'var(--bg)', borderRadius: '18px 18px 0 0',
        padding: '18px 16px calc(var(--safe-bottom) + 18px)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
          {replacing ? 'Record replacement' : 'Log compliance'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>{item.description}</div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <span style={label}>WORK ORDER</span>
            <input style={field} value={workOrder} onChange={e => setWorkOrder(e.target.value)} placeholder="optional" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <span style={label}>DATE</span>
              <input style={field} type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <span style={label}>AIRFRAME TIME</span>
              <input style={field} inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} />
            </div>
          </div>
          {item.dueAtCycles != null && (
            <div>
              <span style={label}>CYCLES</span>
              <input style={field} inputMode="numeric" value={cyc} onChange={e => setCyc(e.target.value)} />
            </div>
          )}

          {replacing && (
            <>
              <div style={{
                background: 'rgba(255,149,0,0.12)', color: '#FF9500', borderRadius: 9,
                padding: '10px 12px', fontSize: 11.5, lineHeight: 1.5,
              }}>
                This is a life-limited part. It is not overhauled back to zero: the part that comes off
                is finished and a different one goes on, so the life below is counted from the fitted
                part's own time in service.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <span style={label}>PART NUMBER FITTED</span>
                  <input style={field} value={partNumber} onChange={e => setPartNumber(e.target.value)} />
                </div>
                <div>
                  <span style={label}>SERIAL FITTED</span>
                  <input style={field} value={serialNumber} onChange={e => setSerialNumber(e.target.value)} />
                </div>
              </div>
              <div>
                <span style={label}>HOURS ALREADY ON THE FITTED PART</span>
                <input style={field} inputMode="decimal" value={sinceNew} onChange={e => setSinceNew(e.target.value)} />
              </div>
            </>
          )}

          <div>
            <span style={label}>NOTES</span>
            <textarea style={{ ...field, minHeight: 60, resize: 'vertical' }} value={notes}
              onChange={e => setNotes(e.target.value)} />
          </div>

          {error && <div style={{ fontSize: 12, color: '#FF3B30' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onCancel} style={{
              flex: 1, padding: '12px 0', borderRadius: 11, border: 'none',
              background: 'var(--bg-card-2)', color: 'var(--text)', fontFamily: 'inherit',
              fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{
              flex: 1, padding: '12px 0', borderRadius: 11, border: 'none',
              background: 'var(--text)', color: 'var(--bg)', fontFamily: 'inherit',
              fontSize: 13.5, fontWeight: 700, cursor: saving ? 'default' : 'pointer',
            }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
