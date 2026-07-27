// Packaging the analysis for the briefing, and checking what comes back.
//
// The engine's output is rich and partly circular (candidates carry references
// to hazard objects that carry references back). This flattens it into the
// smallest complete description of the decision — every fact the advice could
// legitimately rest on, and nothing else — so the model has no reason to
// invent and no room to wander.

import { fmtAlt } from './cruiseAdvisor'

const round = (v, d = 0) => (v == null ? null : Number(v.toFixed(d)))

// advice: the result of recommendCruise
// context: { dep, dest, flightRules, etd, aircraftName }
export function buildBriefPayload(advice, context = {}) {
  if (advice?.status !== 'ok' || !advice.candidates?.length) return null

  const band = b => ({
    kind: b.kind,
    severity: b.severity,
    baseFt: b.baseFt,
    topFt: b.topFt,
    portionOfRoute: round(b.routeFrac * 100),
    source: b.official ? 'official forecast (G-AIRMET)' : 'modelled from the forecast profile',
    basis: b.basis,
  })

  return {
    flight: {
      from: context.dep || null,
      to: context.dest || null,
      distanceNm: round(advice.distNm),
      flightRules: context.flightRules || 'VFR',
      departureUTC: context.etd || 'not set — forecast is for the current hour',
      aircraft: context.aircraftName || null,
    },
    aircraft: advice.perf && {
      cruiseTasKt: advice.perf.tasKt,
      climbRateFpm: advice.perf.rocFpm,
      serviceCeilingFt: advice.perf.serviceCeilingFt,
      // The model must not present an assumed figure as the pilot's own.
      assumedValues: Object.entries(advice.perf.assumed)
        .filter(([, v]) => v).map(([k]) => k),
    },
    forecast: {
      source: advice.atmosphere?.model || null,
      validUTC: advice.atmosphere?.hourISO || null,
      samplePoints: advice.atmosphere?.samples || null,
    },
    hazards: {
      icing: (advice.hazards?.icing || []).map(band),
      turbulence: (advice.hazards?.turbulence || []).map(band),
      convection: advice.hazards?.convective
        ? `CAPE ${advice.hazards.convective.capeJkg} J/kg — ${advice.hazards.convective.level}`
        : null,
      coverage: advice.hazards?.coverage || null,
    },
    candidates: advice.candidates.map(c => ({
      altFt: c.altFt,
      label: fmtAlt(c.altFt),
      score: c.score,
      blockMinutes: round(c.econ?.blockMin),
      fuelGal: round(c.econ?.gallons, 1),
      groundSpeedKt: round(c.econ?.gsKt),
      windComponentKt: round(c.wind?.hwKt),   // positive = headwind
      windDirDeg: round(c.wind?.windDirDeg),
      windSpeedKt: round(c.wind?.windKt),
      oatC: round(c.oatC),
      cloudCoverPct: round(c.cloud?.meanPct),
      reasons: c.reasons.map(r => ({ points: r.points, factor: r.label, detail: r.detail })),
    })),
    ruledOut: (advice.rejected || []).map(r => ({
      altFt: r.altFt, label: fmtAlt(r.altFt), because: r.gates.map(g => g.label),
    })),
    enginePick: advice.recommended.altFt,
    notAvailable: advice.degraded || [],
    limits: [
      'VFR cloud clearance was checked vertically only; the horizontal distance in §91.155 cannot be evaluated from this data.',
      'Cloud bases are inferred to roughly one pressure level and are approximate.',
      'Modelled hazards are indications derived from the forecast profile, not an official product.',
    ],
  }
}

// Ask for the briefing. Returns { status, altFt, briefing, watchFor, agrees }
// — never throws, because the deterministic recommendation has to stand on its
// own whether or not this succeeds.
export async function fetchBriefing(advice, context = {}, { timeoutMs = 30000 } = {}) {
  const payload = buildBriefPayload(advice, context)
  if (!payload) return { status: 'empty' }

  let data
  try {
    const res = await fetch('/api/altitude-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 503) return { status: 'not-configured' }
    if (!res.ok) return { status: 'unavailable' }
    data = await res.json()
  } catch {
    return { status: 'unavailable' }
  }

  // The client half of the constraint. The endpoint checks too; this is the
  // one that decides what the pilot is shown, so it does not trust the answer
  // simply because it arrived.
  const legal = advice.candidates.map(c => c.altFt)
  if (data.altFt != null && !legal.includes(data.altFt)) {
    return { status: 'rejected', reason: 'the briefing named an altitude that is not legal for this route' }
  }
  if (data.altFt == null) {
    return { status: 'rejected', reason: data.rejected || 'the briefing did not name a usable altitude' }
  }

  return {
    status: 'ok',
    altFt: data.altFt,
    briefing: data.briefing,
    watchFor: data.watchFor,
    model: data.model,
    // When the two disagree the pilot sees both, with the engine's figures
    // attached — the disagreement is information, not an error.
    agrees: data.altFt === advice.recommended.altFt,
    enginePick: advice.recommended.altFt,
  }
}
