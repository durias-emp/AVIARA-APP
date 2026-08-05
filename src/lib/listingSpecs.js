// The aircraft spec sheet, as data.
//
// Shared by the form that writes it and the detail view that reads it back,
// so a field can never be captured under one label and displayed under
// another. It's also why listings.specs is jsonb: adding "Known ice" to this
// array is the entire change, with no migration against a live database.
//
// The set is what an aircraft ad actually carries — Controller and
// Trade-A-Plane list roughly this, in roughly this order, because it's the
// order a buyer asks in. Nothing here is required; a seller filling in three
// fields still gets a listing, and blank keys are stripped before storage so
// an untouched field reads as "not stated" rather than "stated as empty".

export const SPEC_SECTIONS = [
  {
    title: 'Airframe',
    fields: [
      { key: 'serial_number', label: 'Serial number', type: 'text' },
      { key: 'annual_due', label: 'Annual due', type: 'text', placeholder: 'e.g. 2027-04' },
      { key: 'logs', label: 'Logbooks', type: 'select', options: ['Complete since new', 'Complete', 'Partial', 'Unknown'] },
      { key: 'damage_history', label: 'Damage history', type: 'select', options: ['None known', 'Repaired damage', 'Disclosed on request'] },
    ],
  },
  {
    title: 'Engine',
    fields: [
      { key: 'engine_make_model', label: 'Engine make & model', type: 'text', placeholder: 'e.g. Lycoming IO-360-L2A' },
      { key: 'engine_count', label: 'Number of engines', type: 'select', options: ['1', '2', '3', '4'] },
      { key: 'smoh_hours', label: 'Since major overhaul', type: 'number', unit: 'hrs' },
      { key: 'tbo_hours', label: 'TBO', type: 'number', unit: 'hrs' },
    ],
  },
  {
    title: 'Propeller',
    fields: [
      { key: 'prop_make_model', label: 'Prop make & model', type: 'text' },
      { key: 'spoh_hours', label: 'Since prop overhaul', type: 'number', unit: 'hrs' },
    ],
  },
  {
    title: 'Avionics',
    fields: [
      { key: 'avionics', label: 'Panel', type: 'textarea', placeholder: 'GTN 750, GNS 430W, GFC 500, GTX 345…' },
      { key: 'adsb', label: 'ADS-B', type: 'select', options: ['Out', 'In and Out', 'None'] },
      { key: 'autopilot', label: 'Autopilot', type: 'text' },
      { key: 'ifr_certified', label: 'IFR certified', type: 'select', options: ['Yes', 'No'] },
      { key: 'known_ice', label: 'Known ice', type: 'select', options: ['Yes', 'No'] },
    ],
  },
  {
    title: 'Weights & capacities',
    fields: [
      { key: 'empty_weight_lbs', label: 'Empty weight', type: 'number', unit: 'lb' },
      { key: 'gross_weight_lbs', label: 'Gross weight', type: 'number', unit: 'lb' },
      { key: 'useful_load_lbs', label: 'Useful load', type: 'number', unit: 'lb' },
      { key: 'fuel_capacity_gal', label: 'Fuel capacity', type: 'number', unit: 'gal' },
      { key: 'seats', label: 'Seats', type: 'number' },
    ],
  },
  {
    title: 'Performance',
    fields: [
      { key: 'cruise_speed_kt', label: 'Cruise speed', type: 'number', unit: 'kt' },
      { key: 'range_nm', label: 'Range', type: 'number', unit: 'NM' },
      { key: 'useful_notes', label: 'Notes', type: 'text' },
    ],
  },
  {
    title: 'Condition',
    fields: [
      { key: 'exterior', label: 'Exterior', type: 'text', placeholder: 'e.g. Repainted 2019, 9/10' },
      { key: 'interior', label: 'Interior', type: 'text', placeholder: 'e.g. Original, 7/10' },
      { key: 'based_at', label: 'Based at', type: 'text', placeholder: 'e.g. CYLS' },
    ],
  },
]

// Flat lookup for rendering a stored spec sheet back out with its label and
// unit — a key with no definition still displays, humanised, rather than
// vanishing, so a spec written by an older version of the form is never
// silently dropped.
const BY_KEY = new Map(
  SPEC_SECTIONS.flatMap(s => s.fields.map(f => [f.key, { ...f, section: s.title }]))
)

export function specField(key) {
  return BY_KEY.get(key) ?? {
    key,
    label: key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()),
    type: 'text',
  }
}

// Stored specs regrouped into the sections above, skipping empty ones.
// Unknown keys land in a trailing "Other" group rather than disappearing.
export function groupSpecs(specs) {
  const entries = Object.entries(specs ?? {}).filter(([, v]) => v !== '' && v != null)
  if (!entries.length) return []

  const groups = new Map(SPEC_SECTIONS.map(s => [s.title, []]))
  const other = []
  for (const [key, value] of entries) {
    const def = BY_KEY.get(key)
    const item = { ...specField(key), value }
    if (def) groups.get(def.section).push(item)
    else other.push(item)
  }
  const out = SPEC_SECTIONS
    .map(s => ({ title: s.title, items: groups.get(s.title) }))
    .filter(g => g.items.length)
  if (other.length) out.push({ title: 'Other', items: other })
  return out
}

export function specValue(item) {
  return item.unit ? `${item.value} ${item.unit}` : String(item.value)
}
