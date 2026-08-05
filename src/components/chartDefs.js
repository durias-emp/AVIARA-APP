// Which chart layers exist, and their off state. Plain data, in its own file
// so ChartLayers.jsx exports components and nothing else (fast refresh stops
// working for a module that mixes the two).

// Order matters: the chip stack renders this list straight through and wraps
// it into however many columns the screen has room for, so the charts come
// first and the overlays follow. Charts are tiled backdrops that mostly
// replace each other; overlays are drawn on top and combine freely.
export const CHARTS = [
  { key: 'sectional', label: 'SECT', faaOnly: true },
  { key: 'terrain',   label: 'TERR', faaOnly: false },
  { key: 'ifrlo',     label: 'LO',   faaOnly: true },
  { key: 'ifrhi',     label: 'HI',   faaOnly: true },
  { key: 'airspace',  label: 'ARSP', faaOnly: false },
  // Live traffic. Not a chart: a delayed, incomplete picture of who is
  // transmitting, labelled as such wherever it appears.
  { key: 'traffic',   label: 'TFC',  faaOnly: false },
  // Temporary flight restrictions. US only in practice: the FAA feed is the
  // source, so the chip is offered everywhere but will simply draw nothing
  // outside its coverage.
  { key: 'tfr',       label: 'TFR',  faaOnly: true },
  // Aerodromes and live weather, drawn as markers rather than tiles. These
  // are not charts and are not exclusive with them: a pilot turns on the
  // sectional to see the airspace and Airports to see where the fields are.
  //
  // Each carries a zoom floor of its own (see aerodromeLayers.jsx), which is
  // why they can be offered from a map that is always mounted: below the
  // floor they draw nothing rather than thousands of markers.
  { key: 'airports',  label: 'APT',  faaOnly: false },
  { key: 'heliports', label: 'HELI', faaOnly: false },
  { key: 'seaplane',  label: 'SEA',  faaOnly: false },
  // NEXRAD mosaic, US only, and the only layer here that is precipitation
  // rather than infrastructure.
  { key: 'radar',     label: 'RAD',  faaOnly: true },
  // A dot per reporting station, coloured VFR/MVFR/IFR/LIFR. Reported
  // conditions, not a forecast.
  //
  // Labelled CAT, not WX. Flight category is what pilots call this, and next
  // to RAD the generic "weather" read as though one of the two were the other.
  { key: 'fltcat',    label: 'CAT',  faaOnly: false },
]

export const EMPTY_LAYERS = {
  sectional: false, terrain: false, ifrlo: false, ifrhi: false, airspace: false,
  traffic: false, tfr: false,
  airports: false, heliports: false, seaplane: false, radar: false, fltcat: false,
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
