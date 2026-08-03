// One flight, as an activity.
//
// The logbook row said KSFO to KRDD, 173 NM, 1.4 h, which is everything a
// regulator wants and nothing a pilot wants to look at twice. This is the same
// record with its shape shown: the track first, the numbers under it, the
// aircraft and the date above. Strava's card, in aviation units.
//
// Both kinds of flight render here: recorded ones, which have a track, and
// planned ones completed through the checklist, which do not. They are told
// apart honestly rather than dressed as each other, because a flight that was
// planned and a flight that was flown are not the same claim.

import FlightTrace from './FlightTrace'

const fmtDate = (iso, id) => {
  const d = new Date(iso ?? id ?? Date.now())
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return sameDay
    ? `Today at ${time}`
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`
}

function Stat({ value, label }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: 17, fontWeight: 800, color: '#1c1c1e',
        letterSpacing: '-0.3px', fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'rgba(60,60,67,0.5)', marginTop: 1 }}>
        {label}
      </div>
    </div>
  )
}

export default function ActivityCard({ flight, onOpen }) {
  const recorded = flight.source === 'recorded' && Array.isArray(flight.track) && flight.track.length > 1
  const title = flight.dep && flight.dest
    ? `${flight.dep} → ${flight.dest}`
    : recorded ? 'Recorded flight' : 'Planned flight'

  const hours = flight.flightTimeH
  const timeText = hours != null
    ? (hours >= 1 ? `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m` : `${Math.round(hours * 60)}m`)
    : '—'

  return (
    <button onClick={() => onOpen?.(flight)} style={{
      display: 'block', width: '100%', textAlign: 'left', padding: 0,
      // A fixed light surface, not the theme token. This card lives inside
      // the map home's sheet, which is glass over a chart and always light;
      // in dark mode the token made the card black inside a white sheet, with
      // its own dark labels then unreadable on top of it.
      background: '#fff', border: 'none', borderRadius: 18,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 6px 18px rgba(0,0,0,0.05)',
      overflow: 'hidden', cursor: onOpen ? 'pointer' : 'default',
    }}>
      <div style={{ padding: '13px 15px 10px' }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: 'rgba(60,60,67,0.5)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span>{flight.registration || flight.aircraft || 'No aircraft'}</span>
          <span aria-hidden="true">·</span>
          <span>{fmtDate(flight.savedAt, flight.id)}</span>
          {!recorded && (
            <span style={{
              marginLeft: 'auto', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.4px',
              color: 'rgba(60,60,67,0.55)', background: 'rgba(60,60,67,0.08)',
              padding: '3px 7px', borderRadius: 6, textTransform: 'uppercase',
            }}>Planned</span>
          )}
        </div>
        <div style={{
          fontSize: 18, fontWeight: 800, color: '#1c1c1e',
          letterSpacing: '-0.4px', marginTop: 3,
        }}>{title}</div>
      </div>

      <div style={{ background: 'rgba(60,60,67,0.045)', padding: '2px 0' }}>
        <FlightTrace track={flight.track} />
      </div>

      <div style={{ display: 'flex', gap: 10, padding: '12px 15px 14px' }}>
        <Stat value={flight.distNm != null ? `${Math.round(flight.distNm)} NM` : '—'} label="Distance" />
        <Stat value={timeText} label="Time" />
        {/* Max ground speed only where it was measured. A planned flight has a
            TAS, which is a different number, and quietly showing one under the
            other's label is the kind of thing that ends up in a logbook. */}
        <Stat
          value={flight.maxGsKt != null ? `${flight.maxGsKt} kt`
            : flight.tas != null ? `${Math.round(flight.tas)} kt` : '—'}
          label={flight.maxGsKt != null ? 'Max GS' : 'Planned TAS'} />
        <Stat
          value={flight.maxAltFt != null ? `${flight.maxAltFt.toLocaleString()} ft`
            : flight.cruiseAlt != null ? `${Number(flight.cruiseAlt).toLocaleString()} ft` : '—'}
          label={flight.maxAltFt != null ? 'Max alt' : 'Cruise'} />
      </div>
    </button>
  )
}
