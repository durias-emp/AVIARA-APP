export function isDarkTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

export function aircraftImgStyle() {
  return isDarkTheme()
    ? { mixBlendMode: 'screen' }
    : { filter: 'invert(1)', mixBlendMode: 'multiply' }
}
