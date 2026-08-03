export function normalizeRadioText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\bniner\b/g, 'nine')
    .replace(/\bzero\b/g, '0')
    .replace(/\boh\b/g, '0')
    .replace(/\bone\b/g, '1')
    .replace(/\btwo\b/g, '2')
    .replace(/\bthree\b/g, '3')
    .replace(/\bfour\b/g, '4')
    .replace(/\bfive\b/g, '5')
    .replace(/\bsix\b/g, '6')
    .replace(/\bseven\b/g, '7')
    .replace(/\beight\b/g, '8')
    .replace(/\bnine\b/g, '9')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function termMatches(text, term) {
  const normalizedTerm = normalizeRadioText(term)
  return text.includes(normalizedTerm)
}

export function scorePilotTransmission(rawText, step) {
  const text = normalizeRadioText(rawText)
  const required = step.required ?? []
  const matched = []
  const missing = []

  required.forEach((item) => {
    const ok = item.terms.some((term) => termMatches(text, term))
    if (ok) matched.push(item.label)
    else missing.push(item.label)
  })

  const requiredScore = required.length ? matched.length / required.length : 1
  const words = text ? text.split(' ').length : 0
  const maxWords = step.expectedMaxWords ?? 24
  const brevityScore = words <= maxWords ? 1 : Math.max(0.55, 1 - (words - maxWords) * 0.035)
  const emptyPenalty = words === 0 ? 0 : 1
  const score = Math.round((requiredScore * 0.82 + brevityScore * 0.18) * 100 * emptyPenalty)

  return {
    score,
    matched,
    missing,
    wordCount: words,
    maxWords,
    brevityScore,
  }
}

export function summarizeSession(results) {
  if (!results.length) return 0
  const total = results.reduce((sum, item) => sum + item.score.score, 0)
  return Math.round(total / results.length)
}

export function getScoreTone(score) {
  if (score >= 88) return 'strong'
  if (score >= 70) return 'workable'
  return 'needs-work'
}

export function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
