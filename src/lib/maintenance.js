import { supabase } from './supabase'

/* Writes for the maintenance schedule. Reads live in useMaintenanceItems. */

async function currentUserId() {
  const { data } = await supabase.auth.getSession()
  const uid = data.session?.user?.id
  if (!uid) throw new Error('Sign in to record maintenance')
  return uid
}

const numOrNull = v => {
  if (v === '' || v == null) return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const intOrNull = v => {
  if (v === '' || v == null) return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

/* Add a scheduled item to an aircraft.

   Absolute due values are what the status engine reads, but a mechanic thinks
   in intervals — "every 100 hours from the last one at 1,150". So when a due
   value is left blank and both an interval and a last-compliance figure are
   given, the first due point is derived rather than demanded twice. */
export async function createMaintenanceItem(aircraftId, form) {
  const owner_id = await currentUserId()

  const hoursInterval = numOrNull(form.hours_interval)
  const monthsInterval = intOrNull(form.calendar_interval_months)
  const cyclesInterval = intOrNull(form.cycles_interval)
  const lastHours = numOrNull(form.last_complied_hours)
  const lastCycles = intOrNull(form.last_complied_cycles)
  const lastDate = form.last_complied_date || null

  let dueAtHours = numOrNull(form.due_at_hours)
  if (dueAtHours == null && hoursInterval != null && lastHours != null) {
    dueAtHours = Math.round((lastHours + hoursInterval) * 10) / 10
  }

  let dueAtCycles = intOrNull(form.due_at_cycles)
  if (dueAtCycles == null && cyclesInterval != null && lastCycles != null) {
    dueAtCycles = lastCycles + cyclesInterval
  }

  let dueDate = form.due_date || null
  if (!dueDate && monthsInterval != null && lastDate) {
    const d = new Date(lastDate + 'T12:00:00')
    if (!isNaN(d)) {
      d.setMonth(d.getMonth() + monthsInterval)
      dueDate = d.toISOString().slice(0, 10)
    }
  }

  const { error } = await supabase.from('maintenance_items').insert({
    owner_id,
    aircraft_id: aircraftId,
    description: form.description.trim(),
    item_number: form.item_number?.trim() || null,
    category: form.category || null,
    limit_type: form.limit_type || null,
    due_at_hours: dueAtHours,
    due_at_cycles: dueAtCycles,
    due_date: dueDate,
    hours_interval: hoursInterval,
    calendar_interval_months: monthsInterval,
    cycles_interval: cyclesInterval,
    last_complied_date: lastDate,
    last_complied_hours: lastHours,
    last_complied_cycles: lastCycles,
    reference: form.reference?.trim() || null,
    notes: form.notes?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

/* Record that an item was complied with.

   One RPC, not two writes: appending the audit row and rolling the item's due
   values forward have to happen together or not at all. The aircraft id is
   read from the item inside the transaction rather than sent from here — the
   client has no business asserting which aircraft a given item belongs to. */
export async function logCompliance(item, form) {
  const { error } = await supabase.rpc('log_compliance', {
    p_item_id: item.id,
    p_work_order: form.work_order_number.trim(),
    p_complied_date: form.complied_date,
    p_complied_hours: parseFloat(form.complied_hours),
    p_complied_cycles: intOrNull(form.complied_cycles),
    p_notes: form.notes?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

export async function setItemActive(itemId, isActive) {
  const { error } = await supabase
    .from('maintenance_items')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', itemId)
  if (error) throw new Error(error.message)
}

export async function loadComplianceHistory(itemId) {
  const { data, error } = await supabase
    .from('maintenance_compliance_log')
    .select('*')
    .eq('maintenance_item_id', itemId)
    .order('complied_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}
