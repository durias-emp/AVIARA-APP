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

// Below about 4 the panel is not there at all and the dock reads as icons
// scattered on the map; above about 70 there is no point calling it glass. Both
// ends are still further than anyone is likely to want.
export const GLASS_MIN = 4
export const GLASS_MAX = 70

export function clampGlass(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return DEFAULT_GLASS
  return Math.max(GLASS_MIN, Math.min(GLASS_MAX, Math.round(n)))
}

// 32px of blur at the sheerest, easing to 12 as the panel becomes a surface in
// its own right and stops needing the help.
function blurFor(pct) {
  const t = (pct - GLASS_MIN) / (GLASS_MAX - GLASS_MIN)
  return Math.round(32 - t * 20)
}

export function applyGlass(pct) {
  const v = clampGlass(pct)
  const root = document.documentElement
  root.style.setProperty('--drawer-opacity', String(v / 100))
  root.style.setProperty('--drawer-blur', `${blurFor(v)}px`)
}

// Read once at startup. Failing quietly is right: a pilot whose stored value
// cannot be read should get the shipped look, not a broken drawer.
export async function loadGlass() {
  try {
    const row = await get('settings', DRAWER_GLASS_KEY)
    const v = clampGlass(row?.value ?? DEFAULT_GLASS)
    applyGlass(v)
    return v
  } catch {
    applyGlass(DEFAULT_GLASS)
    return DEFAULT_GLASS
  }
}

export function saveGlass(pct) {
  const v = clampGlass(pct)
  applyGlass(v)
  put('settings', { key: DRAWER_GLASS_KEY, value: v }).catch(() => {})
  return v
}
