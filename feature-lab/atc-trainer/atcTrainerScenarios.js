export const ATC_TRAINER_SCENARIOS = [
  {
    id: 'faa-fw-towered-departure',
    aircraftType: 'fixed-wing',
    aircraftLabel: 'Cessna 172S',
    callsign: 'Cessna 4723A',
    title: 'Towered Departure',
    subtitle: 'Ground to tower, VFR westbound',
    airport: 'KFXE',
    airportName: 'Fort Lauderdale Executive',
    frequency: '121.75',
    controller: 'Executive Ground',
    difficulty: 'Student',
    region: 'FAA',
    phaseLabel: 'Ground',
    objective: 'Request taxi, read back hold-short instructions, and switch to tower.',
    briefing: [
      'You are parked at the Banyan ramp.',
      'ATIS Alpha is current.',
      'You are requesting a VFR departure to the west.',
    ],
    steps: [
      {
        id: 'initial-call',
        phase: 'Ground',
        prompt: 'Make your initial call to ground.',
        transmitLabel: 'Initial call',
        expectedMaxWords: 22,
        required: [
          { label: 'controller', terms: ['executive ground', 'ground'] },
          { label: 'callsign', terms: ['cessna 4723a', 'n4723a', '4723a'] },
          { label: 'position', terms: ['banyan ramp', 'ramp'] },
          { label: 'request', terms: ['taxi', 'vfr departure', 'departure to the west', 'westbound'] },
          { label: 'atis', terms: ['information alpha', 'alpha'] },
        ],
        ideal:
          'Executive Ground, Cessna 4723A at Banyan ramp, VFR departure to the west with information Alpha.',
        controllerLine:
          'Cessna 4723A, Executive Ground, runway 09, taxi via Alpha. Hold short runway 09.',
        coach:
          'A strong first call gives controller, callsign, position, request, and ATIS in one compact transmission.',
      },
      {
        id: 'taxi-readback',
        phase: 'Ground',
        prompt: 'Read back the taxi instruction.',
        transmitLabel: 'Taxi readback',
        expectedMaxWords: 16,
        required: [
          { label: 'runway', terms: ['runway 09', 'runway 9', 'zero niner'] },
          { label: 'route', terms: ['alpha'] },
          { label: 'hold short', terms: ['hold short'] },
          { label: 'callsign', terms: ['cessna 4723a', 'n4723a', '4723a'] },
        ],
        ideal: 'Runway 09 via Alpha, hold short runway 09, Cessna 4723A.',
        controllerLine: 'Cessna 4723A, readback correct. Monitor tower 120.9 approaching runway 09.',
        coach:
          'Hold-short instructions must be read back. The callsign closes the transmission cleanly.',
      },
      {
        id: 'tower-ready',
        phase: 'Tower',
        prompt: 'Call tower when ready at the hold-short line.',
        transmitLabel: 'Ready call',
        expectedMaxWords: 16,
        required: [
          { label: 'tower', terms: ['executive tower', 'tower'] },
          { label: 'callsign', terms: ['cessna 4723a', 'n4723a', '4723a'] },
          { label: 'location', terms: ['holding short runway 09', 'hold short runway 09', 'short runway 09'] },
          { label: 'ready', terms: ['ready for departure', 'ready to depart', 'ready'] },
        ],
        ideal: 'Executive Tower, Cessna 4723A holding short runway 09, ready for departure.',
        controllerLine:
          'Cessna 4723A, Executive Tower, runway 09 cleared for takeoff. Fly runway heading.',
        coach:
          'Tower wants who you are, where you are, and what you need. Keep the ready call short.',
      },
      {
        id: 'takeoff-readback',
        phase: 'Tower',
        prompt: 'Read back the takeoff clearance.',
        transmitLabel: 'Takeoff readback',
        expectedMaxWords: 14,
        required: [
          { label: 'clearance', terms: ['cleared for takeoff'] },
          { label: 'runway', terms: ['runway 09', 'runway 9', 'zero niner'] },
          { label: 'heading', terms: ['runway heading'] },
          { label: 'callsign', terms: ['cessna 4723a', 'n4723a', '4723a'] },
        ],
        ideal: 'Runway 09 cleared for takeoff, runway heading, Cessna 4723A.',
        controllerLine: 'Cessna 4723A, contact departure. Good day.',
        coach:
          'Takeoff clearance, runway, assigned heading, and callsign are the critical items.',
      },
    ],
  },
  {
    id: 'faa-heli-ramp-transition',
    aircraftType: 'helicopter',
    aircraftLabel: 'Bell 206B3',
    callsign: 'Helicopter 206CN',
    title: 'Helicopter Ramp Departure',
    subtitle: 'Air taxi and east transition',
    airport: 'KOPF',
    airportName: 'Miami-Opa Locka Executive',
    frequency: '121.90',
    controller: 'Opa Locka Ground',
    difficulty: 'Helicopter',
    region: 'FAA',
    phaseLabel: 'Ground',
    objective: 'Request an air taxi departure from the ramp and read back transition instructions.',
    briefing: [
      'You are on the north ramp in a Bell 206B3.',
      'ATIS Bravo is current.',
      'You want an eastbound transition below 500 feet.',
    ],
    steps: [
      {
        id: 'heli-initial-call',
        phase: 'Ground',
        prompt: 'Make your initial call from the ramp.',
        transmitLabel: 'Ramp call',
        expectedMaxWords: 24,
        required: [
          { label: 'controller', terms: ['opa locka ground', 'ground'] },
          { label: 'callsign', terms: ['helicopter 206cn', '206cn'] },
          { label: 'position', terms: ['north ramp', 'ramp'] },
          { label: 'request', terms: ['air taxi', 'east transition', 'eastbound transition', 'departure to the east'] },
          { label: 'atis', terms: ['information bravo', 'bravo'] },
        ],
        ideal:
          'Opa Locka Ground, Helicopter 206CN on the north ramp, request air taxi for east transition with information Bravo.',
        controllerLine:
          'Helicopter 206CN, Opa Locka Ground, air taxi to the east ramp boundary. Remain below 500 feet. Hold short runway 12.',
        coach:
          'Helicopter calls should make the operating area and requested movement unmistakable.',
      },
      {
        id: 'heli-air-taxi-readback',
        phase: 'Ground',
        prompt: 'Read back the air taxi instruction.',
        transmitLabel: 'Air taxi readback',
        expectedMaxWords: 20,
        required: [
          { label: 'air taxi', terms: ['air taxi'] },
          { label: 'boundary', terms: ['east ramp boundary', 'east boundary'] },
          { label: 'altitude', terms: ['below 500', 'below five hundred'] },
          { label: 'hold short', terms: ['hold short runway 12', 'hold short'] },
          { label: 'callsign', terms: ['helicopter 206cn', '206cn'] },
        ],
        ideal:
          'Air taxi to the east ramp boundary, remain below 500, hold short runway 12, Helicopter 206CN.',
        controllerLine:
          'Helicopter 206CN, contact tower 120.7 at the east ramp boundary.',
        coach:
          'Altitude and hold-short restrictions are must-readback items. Do not bury them.',
      },
      {
        id: 'heli-tower-call',
        phase: 'Tower',
        prompt: 'Call tower at the ramp boundary.',
        transmitLabel: 'Tower call',
        expectedMaxWords: 18,
        required: [
          { label: 'tower', terms: ['opa locka tower', 'tower'] },
          { label: 'callsign', terms: ['helicopter 206cn', '206cn'] },
          { label: 'position', terms: ['east ramp boundary', 'ramp boundary'] },
          { label: 'request', terms: ['east transition', 'eastbound transition', 'transition east'] },
        ],
        ideal:
          'Opa Locka Tower, Helicopter 206CN at the east ramp boundary, request east transition.',
        controllerLine:
          'Helicopter 206CN, transition east approved. Remain below 500 feet. Proceed at your discretion.',
        coach:
          'For tower, keep it crisp: callsign, exact position, requested transition.',
      },
      {
        id: 'heli-transition-readback',
        phase: 'Tower',
        prompt: 'Read back the transition approval.',
        transmitLabel: 'Transition readback',
        expectedMaxWords: 14,
        required: [
          { label: 'transition', terms: ['transition east approved', 'east transition approved', 'transition east'] },
          { label: 'altitude', terms: ['below 500', 'below five hundred'] },
          { label: 'callsign', terms: ['helicopter 206cn', '206cn'] },
        ],
        ideal: 'Transition east approved, remain below 500, Helicopter 206CN.',
        controllerLine: 'Helicopter 206CN, radar contact. Frequency change approved.',
        coach:
          'The important pieces are direction, altitude restriction, and callsign.',
      },
    ],
  },
]
