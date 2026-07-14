import { FAR } from '../../../lib/currency'
import { TopicHeader, Card } from '../shared/ui'

// General operating rules not already modeled in lib/currency.js's FAR
// object (that one is scoped to currency-tracking citations only).
const OPERATING_RULES = {
  rightOfWay:     { ref: '91.113', label: 'FAR 91.113', desc: 'Right-of-way rules — see and avoid; the least maneuverable aircraft generally has the right of way.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.113' },
  vfrMinimums:    { ref: '91.155', label: 'FAR 91.155', desc: 'VFR weather minimums — visibility and cloud clearance by airspace class.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.155' },
  trafficPattern: { ref: '91.126 / 91.127', label: 'FAR 91.126 / 91.127', desc: 'Standard traffic pattern operations at airports without/with an operating control tower.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.126' },
  lostComm:       { ref: '91.185', label: 'FAR 91.185', desc: 'IFR lost-communications procedures — see the Lost-Comm Procedures card.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.185' },
  minSafeAlt:     { ref: '91.119', label: 'FAR 91.119', desc: 'Minimum safe altitudes — 500 ft over open water/sparse areas, 1,000 ft over congested areas.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.119' },
  speedLimit:     { ref: '91.117', label: 'FAR 91.117', desc: '250 kt IAS below 10,000 ft MSL (with further limits near/within Class B and C airspace).', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.117' },
  oxygen:         { ref: '91.211', label: 'FAR 91.211', desc: 'Supplemental oxygen required for flight crew above 12,500 ft MSL (>30 min) and above 14,000 ft MSL continuously; required for all occupants above 15,000 ft MSL.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-C/section-91.211' },
  transponderAlt: { ref: '91.215', label: 'FAR 91.215', desc: 'Transponder and altitude-reporting equipment requirements by airspace.', url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-C/section-91.215' },
}

// Curated groupings for a general-purpose air-law reference — reuses the
// FAR citation data already maintained for currency tracking so the two
// stay consistent, plus the operating-rule citations above.
const GROUPS = [
  {
    title: 'Pilot Certification & Currency',
    entries: [FAR.crewDocs, FAR.medical, FAR.flightReview, FAR.passenger90, FAR.night90, FAR.ifrCurrency, FAR.ipc],
  },
  {
    title: 'Aircraft Documents & Airworthiness',
    entries: [FAR.airworthCert, FAR.registration, FAR.weightBalance, FAR.requiredEquip, FAR.annual, FAR.hundredHour, FAR.pitotStatic, FAR.transponder, FAR.elt, FAR.ads, FAR.vorCheck],
  },
  {
    title: 'General Operating Rules',
    entries: [
      OPERATING_RULES.rightOfWay, OPERATING_RULES.vfrMinimums, OPERATING_RULES.trafficPattern,
      OPERATING_RULES.minSafeAlt, OPERATING_RULES.speedLimit, OPERATING_RULES.oxygen,
      OPERATING_RULES.transponderAlt, OPERATING_RULES.lostComm, FAR.imsafe, FAR.opLimitations,
    ],
  },
]

export default function AirLaw({ onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TopicHeader title="Air Law & Regulations" onBack={onBack} />

      {GROUPS.map(group => (
        <Card key={group.title} title={group.title}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {group.entries.map((e, i) => (
              <a
                key={e.ref + i}
                href={e.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'block', textDecoration: 'none',
                  padding: '10px 0',
                  borderBottom: i === group.entries.length - 1 ? 'none' : '0.5px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{e.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', flexShrink: 0 }}>eCFR ↗</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>
                  {e.desc}
                </div>
              </a>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
