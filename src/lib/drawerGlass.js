// How much of the map shows through the drawer.
//
// One number, held as a percentage because that is what the pilot is choosing
// and what the label says. The stylesheet keeps the colour and the blur; this
// only overwrites the alpha, so a value chosen once is right in both palettes
// and stays right when the theme changes underneath it.
//
// The blur rides on it rather than being a second slider. Transparency is what
// shows the map; blur is the only thing keeping the labels readable over a
// sectional, so the two cannot sensibly be set independently by anyone who has
// not seen what happens when they disagree. Sheerer glass, more blur.

import { get, put } from './db'

export const DRAWER_GLASS_KEY = 'drawerGlass'

// Ten percent, which is where this was tuned by eye.
export const DEFAULT_GLASS = 10

// The full range, end to end. Zero is no panel at all, the dock sitting
// directly on the map with only the blur behind it; a hundred is the solid
// surface the app had before any of this, white in the light palette and the
// dark grey in the dark one. Both ends are deliberate positions rather than
// guard rails, so the slider means what it says.
export const GLASS_MIN = 0
export const GLASS_MAX = 100

export function clampGlass(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return DEFAULT_GLASS
  return Math.max(GLASS_MIN, Math.min(GLASS_MAX, Math.round(n)))
}

// 32px of blur at the sheerest, easing to nothing as the panel becomes a
// surface in its own right. At full opacity the blur is doing no work at all
// and only costs a compositing pass, so it goes.
function blurFor(pct) {
  return Math.round(32 * (1 - pct / 100))
}

/* ── Stains ──────────────────────────────────────────────────────────────
   A colour for the glass, and for the app tiles sitting on it, so the drawer
   can be a material rather than just a degree of transparency.

   `ink: 'light'` says text on this colour wants to be light. It is only
   honoured once the stain is actually the dominant surface, because at 10%
   opacity what a label sits on is the map, not the stain, and flipping the
   text to white over a pale chart would be the opposite of legible. ── */
export const STAINS = [
  { key: 'none',   label: 'None',   rgb: null },
  { key: 'slate',  label: 'Slate',  rgb: '68, 78, 94',    ink: 'light' },
  { key: 'ocean',  label: 'Ocean',  rgb: '18, 78, 120',   ink: 'light' },
  { key: 'forest', label: 'Forest', rgb: '28, 84, 62',    ink: 'light' },
  { key: 'plum',   label: 'Plum',   rgb: '92, 46, 110',   ink: 'light' },
  { key: 'ember',  label: 'Ember',  rgb: '188, 84, 44',   ink: 'light' },
  { key: 'rose',   label: 'Rose',   rgb: '196, 72, 112',  ink: 'light' },
  { key: 'sand',   label: 'Sand',   rgb: '226, 202, 162', ink: 'dark' },
  { key: 'mist',   label: 'Mist',   rgb: '214, 226, 236', ink: 'dark' },
]

export const DRAWER_STAIN_KEY = 'drawerStain'
export const DEFAULT_STAIN = 'none'

export function findStain(key) {
  return STAINS.find(s => s.key === key) ?? STAINS[0]
}

// Past this the stain is what a label is actually sitting on, so its ink
// preference starts to matter. Below it the map still shows through more than
// the colour does and the theme's own ink is the safer answer.
const INK_TAKES_OVER = 55

function paint(pct, stainKey) {
  const root = document.documentElement
  const v = clampGlass(pct)
  const stain = findStain(stainKey)

  root.style.setProperty('--drawer-opacity', String(v / 100))
  root.style.setProperty('--drawer-blur', `${blurFor(v)}px`)

  const clear = names => names.forEach(n => root.style.removeProperty(n))

  if (!stain.rgb) {
    // Removed rather than set back to a value: the stylesheet already has the
    // right answer per palette, and writing one here would freeze whichever
    // theme happened to be on when the stain was cleared.
    clear(['--map-panel-rgb', '--app-tile-bg', '--map-ink', '--map-ink-dim',
      '--map-ink-faint', '--map-icon-ink'])
    return
  }

  root.style.setProperty('--map-panel-rgb', stain.rgb)
  // The tiles take the same colour at a fixed strength rather than at the
  // panel's, so they stay visible as objects on the glass however sheer it is.
  root.style.setProperty('--app-tile-bg', `rgba(${stain.rgb}, 0.28)`)

  if (v >= INK_TAKES_OVER && stain.ink === 'light') {
    root.style.setProperty('--map-ink', '#ffffff')
    root.style.setProperty('--map-ink-dim', 'rgba(255,255,255,0.72)')
    root.style.setProperty('--map-ink-faint', 'rgba(255,255,255,0.55)')
    root.style.setProperty('--map-icon-ink', 'brightness(0) invert(1)')
  } else if (v >= INK_TAKES_OVER && stain.ink === 'dark') {
    root.style.setProperty('--map-ink', '#1c1c1e')
    root.style.setProperty('--map-ink-dim', 'rgba(28,28,30,0.66)')
    root.style.setProperty('--map-ink-faint', 'rgba(28,28,30,0.48)')
    root.style.setProperty('--map-icon-ink', 'brightness(0)')
  } else {
    clear(['--map-ink', '--map-ink-dim', '--map-ink-faint', '--map-icon-ink'])
  }
}

// Kept so callers that only change one of the two do not have to know the
// other's current value.
let currentPct = DEFAULT_GLASS
let currentStain = DEFAULT_STAIN

export function applyGlass(pct) {
  currentPct = clampGlass(pct)
  paint(currentPct, currentStain)
}

export function applyStain(key) {
  currentStain = findStain(key).key
  paint(currentPct, currentStain)
}

// Read once at startup. Failing quietly is right: a pilot whose stored value
// cannot be read should get the shipped look, not a broken drawer.
export async function loadGlass() {
  let v = DEFAULT_GLASS
  let stain = DEFAULT_STAIN
  try {
    const [g, s] = await Promise.all([
      get('settings', DRAWER_GLASS_KEY),
      get('settings', DRAWER_STAIN_KEY),
    ])
    v = clampGlass(g?.value ?? DEFAULT_GLASS)
    stain = findStain(s?.value ?? DEFAULT_STAIN).key
  } catch { /* the shipped look is the right fallback */ }
  currentPct = v
  currentStain = stain
  paint(v, stain)
  return { glass: v, stain }
}

export function saveGlass(pct) {
  const v = clampGlass(pct)
  applyGlass(v)
  put('settings', { key: DRAWER_GLASS_KEY, value: v }).catch(() => {})
  return v
}

export function saveStain(key) {
  const k = findStain(key).key
  applyStain(k)
  put('settings', { key: DRAWER_STAIN_KEY, value: k }).catch(() => {})
  return k
}
