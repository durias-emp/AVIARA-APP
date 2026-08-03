import { useEffect, useState } from 'react'
import { IconChevronLeft } from './Icons'
import { fetchProcedureChartImages } from '../lib/procedureCharts'

// Full-screen chart view, opened from AirportInfo's Procedures tab. Claims
// the back gesture via useBackOverride in the parent (AirportInfo itself
// already renders inside a CardOverlay) rather than being a second overlay
// of its own — an edge-swipe here should return to the Procedures list, not
// close the whole Airports card.
//
// Unlike AirportDiagram's silent-degrade-to-fallback convention, a fetch
// failure here gets a real, visible error + retry — this screen's entire
// purpose is the chart the pilot just tapped, not a background enhancement.
export default function ProcedureChartViewer({ icao, cycle, chartName, pdfName, onBack }) {
  const [images, setImages] = useState(undefined) // undefined=loading, array=loaded, null=error
  const [error, setError] = useState(null)

  function load() {
    setImages(undefined)
    setError(null)
    fetchProcedureChartImages(icao, cycle, pdfName)
      .then(setImages)
      .catch(err => { setImages(null); setError(err.message) })
  }

  useEffect(load, [icao, cycle, pdfName])

  return (
    <div style={{ minHeight: '100dvh', boxSizing: 'border-box' }}>
      <div style={{ padding: '20px 20px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} aria-label="Back" style={{
          width: 36, height: 36, borderRadius: '50%', border: '0.5px solid var(--border)',
          background: 'var(--bg-card)', boxShadow: 'var(--shadow-sm)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text)', flexShrink: 0,
        }}><IconChevronLeft size={18} /></button>
        <h2 style={{
          fontSize: 17, fontWeight: 700, letterSpacing: '-0.2px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>{chartName}</h2>
      </div>

      <div style={{ padding: '0 18px 40px' }}>
        {images === undefined && (
          <div style={{ textAlign: 'center', padding: '60px 16px', color: 'var(--text-tertiary)', fontSize: 14 }}>
            Loading chart…
          </div>
        )}
        {images === null && (
          <div style={{ textAlign: 'center', padding: '60px 16px' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>
              Couldn't load this chart{error ? ` — ${error}` : ''}. Check your connection and try again.
            </p>
            <button
              onClick={load}
              style={{
                padding: '11px 20px', borderRadius: 'var(--r-sm)', border: 'none',
                background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >Retry</button>
          </div>
        )}
        {Array.isArray(images) && images.map((src, i) => (
          <img
            key={i} src={src} alt={`${chartName} page ${i + 1}`}
            style={{ width: '100%', display: 'block', borderRadius: 12, marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}
          />
        ))}
        {Array.isArray(images) && (
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', padding: '8px 8px 0', lineHeight: 1.5 }}>
            For reference and planning — confirm currency against an official source before flight.
          </p>
        )}
      </div>
    </div>
  )
}
