import { validatePerfChart } from '../../lib/aircraftPerf'
import { Field, Chip, MiniInput, RemoveButton } from './Aircraft'

// A POH performance chart, entered as a 2D grid (axis1 rows × axis2
// columns). Structural sibling to WBSetupSection.jsx — purely
// presentational, no direct IndexedDB access, driven entirely by callback
// props, so it can be reused by both the aircraft detail view (persists
// immediately) and any future draft-based flow the same way WBSetupSection
// already is reused by the add-aircraft wizard.
//
// `highlightCells`/`verifyMode` exist now even though only the AI-photo
// extraction flow (a later phase) sets them — that flow reuses this exact
// grid for its "does your POH really show this?" spot-check instead of a
// one-off UI, so the hook needs to live here from the start.
export default function PerfChartEditor({
  chart, verifyMode = false, highlightCells = [],
  onAddAxisValue, onUpdateAxisValue, onRemoveAxisValue,
  onSetCell, onSetMeta, onConfirmCell,
}) {
  const configured = validatePerfChart(chart)
  const isHighlighted = (i, j) => verifyMode && highlightCells.some(c => c.i === i && c.j === j)

  return (<>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: -6 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
        background: configured ? 'var(--ok-light)' : 'var(--bg-card-2)',
        color: configured ? 'var(--ok)' : 'var(--text-tertiary)',
        border: configured ? 'none' : '0.5px solid var(--border)',
      }}>
        {configured ? 'Configured' : 'Not digitized'}
      </span>
    </div>

    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: -4 }}>
      Enter the values straight from this aircraft's POH performance chart — a value at each pressure
      altitude/{chart.axis2.label.toLowerCase()} combination you have data for. Leave a cell blank if
      the chart doesn't cover it; the app only interpolates within the range you've entered.
    </div>

    {/* Axis 1 values */}
    <AxisEditor
      title={`${chart.axis1.label} (${chart.axis1.unit})`}
      values={chart.axis1.values}
      onAdd={() => onAddAxisValue('axis1')}
      onUpdate={(i, v) => onUpdateAxisValue('axis1', i, v)}
      onRemove={i => onRemoveAxisValue('axis1', i)}
    />

    {/* Axis 2 values */}
    <AxisEditor
      title={`${chart.axis2.label}${chart.axis2.unit ? ` (${chart.axis2.unit})` : ''}`}
      values={chart.axis2.values}
      onAdd={() => onAddAxisValue('axis2')}
      onUpdate={(i, v) => onUpdateAxisValue('axis2', i, v)}
      onRemove={i => onRemoveAxisValue('axis2', i)}
    />

    {/* Grid */}
    {chart.axis1.values.length > 0 && chart.axis2.values.length > 0 && (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 6, minWidth: '100%' }}>
          <thead>
            <tr>
              <th style={{ minWidth: 60 }} />
              {chart.axis2.values.map((v, j) => (
                <th key={j} style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', minWidth: 78 }}>{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.axis1.values.map((rowVal, i) => (
              <tr key={i}>
                <th style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textAlign: 'right', paddingRight: 4 }}>{rowVal}</th>
                {chart.axis2.values.map((_, j) => {
                  const cell = chart.cells[i]?.[j]
                  const highlighted = isHighlighted(i, j)
                  return (
                    <td key={j} style={{
                      borderRadius: 8, padding: 3,
                      background: highlighted ? 'var(--accent-light, rgba(10,132,255,0.12))' : 'transparent',
                      border: highlighted ? '1px solid var(--accent)' : 'none',
                    }}>
                      {chart.outputs.map(out => (
                        <div key={out.key} style={{ marginBottom: chart.outputs.length > 1 ? 3 : 0 }}>
                          <MiniInput
                            value={(chart.outputs.length > 1 ? cell?.[out.key] : cell) ?? ''}
                            onChange={v => onSetCell(i, j, chart.outputs.length > 1 ? out.key : null, v)}
                            placeholder={out.label}
                          />
                        </div>
                      ))}
                      {highlighted && (
                        <button onClick={() => onConfirmCell?.(i, j)} style={{
                          width: '100%', marginTop: 3, padding: '4px 0', borderRadius: 6, border: 'none',
                          background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 9, fontWeight: 700,
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}>
                          Matches POH ✓
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {chart.outputs.length > 1 && (
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6 }}>
            Each cell: {chart.outputs.map(o => o.label).join(' / ')}
          </div>
        )}
      </div>
    )}

    {/* Meta */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <Field label="Chart Baseline Weight (lb), optional" type="number" value={chart.baselineWeight ?? ''}
        onChange={v => onSetMeta('baselineWeight', v)} placeholder="2550" />
      <Field label="Source" value={chart.source ?? ''}
        onChange={v => onSetMeta('source', v)} placeholder="POH Rev 3, p. 5-12" />
    </div>
    <div>
      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 }}>
        Notes (correction factors printed on the chart, conditions, etc.)
      </label>
      <textarea
        value={chart.notes ?? ''}
        onChange={e => onSetMeta('notes', e.target.value)}
        rows={2}
        placeholder="e.g. Flaps up, paved level dry runway, full power before brake release"
        style={{
          width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 'var(--r-sm)',
          border: 'none', background: 'var(--bg-card-2)', color: 'var(--text)', fontSize: 13,
          fontFamily: 'inherit', lineHeight: 1.4, outline: 'none', boxSizing: 'border-box',
        }}
      />
    </div>
  </>)
}

function AxisEditor({ title, values, onAdd, onUpdate, onRemove }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {values.map((v, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2, width: 90 }}>
            <MiniInput value={v} onChange={val => onUpdate(i, val)} placeholder="0" />
            <RemoveButton onClick={() => onRemove(i)} />
          </div>
        ))}
      </div>
      <Chip label="+ Add Value" onClick={onAdd} accent />
    </div>
  )
}
