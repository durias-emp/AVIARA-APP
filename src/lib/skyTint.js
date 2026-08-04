// The home screen's background, tinted by the weather at the home airport.
//
// Reuses the nine sky palettes the weather card and the detail overlay
// already paint with (WeatherAnimation's THEMES), so the wash behind the
// home screen and the sky inside the airport card are the same colour by
// construction rather than by two people picking blues that nearly match.
//
// Deliberately a wash, not a picture. The home screen is a stack of
// photographic hero buttons; a literal sky behind them would compete with
// every one of them. What this does is closer to light spilling into the
// room: strongest at the top, gone by halfway down, so the page feels like
// it knows what the weather is without ever announcing it.

import { THEMES } from '../components/WeatherAnimation'

// Opacity at the top of the page and at the midpoint.
const ALPHA = {
  light: { top: 0.20, mid: 0.09 },
  dark: { top: 0.42, mid: 0.22 },
}

// How far the tint must sit from the page background, in relative luminance,
// before it counts as visible at all.
//
// This exists because the first version of this file was invisible exactly
// when it mattered. The sky palettes are absolute colours designed to be
// painted *as* a sky — clear night is #081028, near-black. Laid over a black
// app background in dark mode the result is black on black: the feature ran,
// produced a gradient, and changed nothing anyone could see. The same is true
// of storm and overcast, which are near-black by day too.
//
// So the tint is not used raw. It is pushed away from the background until
// there is something to see, which keeps every one of the nine conditions
// legible against a white, a black or a red palette without any of them being
// special-cased.
const MIN_SEPARATION = 0.085

const clamp = n => Math.max(0, Math.min(255, Math.round(n)))
const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

function rgb(css) {
  const s = String(css || '').trim()
  const m = s.match(/rgba?\(([^)]+)\)/i)
  if (m) {
    const p = m[1].split(',').map(x => parseFloat(x))
    return [clamp(p[0]), clamp(p[1]), clamp(p[2])]
  }
  const h = s.replace('#', '')
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(h)) return null
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Scales a colour toward or away from black until it is far enough from the
// background to register. Scaling rather than blending with white keeps the
// hue: clear-night navy brightens into a deeper blue, not into grey.
function separate(colour, bg) {
  if (!bg) return colour
  const lc = luminance(colour)
  const lb = luminance(bg)
  if (Math.abs(lc - lb) >= MIN_SEPARATION) return colour

  const lighten = lb < 0.5
  const target = lighten ? lb + MIN_SEPARATION : Math.max(0, lb - MIN_SEPARATION)
  // A colour with no luminance at all cannot be scaled into one, so it gets
  // a neutral floor instead of a division by zero.
  if (lc < 0.002) return colour.map(() => clamp(target * 255))
  const k = target / lc
  return colour.map(c => clamp(c * k))
}

function palette(type, isNight, bg) {
  const t = THEMES[type] || THEMES.clear
  const stops = (isNight ? t.night : t.day).map(h => rgb(h) ?? [0, 0, 0])
  return stops.map(c => separate(c, bg))
}

// A CSS gradient of rgba stops, fading to nothing before the bottom of the
// screen so the lowest row of buttons sits on the app's own background and
// the page never looks like it has been dipped in something.
//
// bgCss is the live value of --bg; without it the tint cannot know whether it
// needs to lift or darken, and falls back to the raw palette.
export function skyBackdrop(type, isNight, theme, bgCss) {
  const bg = rgb(bgCss)
  const [a, b] = palette(type, isNight, bg)
  const k = theme === 'dark' ? 'dark' : 'light'
  const { top, mid } = ALPHA[k]
  return 'linear-gradient(180deg,'
    + ` rgba(${a[0]},${a[1]},${a[2]},${top}) 0%,`
    + ` rgba(${b[0]},${b[1]},${b[2]},${mid}) 42%,`
    + ` rgba(${b[0]},${b[1]},${b[2]},0) 78%)`
}

// The same tint, flattened against the page background into one opaque hex.
//
// This exists for the iOS status bar. theme-color takes a solid colour, and
// if it keeps pointing at --bg while the page behind it is tinted, the strip
// above the app stays the old colour and reads as a band across the top —
// the identical problem the flight-plan map had. Blending here means the bar
// matches the very top of the gradient exactly.
export function skyChromeColor(type, isNight, theme, bgCss) {
  const bg = rgb(bgCss)
  if (!bg) return null
  const [a] = palette(type, isNight, bg)
  const t = ALPHA[theme === 'dark' ? 'dark' : 'light'].top
  const hex = n => clamp(n).toString(16).padStart(2, '0')
  return `#${hex(a[0] * t + bg[0] * (1 - t))}`
       + `${hex(a[1] * t + bg[1] * (1 - t))}`
       + `${hex(a[2] * t + bg[2] * (1 - t))}`
}
