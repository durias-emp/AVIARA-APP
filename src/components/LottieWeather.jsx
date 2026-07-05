import { DotLottieReact } from '@lottiefiles/dotlottie-react'
import { getCondition, gradient } from './WeatherAnimation'

// Feature flag for the Lottie-vs-custom-SVG A/B. Flip to false to fall back to
// the hand-drawn WeatherAnimation everywhere it's wired.
export const USE_LOTTIE_WEATHER = true

// Map the app's 9 condition types (+ day/night) to a bundled dotLottie file in
// public/weather/. Several app states intentionally share one animation because
// they're visually the same scene (e.g. few == clear, broken == scattered).
const LOTTIE_MAP = {
  clear:     { day: 'clear-day',  night: 'clear-night'  },
  few:       { day: 'clear-day',  night: 'clear-night'  },
  scattered: { day: 'partly-day', night: 'cloudy-night' },
  broken:    { day: 'partly-day', night: 'cloudy-night' },
  overcast:  { day: 'partly-day', night: 'cloudy-night' },
  rain:      { day: 'rain-day',   night: 'rain-night'   },
  storm:     { day: 'storm-day',  night: 'storm-night'  },
  snow:      { day: 'snow-day',   night: 'snow-night'   },
  fog:       { day: 'fog',        night: 'fog'          },
}

export function lottieForCondition(type, isNight) {
  const entry = LOTTIE_MAP[type] || LOTTIE_MAP.clear
  return `/weather/${isNight ? entry.night : entry.day}.lottie`
}

// Full-bleed weather background: same sky gradient as the custom animation, with
// the flat dotLottie icon centered on top. Drop-in replacement for
// <WeatherAnimation metar={...} /> as a card background.
export default function LottieWeather({ metar }) {
  const { type, isNight } = getCondition(metar)
  const src = lottieForCondition(type, isNight)

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: gradient(type, isNight) }}>
      <DotLottieReact
        key={src}
        src={src}
        loop
        autoplay
        style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 135, height: 135,
        }}
      />
    </div>
  )
}
