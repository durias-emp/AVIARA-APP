import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMaintenanceItems, STATUS } from '../../hooks/useMaintenanceItems'
import { createMaintenanceItem, logCompliance, setItemActive } from '../../lib/maintenance'

/* The maintenance schedule, ported from Diego's CNA OpsBoard package.
   His version is Tailwind; this app styles with inline objects and CSS
   variables, so the markup is rebuilt rather than copied. The logic it
   rests on — the status engine and the atomic compliance RPC — is his. */

const GROUPS = [
  { key: 'overdue',   label: 'Overdue',      tone: 'danger' },
  { key: 'dueSoon',   label: 'Due soon',     tone: 'warn' },
  { key: 'unknown',   label: 'Cannot tell',  tone: 'warn' },
  { key: 'ok',        label: 'In limits',    tone: 'ok' },
  { key: 'onCondition', label: 'On condition', tone: 'muted' },
  { key: 'notApplicable', label: 'Not applicable', tone: 'muted' },
]

const TONE = {
  danger: 'var(--danger)',
  warn: 'var(--warn)',
  ok: 'var(--ok)',
  muted: 'var(--text-tertiary)',
}

const CATEGORIES = ['periodic', 'airframe', 'engine']
const LIMIT_TYPES = [
  ['', 'Standard'],
  ['HOURS', 'Hours only'],
  ['DATE_OR_HOURS', 'Date or hours'],
  ['HOURS_AND_CYCLES', 'Hours and cycles'],
  ['ON_CONDITION', 'On condition'],
]

function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const fmtHrs = n => `${n > 0 ? '' : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`

// ── small styled primitives, matching the rest of the aircraft page ──
const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px',
  borderRadius: 8, border: '0.5px solid var(--border-strong)',
  background: 'var(--bg-card-2)', color: 'var(--text)',
  fontSize: 14, outline: 'none', fontFamily: 'inherit',
}

function MiniField({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Modal({ title, subtitle, onClose, children, footer }) {
  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, maxHeight: '88vh',
        background: 'var(--bg-card)', borderRadius: '18px 18px 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -12px 40px rgba(0,0,0,0.5)',
      }}>
        <div style={{ padding: '16px 18px 12px', borderBottom: '0.5px solid var(--border)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 3 }}>{subtitle}</div>
          )}
        </div>
        <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
        </div>
        <div style={{
          padding: '12px 18px', borderTop: '0.5px solid var(--border)',
          paddingBottom: 'max(18px, env(safe-area-inset-bottom))',
          display: 'flex', gap: 10,
        }}>
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ── The three clocks. Each is shown only when the item is governed by it,
   and an unreadable clock says so rather than showing a number derived from
   a counter nobody has entered. ── */
function Clocks({ item }) {
  const cells = []
  if (item.due_at_hours != null) {
    cells.push(['Hours', item.hrsRemaining == null
      ? 'no airframe time'
      : `${fmtHrs(item.hrsRemaining)} ${item.hrsRemaining < 0 ? 'over' : 'left'}`,
      item.hrsRemaining == null ? 'muted' : item.hrsRemaining <= 0 ? 'danger' : null])
  }
  if (item.due_at_cycles != null) {
    cells.push(['Cycles', item.cycsRemaining == null
      ? 'no cycle count'
      : `${item.cycsRemaining.toLocaleString()} ${item.cycsRemaining < 0 ? 'over' : 'left'}`,
      item.cycsRemaining == null ? 'muted' : item.cycsRemaining <= 0 ? 'danger' : null])
  }
  if (item.due_date) {
    const m = item.mthsRemaining
    cells.push(['Calendar', `${item.due_date}${m != null ? ` · ${m} mth${Math.abs(m) === 1 ? '' : 's'}` : ''}`,
      m != null && m < 0 ? 'danger' : null])
  }
  if (!cells.length) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {cells.map(([label, value, tone]) => (
        <div key={label} style={{
          flex: '1 1 30%', minWidth: 96, padding: '7px 9px', borderRadius: 8,
          background: 'var(--bg-card-2)',
        }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
            textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{label}</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2,
            color: tone ? TONE[tone] : 'var(--text)' }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function ItemRow({ item, tone, onLog, onRetire }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderRadius: 10, background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', textAlign: 'left', background: 'none', border: 'none',
        padding: '11px 13px', cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: TONE[tone], flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
            {item.description}
          </span>
          {item.item_number && (
            <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {item.item_number}{item.reference ? ` · ${item.reference}` : ''}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 13px 13px' }}>
          <Clocks item={item} />

          {item.missingCounters?.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--warn)', marginTop: 8, lineHeight: 1.5 }}>
              Not scored: no {item.missingCounters.join(' or ')} on file for this aircraft.
            </div>
          )}

          {item.last_complied_date && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
              Last done {item.last_complied_date}
              {item.last_complied_hours != null ? ` at ${item.last_complied_hours} h` : ''}
            </div>
          )}
          {item.notes && !item.notes.startsWith('TRACK:') && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
              {item.notes}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
            <button onClick={() => onLog(item)} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
              background: 'var(--text)', color: 'var(--bg)', fontFamily: 'inherit',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>Log compliance</button>
            <button onClick={() => onRetire(item)} style={{
              padding: '8px 12px', borderRadius: 8, border: '0.5px solid var(--border)',
              background: 'var(--bg-card-2)', color: 'var(--text-secondary)',
              fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
            }}>Remove</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MaintenanceSection({ aircraftId, hobbsCurrent, cyclesCurrent }) {
  const { overdue, dueSoon, ok, unknown, onCondition, notApplicable, items, loading, error, refresh } =
    useMaintenanceItems(aircraftId, hobbsCurrent, cyclesCurrent)

  const [logging, setLogging] = useState(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState(null)

  const grouped = { overdue, dueSoon, unknown, ok, onCondition, notApplicable }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function openLog(item) {
    setFormError(null)
    setForm({
      work_order_number: '',
      complied_date: todayLocal(),
      complied_hours: hobbsCurrent ?? '',
      complied_cycles: cyclesCurrent ?? '',
      notes: '',
    })
    setLogging(item)
  }

  function openAdd() {
    setFormError(null)
    setForm({ description: '', category: 'periodic', limit_type: '' })
    setAdding(true)
  }

  async function saveCompliance() {
    if (!form.work_order_number?.trim()) return setFormError('A work order number is required')
    if (!form.complied_date) return setFormError('A compliance date is required')
    if (!Number.isFinite(parseFloat(form.complied_hours))) return setFormError('Air time at compliance is required')
    setBusy(true); setFormError(null)
    try {
      await logCompliance(logging, form)
      await refresh()
      setLogging(null)
    } catch (e) { setFormError(e.message) } finally { setBusy(false) }
  }

  async function saveItem() {
    if (!form.description?.trim()) return setFormError('A description is required')
    setBusy(true); setFormError(null)
    try {
      await createMaintenanceItem(aircraftId, form)
      await refresh()
      setAdding(false)
    } catch (e) { setFormError(e.message) } finally { setBusy(false) }
  }

  async function retire(item) {
    setBusy(true)
    try { await setItemActive(item.id, false); await refresh() }
    catch (e) { setFormError(e.message) } finally { setBusy(false) }
  }

  const addBtn = (
    <button onClick={openAdd} style={{
      width: '100%', padding: '10px 0', borderRadius: 10,
      border: '1px dashed var(--border-strong)', background: 'transparent',
      color: 'var(--text-secondary)', fontFamily: 'inherit',
      fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
    }}>+ Add maintenance item</button>
  )

  if (loading) {
    return <div style={{ padding: '28px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--text-tertiary)' }}>
      Loading the schedule…
    </div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {error && (
        <div style={{
          borderRadius: 10, background: 'var(--warn-light)', border: '0.5px solid var(--warn)',
          padding: '11px 13px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
        }}>
          <strong style={{ color: 'var(--warn)' }}>Schedule unavailable.</strong> {error}.
          This is the stored schedule, not a judgement that nothing is due — treat the
          aircraft's paper record as the authority until it loads.
        </div>
      )}

      {!error && items.length === 0 && (
        <div style={{
          borderRadius: 12, background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)',
          padding: '26px 18px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>No schedule yet</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.5 }}>
            Add the inspections from this aircraft's maintenance sheet. Each one tracks
            hours, cycles and calendar time against the airframe total above.
          </div>
        </div>
      )}

      {/* Status counts */}
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          {[['overdue', 'Overdue', 'danger'], ['dueSoon', 'Due soon', 'warn'], ['ok', 'In limits', 'ok']]
            .map(([k, label, tone]) => (
              <div key={k} style={{
                flex: 1, borderRadius: 10, background: 'var(--bg-card)',
                boxShadow: 'var(--shadow-sm)', padding: '10px 8px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: TONE[tone] }}>{grouped[k].length}</div>
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>{label}</div>
              </div>
            ))}
        </div>
      )}

      {GROUPS.map(({ key, label, tone }) => grouped[key].length > 0 && (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            color: TONE[tone], marginTop: 4,
          }}>
            {label} · {grouped[key].length}
          </div>
          {grouped[key].map(item => (
            <ItemRow key={item.id} item={item} tone={tone} onLog={openLog} onRetire={retire} />
          ))}
        </div>
      ))}

      {addBtn}

      {/* ── Log compliance ── */}
      {logging && (
        <Modal
          title="Log compliance"
          subtitle={logging.description}
          onClose={() => !busy && setLogging(null)}
          footer={<>
            <button onClick={saveCompliance} disabled={busy} style={{
              flex: 1, padding: '11px 0', borderRadius: 10, border: 'none',
              background: 'var(--text)', color: 'var(--bg)', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
            }}>{busy ? 'Saving…' : 'Log compliance'}</button>
            <button onClick={() => setLogging(null)} disabled={busy} style={{
              padding: '11px 15px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
              background: 'var(--bg-card-2)', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer',
            }}>Cancel</button>
          </>}
        >
          <MiniField label="Work order number">
            <input style={inputStyle} value={form.work_order_number ?? ''} autoFocus
              onChange={e => set('work_order_number', e.target.value)} placeholder="e.g. WO-2026-014" />
          </MiniField>
          <MiniField label="Date complied">
            <input style={inputStyle} type="date" value={form.complied_date ?? ''}
              onChange={e => set('complied_date', e.target.value)} />
          </MiniField>
          <MiniField label="Air time at compliance (h)">
            <input style={inputStyle} inputMode="decimal" value={form.complied_hours ?? ''}
              onChange={e => set('complied_hours', e.target.value)} placeholder="e.g. 1250.4" />
          </MiniField>
          {logging.limit_type === 'HOURS_AND_CYCLES' && (
            <MiniField label="Cycles at compliance">
              <input style={inputStyle} inputMode="numeric" value={form.complied_cycles ?? ''}
                onChange={e => set('complied_cycles', e.target.value)} placeholder="e.g. 25900" />
            </MiniField>
          )}
          <MiniField label="Notes">
            <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={3} value={form.notes ?? ''}
              onChange={e => set('notes', e.target.value)}
              placeholder="Parts replaced, remarks, next action…" />
          </MiniField>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            This appends a permanent record and rolls the item forward by its interval.
            Compliance entries cannot be edited or deleted afterwards.
          </div>
          {formError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{formError}</div>}
        </Modal>
      )}

      {/* ── Add item ── */}
      {adding && (
        <Modal
          title="Add maintenance item"
          onClose={() => !busy && setAdding(false)}
          footer={<>
            <button onClick={saveItem} disabled={busy} style={{
              flex: 1, padding: '11px 0', borderRadius: 10, border: 'none',
              background: 'var(--text)', color: 'var(--bg)', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
            }}>{busy ? 'Saving…' : 'Add item'}</button>
            <button onClick={() => setAdding(false)} disabled={busy} style={{
              padding: '11px 15px', borderRadius: 10, border: 'none', fontFamily: 'inherit',
              background: 'var(--bg-card-2)', color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer',
            }}>Cancel</button>
          </>}
        >
          <MiniField label="Description">
            <input style={inputStyle} value={form.description ?? ''} autoFocus
              onChange={e => set('description', e.target.value)} placeholder="e.g. 100 Hour / 12 Mth. Engine" />
          </MiniField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <MiniField label="Sheet reference">
              <input style={inputStyle} value={form.item_number ?? ''}
                onChange={e => set('item_number', e.target.value)} placeholder="e.g. ENG-11" />
            </MiniField>
            <MiniField label="Category">
              <select style={inputStyle} value={form.category ?? 'periodic'}
                onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </MiniField>
          </div>
          <MiniField label="Limit type">
            <select style={inputStyle} value={form.limit_type ?? ''}
              onChange={e => set('limit_type', e.target.value)}>
              {LIMIT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </MiniField>

          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', color: 'var(--text-tertiary)', marginTop: 4 }}>
            Interval
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <MiniField label="Hours">
              <input style={inputStyle} inputMode="decimal" value={form.hours_interval ?? ''}
                onChange={e => set('hours_interval', e.target.value)} placeholder="100" />
            </MiniField>
            <MiniField label="Months">
              <input style={inputStyle} inputMode="numeric" value={form.calendar_interval_months ?? ''}
                onChange={e => set('calendar_interval_months', e.target.value)} placeholder="12" />
            </MiniField>
            <MiniField label="Cycles">
              <input style={inputStyle} inputMode="numeric" value={form.cycles_interval ?? ''}
                onChange={e => set('cycles_interval', e.target.value)} placeholder="300" />
            </MiniField>
          </div>

          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', color: 'var(--text-tertiary)', marginTop: 4 }}>
            Last complied
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <MiniField label="Date">
              <input style={inputStyle} type="date" value={form.last_complied_date ?? ''}
                onChange={e => set('last_complied_date', e.target.value)} />
            </MiniField>
            <MiniField label="Air time (h)">
              <input style={inputStyle} inputMode="decimal" value={form.last_complied_hours ?? ''}
                onChange={e => set('last_complied_hours', e.target.value)} placeholder="e.g. 1150.4" />
            </MiniField>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            Give an interval and when it was last done, and the next due point is worked
            out for you. Enter a due figure directly instead if the sheet states one.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <MiniField label="Due at (h)">
              <input style={inputStyle} inputMode="decimal" value={form.due_at_hours ?? ''}
                onChange={e => set('due_at_hours', e.target.value)} placeholder="optional" />
            </MiniField>
            <MiniField label="Due date">
              <input style={inputStyle} type="date" value={form.due_date ?? ''}
                onChange={e => set('due_date', e.target.value)} />
            </MiniField>
          </div>
          {formError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{formError}</div>}
        </Modal>
      )}
    </div>
  )
}
