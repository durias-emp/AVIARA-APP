export function isDarkTheme() {
  const stored = localStorage.getItem('pqrh-theme')
  if (stored) return stored === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function aircraftImgStyle() {
  return isDarkTheme()
    ? { mixBlendMode: 'screen' }
    : { filter: 'invert(1)', mixBlendMode: 'multiply' }
}
