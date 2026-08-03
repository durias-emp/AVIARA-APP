// POH performance chart configs and interpolation.
//
// The only source of a chart is a user-entered (or, in a later phase,
// AI-extracted-then-user-confirmed) chart saved on the aircraft profile
// (`profile.perfConfig[chartType]`). Same "never guess" convention as
// lib/aircraftWB.js: an aircraft without a digitized chart for a given
// performance figure has no chart at all (getPerfChart returns null) rather
// than a fabricated one — callers fall back to their own flat-value path.
//
// One generic 2D grid shape covers every chart type (takeoff distance,
// landing distance, climb, cruise) — the interpolation math is identical
// across all of them, only axis semantics and output count differ (cruise
// needs {tas, ff} per cell; the others need a single number). See the
// PerfChart shape below.
//
// PerfChart = {
//   axis1: { label, unit, values: number[] },  // sorted ascending — e.g. Pressure Altitude (ft)
//   axis2: { label, unit, values: number[] },  // e.g. OAT (°C), or RPM/%power for cruise
//   outputs: [{ key, label, unit }],           // e.g. [{key:'dist',...}] or [{key:'tas',...},{key:'ff',...}]
//   cells: (number|object)[][],                // cells[i][j] for axis1.values[i]/axis2.values[j];
//                                               // object keyed by output.key when outputs.length > 1
//   baselineWeight: number|null,
//   notes: string,
//   source: string,
// }

// Fixed per-chart-type metadata — axis1/axis2 default labels and the output
// fields that chart produces. Outputs aren't user-configurable in Phase 2a
// (keeps the entry UI to "fill in a grid," not "design your own schema");
// cruise is the one chart with two outputs per cell (TAS and fuel flow),
// everything else is a single value.
export const CHART_TYPES = {
  // Ground roll + over-50ft as two outputs on ONE chart, not two separate
  // charts — matches how the existing Distances checklist item (PerfDistItem
  // in Performance.jsx) already treats them: a single POH page's takeoff/
  // landing table always gives both figures together at the same PA/OAT cell.
  takeoff: { label: 'Takeoff Distance', axis1: { label: 'Pressure Altitude', unit: 'ft' }, axis2: { label: 'OAT', unit: '°C' }, outputs: [{ key: 'groundRoll', label: 'Ground Roll', short: 'GR', unit: 'ft' }, { key: 'over50', label: 'Over 50ft', short: '50ft', unit: 'ft' }] },
  landing: { label: 'Landing Distance', axis1: { label: 'Pressure Altitude', unit: 'ft' }, axis2: { label: 'OAT', unit: '°C' }, outputs: [{ key: 'groundRoll', label: 'Ground Roll', short: 'GR', unit: 'ft' }, { key: 'over50', label: 'Over 50ft', short: '50ft', unit: 'ft' }] },
  climb:   { label: 'Climb Performance', axis1: { label: 'Pressure Altitude', unit: 'ft' }, axis2: { label: 'OAT', unit: '°C' }, outputs: [{ key: 'value', label: 'Rate of Climb', short: 'ROC', unit: 'fpm' }] },
  cruise:  { label: 'Cruise Performance', axis1: { label: 'Pressure Altitude', unit: 'ft' }, axis2: { label: 'RPM / % Power', unit: '' }, outputs: [{ key: 'tas', label: 'TAS', short: 'TAS', unit: 'kt' }, { key: 'ff', label: 'Fuel Flow', short: 'FF', unit: 'GPH' }] },
}

export function createEmptyChart(chartType) {
  const meta = CHART_TYPES[chartType]
  return {
    axis1: { ...meta.axis1, values: [] },
    axis2: { ...meta.axis2, values: [] },
    outputs: meta.outputs,
    cells: [],
    baselineWeight: null,
    notes: '',
    source: '',
  }
}

function num(v) {
  const n = parseFloat(v)
  return isFinite(n) ? n : null
}

// ── Normalize a user-entered chart into calculation-ready shape ───────────────
// Returns null if the chart is absent. Does NOT validate completeness — call
// validatePerfChart() before trusting it. Never invents a value that wasn't
// entered.
export function normalizeUserPerfChart(chart) {
  if (!chart) return null

  const axis1Values = (chart.axis1?.values ?? []).map(num).filter(v => v != null)
  const axis2Values = (chart.axis2?.values ?? []).map(num).filter(v => v != null)
  const outputs = (chart.outputs ?? []).filter(o => o?.key)
  const multiOutput = outputs.length > 1

  const cells = (chart.cells ?? []).map(row =>
    (row ?? []).map(cell => {
      if (cell == null) return null
      if (multiOutput) {
        const out = {}
        for (const o of outputs) out[o.key] = num(cell?.[o.key])
        return out
      }
      return num(cell)
    })
  )

  return {
    axis1: { label: chart.axis1?.label || '', unit: chart.axis1?.unit || '', values: axis1Values },
    axis2: { label: chart.axis2?.label || '', unit: chart.axis2?.unit || '', values: axis2Values },
    outputs: outputs.length ? outputs : [{ key: 'value', label: chart.outputs?.[0]?.label || 'Value', unit: chart.outputs?.[0]?.unit || '' }],
    cells,
    baselineWeight: num(chart.baselineWeight),
    notes: (chart.notes ?? '').trim(),
    source: (chart.source ?? '').trim(),
  }
}

// ── Validate a normalized chart is complete enough to interpolate ─────────────
export function validatePerfChart(chart) {
  if (!chart) return false
  if (!(chart.axis1?.values?.length >= 2)) return false
  if (!(chart.axis2?.values?.length >= 2)) return false
  if (!(chart.cells?.length === chart.axis1.values.length)) return false
  if (!chart.cells.every(row => row?.length === chart.axis2.values.length)) return false
  const hasAnyCell = chart.cells.some(row => row.some(c => c != null && (typeof c === 'number' || Object.values(c).some(v => v != null))))
  return hasAnyCell
}

// ── Resolve a chart for an aircraft profile ────────────────────────────────────
// chartType: 'takeoff' | 'landing' | 'climb' | 'cruise'
export function getPerfChart(profile, chartType) {
  if (!profile) return null
  const chart = normalizeUserPerfChart(profile.perfConfig?.[chartType])
  if (chart && validatePerfChart(chart)) return chart
  return null
}

function bracket(values, x) {
  // Returns [loIdx, hiIdx, frac] such that x is frac of the way from
  // values[loIdx] to values[hiIdx]. Null if x is outside the axis range —
  // this module never extrapolates.
  if (x < values[0] || x > values[values.length - 1]) return null
  let hi = values.findIndex(v => v >= x)
  if (hi === 0) return [0, 0, 0]
  const lo = hi - 1
  const span = values[hi] - values[lo]
  const frac = span === 0 ? 0 : (x - values[lo]) / span
  return [lo, hi, frac]
}

function cellValue(cell, key) {
  if (cell == null) return null
  return typeof cell === 'number' ? cell : cell[key]
}

// ── 2D bilinear interpolation ──────────────────────────────────────────────────
// x/y are values on axis1/axis2. Returns { [outputKey]: number } or null if
// (x, y) falls outside the chart's axis range, or any of the 4 bracketing
// cells needed is missing.
export function interpolateChart(chart, x, y) {
  if (!chart || x == null || y == null || isNaN(x) || isNaN(y)) return null
  const b1 = bracket(chart.axis1.values, x)
  const b2 = bracket(chart.axis2.values, y)
  if (!b1 || !b2) return null
  const [i0, i1, fx] = b1
  const [j0, j1, fy] = b2

  const result = {}
  for (const { key } of chart.outputs) {
    const c00 = cellValue(chart.cells[i0]?.[j0], key)
    const c10 = cellValue(chart.cells[i1]?.[j0], key)
    const c01 = cellValue(chart.cells[i0]?.[j1], key)
    const c11 = cellValue(chart.cells[i1]?.[j1], key)
    if (c00 == null || c10 == null || c01 == null || c11 == null) return null
    const top = c00 + (c10 - c00) * fx
    const bot = c01 + (c11 - c01) * fx
    result[key] = top + (bot - top) * fy
  }
  return result
}

// ── Random-cell picker for the AI-extraction spot-check flow (Phase 2b) ───────
// Picks up to n distinct populated cells at random, returned as
// [{ i, j, axis1Value, axis2Value }]. Pure/deterministic given a seeded
// caller — no randomness needed at the data-model layer beyond Math.random,
// since this is a UI convenience, not a security or calculation concern.
export function pickRandomVerificationCells(chart, n = 3) {
  if (!chart) return []
  const populated = []
  chart.cells.forEach((row, i) => row.forEach((cell, j) => {
    if (cell != null && (typeof cell === 'number' || Object.values(cell).some(v => v != null))) {
      populated.push({ i, j, axis1Value: chart.axis1.values[i], axis2Value: chart.axis2.values[j] })
    }
  }))
  for (let i = populated.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[populated[i], populated[j]] = [populated[j], populated[i]]
  }
  return populated.slice(0, n)
}
