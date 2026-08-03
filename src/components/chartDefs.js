// Which chart layers exist, and their off state. Plain data, in its own file
// so ChartLayers.jsx exports components and nothing else (fast refresh stops
// working for a module that mixes the two).

export const CHARTS = [
  { key: 'sectional', label: 'SECT', faaOnly: true },
  { key: 'terrain',   label: 'TERR', faaOnly: false },
  { key: 'ifrlo',     label: 'LO',   faaOnly: true },
  { key: 'ifrhi',     label: 'HI',   faaOnly: true },
  { key: 'airspace',  label: 'ARSP', faaOnly: false },
]

export const EMPTY_LAYERS = {
  sectional: false, terrain: false, ifrlo: false, ifrhi: false, airspace: false,
}
