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

// The openAIP tile key, resolved the same way the route planner resolves it:
// a value the pilot pasted in wins, otherwise the app's own key. Both live
// under 'openaip_key', in localStorage and in the settings store.
//
// This exists because the map home originally read a key name that was never
// written ('openaip' with a .key field, rather than 'openaip_key' with
// .value), so the airspace chip toggled a layer that could never render: it
// went dark, drew nothing, and looked like a broken tile source.
export const OPENAIP_KEY = 'b640e75c082134fd6f1524246478f301'

export function resolveOpenaipKey() {
  try {
    return localStorage.getItem('openaip_key') || OPENAIP_KEY
  } catch {
    return OPENAIP_KEY
  }
}
