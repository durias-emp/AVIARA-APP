// Per-jurisdiction regulatory rulesets — the foundation for showing a real
// citation (and a link to the actual official source) at every point in the
// app where a regulatory decision gets made, instead of assuming FAA rules
// apply everywhere. Two namespaces per region:
//   - citations: static { ref, label, desc, url } records — same shape as
//     the existing FAR object in lib/currency.js, which this reuses as-is.
//   - computed: functions that return { value, steps, citation } for rules
//     that depend on inputs (course, time of day, aircraft category...),
//     not just a static reference. `steps` is a plain-language trace of how
//     `value` was reached, so a later "show your work" consumer (the
//     flight-plan optimizer) can use these directly without re-wrapping them.
//
// Only US and Canada are populated with real citations right now. `intl` is
// an explicit, deliberate fallback (generic ICAO-style guidance, no
// citation) for the "International / Other" region option that already
// exists in Settings — not an accidental gap to crash on later.

import { FAR } from './currency'

const US_CITATIONS = {
  ...FAR,
  cruisingAltitude: {
    ref: '91.159 / 91.179', label: 'FAR 91.159 / 91.179',
    desc: 'Cruising altitudes — VFR hemispheric rule (odd/even thousands + 500 ft) and IFR hemispheric rule (plain odd/even thousands), by magnetic course.',
    url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.159',
  },
  fuelReserveVFR: {
    ref: '91.151', label: 'FAR 91.151',
    desc: 'VFR fuel requirements — airplanes only, 30 min reserve by day / 45 min at night at normal cruising speed. No codified minimum for helicopters.',
    url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.151',
  },
  fuelReserveIFR: {
    ref: '91.167', label: 'FAR 91.167',
    desc: 'IFR fuel requirements — enough to reach the destination, then the alternate (if required), then fly 45 min at normal cruising speed.',
    url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-F/part-91/subpart-B/section-91.167',
  },
}

// Canadian Aviation Regulations (SOR/96-433) — verified against the live
// Justice Laws Canada text during implementation, not written from memory.
const CA_CITATIONS = {
  cruisingAltitude: {
    ref: '602.34', label: 'CAR 602.34',
    desc: 'Cruising altitudes and flight levels — semicircular rule by track (magnetic in Southern Domestic Airspace, true in Northern), above 3,000 ft AGL. Applies the same way to VFR and IFR — Canada has no VFR +500 ft offset like the US.',
    url: 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-602.34.html',
  },
  fuelReserve: {
    ref: '602.88', label: 'CAR 602.88',
    desc: 'Fuel requirements — one section covers both VFR (30 min day / 45 min night for airplanes, 20 min for helicopters) and IFR (45 min for propeller-driven aeroplanes, 30 min for turbo-jets and helicopters, after the alternate or missed approach).',
    url: 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-96-433/section-602.88.html',
  },
}

function usCruisingAltitude(rules, { courseDeg, isIFR }) {
  const isEast = courseDeg >= 0 && courseDeg <= 179
  const value = isIFR
    ? (isEast ? [3000, 5000, 7000, 9000, 11000, 13000, 15000, 17000] : [4000, 6000, 8000, 10000, 12000, 14000, 16000])
    : (isEast ? [3500, 5500, 7500, 9500, 11500, 13500, 15500, 17500] : [4500, 6500, 8500, 10500, 12500, 14500, 16500])
  const steps = [
    `Track ${courseDeg}° → ${isEast ? 'eastbound (000°–179°)' : 'westbound (180°–359°)'}`,
    isIFR ? `IFR — plain ${isEast ? 'odd' : 'even'} thousands` : `VFR — ${isEast ? 'odd' : 'even'} thousands + 500 ft`,
  ]
  return { value, steps, citation: rules.citations.cruisingAltitude }
}

function caCruisingAltitude(rules, { courseDeg }) {
  const isEast = courseDeg >= 0 && courseDeg <= 179
  const value = isEast ? [3000, 5000, 7000, 9000, 11000, 13000, 15000, 17000] : [4000, 6000, 8000, 10000, 12000, 14000, 16000]
  const steps = [
    `Track ${courseDeg}° → ${isEast ? 'eastbound (000°–179°)' : 'westbound (180°–359°)'}`,
    `CAR 602.34 — ${isEast ? 'odd' : 'even'} thousands (same table for VFR and IFR)`,
  ]
  return { value, steps, citation: rules.citations.cruisingAltitude }
}

function intlCruisingAltitude(rules, { courseDeg }) {
  const isEast = courseDeg >= 0 && courseDeg <= 179
  const value = isEast ? [3000, 5000, 7000, 9000, 11000, 13000, 15000, 17000] : [4000, 6000, 8000, 10000, 12000, 14000, 16000]
  return {
    value,
    steps: [`Track ${courseDeg}° → ${isEast ? 'eastbound' : 'westbound'}`, 'Generic ICAO semicircular guidance — no jurisdiction selected. Verify against the regulator for wherever you’re actually flying.'],
    citation: null,
  }
}

function usReserveMinutes(rules, { flightRules, isHelicopter, timeOfDay }) {
  let value, steps
  if (flightRules === 'IFR') {
    value = 45
    steps = ['IFR — 45 min at normal cruising speed after reaching the alternate (or destination if none required)']
  } else if (isHelicopter) {
    value = 20
    steps = ['Helicopter VFR — FAR 91.151 sets no codified helicopter minimum; 20 min is the common operator standard']
  } else {
    value = timeOfDay === 'night' ? 45 : 30
    steps = [`Airplane VFR, ${timeOfDay} — ${value} min at normal cruising speed`]
  }
  const citation = flightRules === 'IFR' ? rules.citations.fuelReserveIFR : rules.citations.fuelReserveVFR
  return { value, steps, citation }
}

function caReserveMinutes(rules, { flightRules, isHelicopter, timeOfDay }) {
  let value, steps
  if (flightRules === 'IFR') {
    // CAR 602.88(4): propeller-driven aeroplanes get 45 min, turbo-jets and
    // helicopters get 30 min. This app doesn't distinguish turboprop from
    // piston (both are propeller-driven per the regulation's own wording),
    // so only the helicopter category maps to the 30-min bucket.
    value = isHelicopter ? 30 : 45
    steps = [isHelicopter
      ? 'IFR, helicopter — 30 min after the alternate/missed approach'
      : 'IFR, propeller-driven aeroplane — 45 min after the alternate/missed approach']
  } else {
    value = isHelicopter ? 20 : (timeOfDay === 'night' ? 45 : 30)
    steps = [isHelicopter ? 'VFR, helicopter — 20 min' : `VFR, airplane, ${timeOfDay} — ${value} min`]
  }
  return { value, steps, citation: rules.citations.fuelReserve }
}

function intlReserveMinutes(rules, { flightRules }) {
  const value = flightRules === 'IFR' ? 45 : 30
  return {
    value,
    steps: ['Generic reserve guidance — no jurisdiction selected. Verify against the regulator for wherever you’re actually flying.'],
    citation: null,
  }
}

export const RULESETS = {
  us: { citations: US_CITATIONS, computed: { cruisingAltitude: usCruisingAltitude, reserveMinutes: usReserveMinutes } },
  ca: { citations: CA_CITATIONS, computed: { cruisingAltitude: caCruisingAltitude, reserveMinutes: caReserveMinutes } },
  intl: { citations: {}, computed: { cruisingAltitude: intlCruisingAltitude, reserveMinutes: intlReserveMinutes } },
}

export function getRuleset(region) {
  return RULESETS[region] ?? RULESETS.intl
}
