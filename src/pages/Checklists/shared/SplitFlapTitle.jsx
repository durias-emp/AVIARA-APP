import { useEffect, useRef, useState } from 'react'

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ&    '
const STEP_MS = 45     // time between each intermediate glyph
const STEPS = 5         // how many intermediate glyphs before settling
const STAGGER_MS = 40   // delay between adjacent character columns starting

// One "flap" position: cycles through a few random glyphs before landing on
// its target character, like an airport split-flap departure board.
function Flap({ char, delay }) {
  const [shown, setShown] = useState(char)
  const prevChar = useRef(char)

  useEffect(() => {
    if (char === prevChar.current) return
    prevChar.current = char
    let cancelled = false
    let step = 0
    let intervalId = null

    const startTimer = setTimeout(() => {
      if (cancelled) return
      intervalId = setInterval(() => {
        step += 1
        if (step >= STEPS) {
          clearInterval(intervalId)
          setShown(char)
          return
        }
        setShown(GLYPHS[Math.floor(Math.random() * GLYPHS.length)])
      }, STEP_MS)
    }, delay)

    return () => {
      cancelled = true
      clearTimeout(startTimer)
      if (intervalId) clearInterval(intervalId)
    }
  }, [char, delay])

  return (
    <span style={{ display: 'inline-block', whiteSpace: 'pre' }}>
      {shown}
    </span>
  )
}

// Renders `text` as a row of independently-flapping characters. Changing
// `text` re-spins only the characters that actually changed, staggered
// left-to-right, rather than an instant swap.
export default function SplitFlapTitle({ text, style }) {
  return (
    <span style={{ display: 'inline-flex', ...style }}>
      {text.split('').map((ch, i) => (
        <Flap key={i} char={ch} delay={i * STAGGER_MS} />
      ))}
    </span>
  )
}
