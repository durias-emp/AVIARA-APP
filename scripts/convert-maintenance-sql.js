#!/usr/bin/env node
// Turns the CNA OpsBoard maintenance export into the shape this app stores.
//
// The export is a Postgres INSERT: one aircraft row and 118 maintenance items
// for YS-CNA, snapshotted from the operator's own sheet. It is converted by a
// script rather than by hand so that when the sheet moves on, re-running this
// against a fresh export is the whole job, and so the mapping from their
// column names to ours is written down once and reviewable.
//
//   node scripts/convert-maintenance-sql.js <03_data.sql> <out.json>

import { readFileSync, writeFileSync } from 'node:fs'

const COLUMNS = [
  'id', 'aircraft_id', 'item_number', 'description', 'category', 'reference',
  'part_number', 'serial_number', 'event_type', 'limit_type',
  'calendar_interval_months', 'hours_interval', 'cycles_interval',
  'last_complied_date', 'last_complied_hours', 'last_complied_cycles',
  'due_date', 'due_at_hours', 'due_at_cycles', 'is_active', 'source_ref',
  'notes', 'created_at', 'updated_at',
]

// A row's fields, split on the commas that are not inside a quoted string.
function splitFields(row) {
  const out = []
  let cur = '', quoted = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (ch === "'") {
      // '' is an escaped quote inside a string, not the end of one
      if (quoted && row[i + 1] === "'") { cur += "'"; i++; continue }
      quoted = !quoted
      continue
    }
    if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

const val = (s) => (s === 'null' || s === '' ? null : s)
const num = (s) => (val(s) == null ? null : Number(s))
const int = (s) => (val(s) == null ? null : parseInt(s, 10))

const [, , sqlPath, outPath] = process.argv
if (!sqlPath || !outPath) {
  console.error('usage: convert-maintenance-sql.js <03_data.sql> <out.json>')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')

// The aircraft row, for its counters. They are what every countdown is
// measured against, so the fixture carries them and the app can tell whether
// the sheet it is showing matches the airframe it is showing it for.
const acMatch = sql.match(/insert into aircraft[^;]*?values\s*\n\s*\((.*?)\);/s)
const ac = acMatch ? splitFields(acMatch[1]) : null
const aircraft = ac
  ? { tailNumber: ac[1], makeModel: ac[2], hobbs: num(ac[3]), cycles: int(ac[5]) }
  : null

const itemsBlock = sql.slice(sql.indexOf('insert into maintenance_items'))
// `),` for every row but the last, which ends the statement with `);`. The
// first version of this accepted only the comma and silently dropped the final
// item: a Turbine Mid Life Inspection, gone from the schedule with nothing to
// say it had been. A converter that loses a row without complaining is worse
// than one that crashes, so the count is asserted below.
const rows = [...itemsBlock.matchAll(/^ {2}\((.*?)\)[,;]$/gm)].map(m => m[1])

const items = rows.map(r => {
  const f = splitFields(r)
  const g = (name) => f[COLUMNS.indexOf(name)]
  return {
    itemNumber: val(g('item_number')),
    description: val(g('description')),
    category: val(g('category')),
    reference: val(g('reference')),
    partNumber: val(g('part_number')),
    serialNumber: val(g('serial_number')),
    eventType: val(g('event_type')),
    limitType: val(g('limit_type')),
    // the three clocks, absolute
    dueAtHours: num(g('due_at_hours')),
    dueAtCycles: int(g('due_at_cycles')),
    dueDate: val(g('due_date')),
    // the intervals they roll forward by
    hoursInterval: num(g('hours_interval')),
    calendarIntervalMonths: int(g('calendar_interval_months')),
    cyclesInterval: int(g('cycles_interval')),
    // the last service
    lastCompliedDate: val(g('last_complied_date')),
    lastCompliedHours: num(g('last_complied_hours')),
    lastCompliedCycles: int(g('last_complied_cycles')),
    sourceRef: val(g('source_ref')),
    notes: val(g('notes')),
  }
})

const active = items.filter((_, i) => splitFields(rows[i])[COLUMNS.indexOf('is_active')] !== 'false')

writeFileSync(outPath, JSON.stringify({
  aircraft,
  snapshot: '2026-08-06',
  source: 'CNA OpsBoard export, sql/03_data.sql',
  items: active,
}, null, 2) + '\n')

console.log(`aircraft: ${aircraft?.tailNumber} ${aircraft?.makeModel} ${aircraft?.hobbs} hrs / ${aircraft?.cycles} cyc`)
console.log(`items:    ${active.length}`)
const by = (k) => [...new Set(active.map(i => i[k]))].filter(Boolean).sort()
console.log(`category: ${by('category').join(', ')}`)
console.log(`limits:   ${by('limitType').join(', ')}`)
console.log(`events:   ${by('eventType').join(', ')}`)
console.log(`missing description: ${active.filter(i => !i.description).length}`)

// The export is one INSERT per row, so the number of rows in the file and the
// number of items in the fixture must agree. They did not once.
const declared = (itemsBlock.match(/^ {2}\(/gm) ?? []).length
if (declared !== items.length) {
  console.error(`\nMISMATCH: ${declared} rows in the file, ${items.length} parsed. Refusing to write a partial schedule.`)
  process.exit(1)
}
