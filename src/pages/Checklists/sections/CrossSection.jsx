// Vertical weather cross-section along the route.
//
// Departure on the left, destination on the right, altitude up the side. The
// view a pilot already has in their head when they ask "what am I flying
// through?". Plain SVG rather than a chart library: the shapes here are cloud
// shading, hazard bands and wind barbs, none of which a generic chart draws.
//
// Provenance is visual, not a footnote. Official G-AIRMET bands are solid;
// modelled indications are dashed, and the legend says which is which.

const W = 720, H = 300
const PAD = { l: 40, r: 46, t: 12, b: 26 }

function Barb({ x, y, dirDeg, kt }) {
  // Standard staff-and-feather barb. Pilots read these instantly; an arrow
  // with a number next to it makes them do arithmetic.
  const flags = []
  let remaining = Math.round(kt / 5) * 5
  let offset = 0
  while (remaining >= 50) { flags.push(['p', offset]); offset += 5; remaining -= 50 }
  while (remaining >= 10) { flags.push(['f', offset]); offset += 4; remaining -= 10 }
  if (remaining >= 5) flags.push(['h', offset])

  return (
    <g transform={`translate(${x} ${y}) rotate(${dirDeg})`} stroke="var(--text-secondary)" strokeWidth="1" fill="none">
      <line x1="0" y1="0" x2="0" y2="16" />
      {flags.map(([kind, off], i) => (
        kind === 'p'
          ? <polygon key={i} points={`0,${16 - off} 6,${18 - off} 0,${20 - off}`} fill="var(--text-secondary)" />
          : <line key={i} x1="0" y1={16 - off} x2={kind === 'f' ? 6 : 3} y2={kind === 'f' ? 19 - off : 17.5 - off} />
      ))}
      <circle cx="0" cy="0" r="1.4" fill="var(--text-secondary)" stroke="none" />
    </g>
  )
}

export default function CrossSection({ data, dep, dest, chosenAltFt }) {
  if (!data?.x?.length) return null

  const topFt = Math.max(data.maxAltFt, ...(data.terrainFt || [0])) + 2000
  const xOf = nm => PAD.l + (nm / Math.max(1, data.lengthNm)) * (W - PAD.l - PAD.r)
  const yOf = ft => PAD.t + (1 - ft / topFt) * (H - PAD.t - PAD.b)

  const colW = (W - PAD.l - PAD.r) / data.x.length
  const rowH = (H - PAD.t - PAD.b) / data.levelsFt.length

  const chosen = chosenAltFt ?? data.chosenAltFt
  const ticks = []
  const tickStep = topFt > 20000 ? 5000 : 2000
  for (let a = 0; a <= topFt; a += tickStep) ticks.push(a)

  const anyModelled = data.bands.some(b => !b.official)

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
        Weather along the route
      </div>
      <div style={{ width: '100%', overflow: 'hidden', borderRadius: 10, background: 'var(--bg-card-2)' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
          <defs>
            <pattern id="turbhatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--warn)" strokeWidth="1.4" opacity="0.5" />
            </pattern>
          </defs>

          {/* Cloud: one cell per level per sample, opacity is the cover. Reads
              as sky rather than as a chart series. */}
          {data.cloud.map((col, i) => col.map((pct, j) => (
            pct > 4 ? (
              <rect key={`${i}-${j}`}
                x={PAD.l + i * colW - colW / 2} y={yOf(data.levelsFt[j]) - rowH / 2}
                width={colW} height={rowH}
                fill="var(--text)" opacity={Math.min(0.38, (pct / 100) * 0.38)} />
            ) : null
          )))}

          {/* Hazard bands: solid when official, dashed when modelled */}
          {data.bands.map((b, i) => (
            <rect key={`b${i}`}
              x={xOf(b.fromDistNm)} y={yOf(Math.min(b.topFt, topFt))}
              width={Math.max(6, xOf(b.toDistNm) - xOf(b.fromDistNm))}
              height={Math.max(3, yOf(b.baseFt) - yOf(Math.min(b.topFt, topFt)))}
              fill={b.kind === 'icing' ? 'rgba(90,200,250,0.16)' : 'url(#turbhatch)'}
              stroke={b.kind === 'icing' ? 'rgba(90,200,250,0.8)' : 'var(--warn)'}
              strokeWidth="1"
              strokeDasharray={b.official ? undefined : '4 3'} />
          ))}

          {/* Freezing level: omitted rather than drawn off the top when it
              sits above the altitudes this flight is choosing between. */}
          {data.freezingFt?.some(f => f != null && f <= topFt) && (
            <polyline
              points={data.freezingFt.map((f, i) => (f == null || f > topFt) ? null : `${PAD.l + i * colW},${yOf(f)}`).filter(Boolean).join(' ')}
              fill="none" stroke="#5AC8FA" strokeWidth="1.4" strokeDasharray="5 4" />
          )}

          {/* Terrain */}
          {data.terrainFt && (
            <path
              d={`M ${PAD.l},${yOf(0)} ` +
                 data.terrainFt.map((t, i) => `L ${PAD.l + i * colW},${yOf(t)}`).join(' ') +
                 ` L ${W - PAD.r},${yOf(0)} Z`}
              fill="var(--bg-card)" stroke="var(--border-strong)" strokeWidth="1" />
          )}

          {/* Service ceiling */}
          {data.ceilingFt && data.ceilingFt < topFt && (
            <line x1={PAD.l} y1={yOf(data.ceilingFt)} x2={W - PAD.r} y2={yOf(data.ceilingFt)}
              stroke="var(--text-tertiary)" strokeWidth="1" strokeDasharray="2 4" />
          )}
          {data.meaFt && (
            <line x1={PAD.l} y1={yOf(data.meaFt)} x2={W - PAD.r} y2={yOf(data.meaFt)}
              stroke="var(--danger)" strokeWidth="1" strokeDasharray="6 3" />
          )}

          {/* Wind barbs */}
          {data.wind.map((w, i) => (
            <Barb key={`w${i}`} x={xOf(w.distNm)} y={yOf(w.altFt)} dirDeg={w.dirDeg} kt={w.kt} />
          ))}

          {/* Recommended, then the pilot's choice on top of it */}
          {data.recommendedAltFt && data.recommendedAltFt !== chosen && (
            <line x1={PAD.l} y1={yOf(data.recommendedAltFt)} x2={W - PAD.r} y2={yOf(data.recommendedAltFt)}
              stroke="var(--ok)" strokeWidth="1.5" strokeDasharray="7 4" />
          )}
          {chosen && (
            <>
              <line x1={PAD.l} y1={yOf(chosen)} x2={W - PAD.r} y2={yOf(chosen)}
                stroke="var(--accent)" strokeWidth="2" />
              <text x={W - PAD.r + 4} y={yOf(chosen) + 3.5} fontSize="10" fontWeight="700" fill="var(--accent)">
                {chosen >= 18000 ? `FL${chosen / 100}` : `${(chosen / 1000).toFixed(1)}k`}
              </text>
            </>
          )}

          {/* Axes last so they sit above the shading */}
          {ticks.map(a => (
            <g key={`t${a}`}>
              <line x1={PAD.l - 3} y1={yOf(a)} x2={PAD.l} y2={yOf(a)} stroke="var(--text-tertiary)" strokeWidth="1" />
              <text x={PAD.l - 6} y={yOf(a) + 3} fontSize="9" textAnchor="end" fill="var(--text-tertiary)">
                {a >= 18000 ? `FL${a / 100}` : a / 1000 + 'k'}
              </text>
            </g>
          ))}
          <line x1={PAD.l} y1={yOf(0)} x2={W - PAD.r} y2={yOf(0)} stroke="var(--border-strong)" strokeWidth="1" />
          <text x={PAD.l} y={H - 8} fontSize="10" fontWeight="700" fill="var(--text-secondary)">{dep || 'DEP'}</text>
          <text x={W - PAD.r} y={H - 8} fontSize="10" fontWeight="700" textAnchor="end" fill="var(--text-secondary)">{dest || 'DEST'}</text>
          <text x={(PAD.l + W - PAD.r) / 2} y={H - 8} fontSize="9" textAnchor="middle" fill="var(--text-tertiary)">
            {data.lengthNm} NM
          </text>
        </svg>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6, fontSize: 9.5, color: 'var(--text-tertiary)' }}>
        {data.freezingFt?.some(f => f != null && f <= topFt) && (
          <span><span style={{ color: '#5AC8FA' }}>. . </span> freezing level</span>
        )}
        {!data.skyMissing && data.freezingFt?.every(f => f == null || f > topFt) && (
          <span>freezing level above {Math.round(topFt / 1000)},000 ft</span>
        )}
        {data.cloudMissing && (
          // Wind and temperature are real here; cloud simply is not part of
          // the FB product. Saying which is missing beats one vague caveat.
          <span style={{ color: 'var(--warn)' }}>no cloud layer. FAA winds aloft carries wind and temperature only</span>
        )}
        {data.skyMissing && (
          // Said plainly, because an empty sky on this chart must not be
          // mistaken for a clear one.
          <span style={{ color: 'var(--warn)' }}>
            no cloud, wind or freezing level. The forecast service did not answer
          </span>
        )}
        <span><span style={{ color: 'rgba(90,200,250,0.9)' }}>▢</span> icing</span>
        <span><span style={{ color: 'var(--warn)' }}>▨</span> turbulence</span>
        <span><span style={{ color: 'var(--accent)' }}>. . </span> your altitude</span>
        {data.recommendedAltFt !== chosen && <span><span style={{ color: 'var(--ok)' }}>- -</span> recommended</span>}
        {anyModelled && <span>dashed outline = modelled, not an official forecast</span>}
      </div>
    </div>
  )
}
