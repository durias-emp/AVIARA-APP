# Maintenance on `strava-layout`, and how it differs from `main`

Written for James, who has a working maintenance system on `main`. This is a
complete description of the one on `strava-layout` so the two can be compared,
reconciled, or rebuilt.

Both are ports of Diego's CNA OpsBoard system. The architecture is his in both
and survives intact. The differences are storage, four corrections to the
status engine, and a compliance path for life-limited parts.

Branch: `strava-layout`. Nothing here is on `main`.

---

## 1. What is built

| | |
|---|---|
| Schedule with three clocks | yes, 118 real items for YS-CNA |
| Status engine | yes, `src/lib/maintenanceStatus.js` |
| Compliance, atomic | yes, IndexedDB transaction |
| Compliance log, append-only | yes, per item and per aircraft |
| Life-limited part replacement | yes, and this is the big one |
| Fluids, grease | no |
| Snags | no |
| Add or edit an item in the UI | no |
| Import UI | no, the import is a build-time script |

## 2. Storage: IndexedDB, not Postgres

This is the main divergence and it is deliberate.

AVIARA splits its data. Social features (posts, listings, messages, profiles)
are relational Postgres queried live. **Pilot data (aircraft, flights,
currency, checklists, settings) is IndexedDB, synced to a single `backups`
table as a JSON blob.** There is no `aircraft` table and no `flights` table in
Postgres at all.

Maintenance is pilot data. A pilot checking whether the 100-hour is due is
usually standing at the aircraft, which is exactly where there is no signal, so
a maintenance page that needs a network round trip is blank at the one moment
it is wanted.

**There is also a bug in the `main` version that this sidesteps.**
`supabase/migrations/0008_maintenance.sql` declares:

```sql
aircraft_id uuid not null,   -- local IndexedDB aircraft record
```

but `newAircraftId()` in `src/lib/aircraft.js` returns
`aircraft-1786115925057-9`, which is not a uuid, and
`createMaintenanceItem(aircraftId, form)` passes it straight into that column.
Postgres will reject it with `22P02 invalid input syntax for type uuid`. Either
the column becomes `text`, or aircraft ids become real uuids, or the id is
mapped on the way in. Worth checking against a real insert before shipping.

### Stores

`src/lib/db.js`, `DB_VERSION` bumped 8 to 9:

```js
if (oldVersion < 9) {
  ensureStore(db, 'maintenanceItems', { keyPath: 'id' })
  ensureStore(db, 'complianceLog',    { keyPath: 'id' })
}
```

Both added to `SYNCED_STORES` in `src/lib/sync.js`, so they ride the existing
cloud backup. The compliance log merges cleanly across devices because it is
append-only with unique ids: a restore only ever adds rows the device lacks.

### Atomicity without Postgres

Section 8 of Diego's handoff asks that the audit insert and the roll-forward
stay atomic when the backend is not Postgres. `db.js` gained one primitive:

```js
export async function transact(storeNames, mode, run) {
  const d = await db()
  const tx = d.transaction(storeNames, mode)
  const result = await run(tx)
  await tx.done
  return result
}
```

and `logCompliance` uses it across both stores, so neither write can happen
without the other.

## 3. Files

```
scripts/convert-maintenance-sql.js          123 lines   the import, build time
src/data/maintenance/ys-cna.json           2490 lines   118 items, converted
src/lib/maintenanceStatus.js                226 lines   the engine, pure
src/lib/maintenanceStore.js                 214 lines   IndexedDB + compliance
src/pages/Aircraft/MaintenanceSection.jsx   559 lines   the UI
src/lib/db.js                                +35        two stores, transact()
src/lib/sync.js                               +7        backup both stores
src/pages/Aircraft/Aircraft.jsx              +33        wire the button
```

### `maintenanceStatus.js` exports

`STATUS`, `STATUS_RANK`, `STATUS_LABEL`, `RETIREMENT`, `isRetirement(item)`,
`enrich(item, hobbs, cycles)`, `urgency(item)`, `summarise(items, hobbs, cycles)`

### `maintenanceStore.js` exports

`loadItems(aircraftId)`, `loadLog(aircraftId, itemId?)`, `saveItem(item)`,
`removeItem(id)`, `logCompliance(item, opts)`, `rollForward(item, opts)`,
`seedFromFixture(aircraftId, registration)`, `clearSchedule(aircraftId)`

## 4. Item shape

camelCase, converted from the export's snake_case. One row per item:

```js
{
  id, aircraftId, isActive,
  itemNumber, description, category, reference, partNumber, serialNumber,
  eventType,        // 'Inspection' | 'Overhaul' | 'Replace' | 'Retire'
  limitType,        // 'HOURS' | 'DATE' | 'DATE_OR_HOURS' | 'HOURS_AND_CYCLES' | 'ON_CONDITION'
  dueAtHours, dueAtCycles, dueDate,                        // absolute, the three clocks
  hoursInterval, calendarIntervalMonths, cyclesInterval,   // how they roll forward
  lastCompliedDate, lastCompliedHours, lastCompliedCycles,
  sourceRef, notes,
}
```

`limitType` is descriptive, not behavioural. The engine branches only on
`ON_CONDITION`; everything else falls out of which `dueAt*` fields are non
null. That is good design and worth not "fixing".

## 5. The four corrections to the engine

These are the parts most worth copying.

### 5.1 An unknown counter is not zero

The original reads `hobbsCurrent ?? 0`. An airframe with no time on file then
compares every due figure against zero, so a 100-hour inspection due at 17,510
hours reports "17,510 hours remaining" in green on an aircraft that might be
overdue. Those items are `STATUS.UNKNOWN`, labelled **Cannot tell**, and they
name the counter they are missing.

You found this one too. Keep it.

### 5.2 A due date is good through the end of that day

The original parses the due date at local noon and compares against now, so an
item due on the 31st reads expired from 1pm on the 31st.

**Do not use `calendarMonthExpiry` here**, which is the obvious fix and is
wrong. That helper returns the end of the due date's *month*, which is correct
for "within the preceding 12 calendar months" reckoned from a compliance date,
and here it would grant up to thirty days the sheet never gave. The sheet has
already done that reckoning and handed us a date.

```js
function daysUntil(dueDateStr) {
  if (!dueDateStr) return null
  const due = new Date(`${dueDateStr}T12:00:00`)   // noon: a bare date parses as UTC
  if (isNaN(due)) return null
  due.setHours(23, 59, 59, 999)
  return Math.floor((due - new Date()) / 86400000)
}
```

Due today reads 0 and is in limits. Due yesterday reads -1 and is overdue.

### 5.3 Time remaining in whole days

The original subtracts month numbers, so both the 2nd and the 30th of next
month are "1 month".

### 5.4 Retirement lives are not inspections

**This is the one that matters.** Of YS-CNA's 118 items, **40 have
`eventType: 'Retire'`**, 33 of those carry an `hoursInterval`, and 35 carry a
serial number. They are life-limited components: turbine wheels with a part
number, a serial number and a life in hours and cycles.

Diego's `log_compliance` rolls any item forward by its interval:

```sql
due_at_hours = round(p_complied_hours + hours_interval, 1)
```

For an inspection that is exactly right. For a retirement it grants **the same
physical part a second full life**, and `serial_number` is never updated, so
the audit trail still names the old part. A real example from the sheet:

> **1st Stage Wheel** · P/N `M250-10223` · S/N `X637065` · life 2,025 hrs /
> 3,000 cycles · due at 17,977.9 hrs

Press Log Compliance on that and it becomes due at complied + 2,025 with S/N
X637065 still fitted. The button is reachable for all 40: it is hidden only for
`on_condition` and `N/A` items, and these are `HOURS_AND_CYCLES` and
`DATE_OR_HOURS`.

A life-limited part is not overhauled back to zero. It is scrapped and a
**different** part goes on, with its own serial and its own remaining life,
which may not be zero.

So there are two compliance paths:

```js
// inspection: from the complied value, not the old due value
dueAtHours = compliedHours + hoursInterval

// retirement: the fitted part's own remaining life
dueAtHours = compliedHours + (hoursInterval - replacement.hoursSinceNew)
serialNumber = replacement.serialNumber
```

The UI shows "life-limited" on the row, the button says **Record replacement**
rather than Log compliance, and the form asks for the part number and serial
fitted and how many hours are already on it. The log entry records both serials:
which came off and which went on.

## 6. Compliance, and why it rolls forward from the complied value

Not from the old due value. This is Diego's decision 3 and it is right: an
inspection done fifty hours early sets the next one a hundred hours from where
the work was actually done, rather than compounding the error forever.

Verified live: the B-10 was due at 17,510.8. Complied at 17,538.9. New due
**17,638.9**, not 17,610.8.

Calendar rolls from the complied date by `calendarIntervalMonths`. A clock with
no interval keeps whatever it had, because an item due on a fixed date with no
recurrence is complied with once and is then simply done.

## 7. The import

`scripts/convert-maintenance-sql.js <03_data.sql> <out.json>` turns the
operator's Postgres export into the fixture. A script rather than by hand so a
fresh export is one command, and so the column mapping is written down once.

`seedFromFixture(aircraftId, registration)` loads it onto a device with an empty
schedule only, and refuses if the fixture's tail number does not match the
aircraft, so the sheet cannot be loaded onto a different airframe.

**Two bugs this turned up, both silent:**

**The converter dropped a row.** Its regex accepted `^ {2}\((.*?)\),?$`. Every
row but the last ends `),`; the last ends `);`. One item, a Turbine Mid Life
Inspection due at 19,021 hours, was simply missing with nothing to say so. It
now uses `\)[,;]$` and asserts the parsed count against the rows in the file,
exiting non-zero rather than writing a partial schedule.

**The seed ran twice, giving 236 items.** React mounts effects twice in
development, both runs read an empty schedule before either wrote, and
check-then-write is not atomic across two callers. Fixed with a module-level
in-flight promise:

```js
let seeding = null
export function seedFromFixture(aircraftId, registration) {
  if (seeding) return seeding
  seeding = runSeed(aircraftId, registration).finally(() => { seeding = null })
  return seeding
}
```

This is the same race, in the same shape, that `devSeed.js` had. Any
check-then-write in this app wants the guard from the start.

## 8. Thresholds

```js
const WARN_HOURS_STANDARD = 10     // matches statusFromHours on the aircraft page
const WARN_HOURS_HEAVY    = 50     // for intervals >= 1500 hrs
const HEAVY_INTERVAL_HOURS = 1500
const WARN_DAYS  = 31
const WARN_CYCLES = 100
```

Ten hours' warning on a 2,000-hour overhaul is no warning at all: it arrives
after the decision to fly the trip that runs it out.

## 9. The UI

`MaintenanceSection.jsx`, mounted on the Aircraft page under the Maintenance
button, which **replaces the rest of the page** rather than expanding within it
(the button fills when active, so the pair reads as tabs, same as `main`).

- Three counts: Overdue, Due soon, In limits
- Collapsible groups in `STATUS_RANK` order, each sorted by `urgency()`
- Closed row: description, item number, category, and the **binding clock**,
  the one running out first, in its own unit
- Open row: all three clocks with their absolute due values, reference, P/N
  and S/N, last compliance, notes, that item's history, and the compliance
  button
- Compliance log at the foot, collapsed, newest first
- Footer states plainly that this is a planning aid and the logbooks are the
  record

No rules between rows. Sixteen stacked turned the overdue group into a table
and competed with the one red figure on each row.

## 10. Current state of YS-CNA

118 items, snapshot 2026-08-06, hobbs 17,538.9, cycles 25,870.
**16 overdue, 2 due soon, 90 in limits, 6 on condition, 4 not applicable.**

## 11. If you want to reconcile the two

The engine and the store are backend-agnostic. `maintenanceStatus.js` is pure
and ports unchanged. `maintenanceStore.js` is the only file that touches
IndexedDB; swapping it for Supabase calls is the whole job, provided the
`aircraft_id` type problem in section 2 is settled first.

The corrections in section 5 apply to both implementations. 5.4 in particular
is a data-integrity problem in any backend, and it affects a third of this
aircraft's schedule.
