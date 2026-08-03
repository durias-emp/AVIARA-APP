# PQRH Radio Flight Sim Feature Capsule

This folder is intentionally outside `src/` so it does not touch the current app.

It contains a plug-and-play React prototype for the future PQRH Comms / AI ATC Trainer module:

- `ATCTrainer.jsx` - self-contained simulator UI and session state
- `ATCTrainer.css` - full-screen PQRH-style simulator styling
- `ui.jsx` - local shadcn-style primitives used by the standalone prototype
- `atcSimScenario.js` - FAA radio simulator scenario shell and airport map data
- `atcTrainerEngine.js` - local phraseology scoring helpers
- `index.html` / `prototype.jsx` - isolated preview entry, separate from the PQRH app

## Intended V1 Shape

The trainer is designed to feel like flying a radio scenario, not chatting with a bot. The visual language follows PQRH: compact controls, quiet status badges, an operational airport-state panel, realistic controller pacing, and debrief-first feedback.

Flow:

1. Configure the flight scenario.
2. Join the frequency.
3. ATC speaks first.
4. Transmit pilot calls by voice when supported, or typed text while prototyping.
5. Watch the airport map and frequency state update as clearances are accepted.
6. Review a debrief with score, missing items, coaching, and ideal phraseology.

## Plug-In Path Later

When ready to integrate into PQRH:

1. Move this folder to something like `src/features/atc-trainer/`.
2. Import the component in a new page:

```jsx
import ATCTrainer from '../../features/atc-trainer/ATCTrainer'

export default function Comms() {
  return <ATCTrainer />
}
```

3. Add a `/comms` route and a Home module card.

No external dependencies are required beyond React.

## Standalone Prototype

Run only this feature capsule:

```bash
npx vite feature-lab/atc-trainer --host 127.0.0.1 --port 5174
```

Then open `http://127.0.0.1:5174/`.

## AI / Voice Extension Points

`ATCTrainer` accepts these optional props:

- `scenarios` — custom scenario list
- `enableSpeechInput` - turn browser speech recognition on or off
- `enableSpeechOutput` - turn ATC speech synthesis on or off
- `controllerDelayMs` - tune controller pacing
- `onSessionComplete` — persist score/history to IndexedDB

The important rule: keep AI constrained by scenario state. The model should not freely invent clearances without the scenario engine validating the phase, airport context, and allowed instructions.

## Current Prototype Limits

- The current live scenario is one FAA English KFXE VFR ground-to-departure flow.
- ATC lines are scripted by default.
- Scoring is a local phrase-matching heuristic, not final evaluation logic.
- Browser speech recognition support varies by browser and OS.

This is deliberate: the first goal is to nail product feel and component boundaries before wiring voice or model calls.
