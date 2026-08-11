// Taxiways, and their letters, on the vector basemap.
//
// The runway layer draws the pavement a pilot lands on, from surveyed
// thresholds in a pack of our own. This is the other half of the same picture
// and it needs no pack at all: the basemap's own tiles already carry every
// taxiway at every airport in the world, with its designator on it.
//
// Verified rather than assumed. OpenFreeMap serves the OpenMapTiles schema,
// whose `aeroway` layer has exactly two fields, `class` and `ref`. At KJFK
// that is 108 taxiway features with 91 of them carrying a ref: J, Z, K, K3,
// JA, JB, Y, B, C, D and the rest. So the letters are read off the map rather
// than published by us, and where OpenStreetMap has no ref for a taxiway the
// line is still drawn and simply goes unlabelled, which is the honest result.
//
// Two changes, both applied to the vendor style rather than replacing it:
//
//   1. The taxiway line. Liberty draws it in #f0ede9, which is a shade off
//      the apron fill underneath it and effectively invisible: at KJFK the
//      whole taxiway system read as blank ground. It becomes pavement.
//   2. The letters, from zoom 14, which is where the runway markings start.
//
// Everything here is idempotent and safe to run again, because a theme change
// calls setStyle and setStyle throws away every layer added to the old style.
// Same discipline as Map3DPane's dress().

// One colour for both themes, and lighter than the runway ribbon on purpose.
// The runway is the thing you land on and has to stay the darkest mark at an
// aerodrome; the taxiway is how you get to it. Against the dark basemap's
// near-black ground and the light one's pale apron this reads on both.
const TAXIWAY = '#5b6472'

// Taxiway yellow on black, which is not decoration: it is what a taxiway
// location sign is. A pilot holding short reads a yellow legend on a black
// panel telling them which taxiway they are on, and that pairing is the one
// thing on an airfield that means "taxiway" without being read.
//
// Runway markings are white and stay white, so the two are told apart at a
// glance on the map exactly as they are on the ground.
//
// The halo is doing the black panel's job. It also carries a letter that
// overhangs its own taxiway onto the grass, which at this scale most of them
// do.
const LABEL_INK = '#ffc42e'
const LABEL_HALO = 'rgba(10,12,16,0.9)'

export const TAXIWAY_LABEL_ID = 'aviara-taxiway-label'

// EVERY ZOOM NUMBER IN THIS FILE IS A GL ZOOM, WHICH IS LEAFLET'S MINUS ONE.
//
// The bridge runs the MapLibre map one level below the Leaflet map it is glued
// to (leaflet-maplibre-gl.js: `zoom: this._map.getZoom() - 1`), because it
// renders the GL canvas at twice the CSS size. Measured: Leaflet 14 reports GL
// 13. So a minzoom of 14 here does not appear until the pilot is at Leaflet 15,
// which is a whole level later than the runway markings drawn by RunwayLayer,
// whose zooms are Leaflet's. That is why the taxiway letters were missing from
// a screenshot of KRNO that plainly had room for them.
const LEAFLET_TO_GL = -1

// Leaflet 12. Far enough out to see the shape of a field before committing to
// it, which is the zoom a pilot is at when they are deciding which way to join.
const LABEL_MIN_ZOOM = 12 + LEAFLET_TO_GL

// Roads stop competing once the aerodrome is the subject.
//
// At Leaflet 13 and beyond the screen is one airport, and the street network
// around it is the loudest thing on the map: Terminal Way, Airway Drive and
// Longley Lane in white type over the taxiways they cross. The lines fade and
// the names go, so what is left is the field. Not removed outright, because
// below that zoom the roads are how a pilot finds anything.
const ROAD_FADE = ['interpolate', ['linear'], ['zoom'],
  11 + LEAFLET_TO_GL, 1,
  14 + LEAFLET_TO_GL, 0.14]
const ROAD_NAME_FADE = ['interpolate', ['linear'], ['zoom'],
  11 + LEAFLET_TO_GL, 1,
  13 + LEAFLET_TO_GL, 0]

export function dressAeroways(gl) {
  if (!gl) return
  // Deliberately NOT gated on isStyleLoaded.
  //
  // That reads as "is the style ready", and it is not: it asks whether every
  // source the style needs has finished loading its tiles, which is a
  // different and much later question. Gating on it meant the layer was never
  // added on a map whose tiles were still arriving, and the events that would
  // have retried had already fired. Adding a layer to a parsed style is legal
  // long before a single tile has landed; MapLibre draws it when they do.
  //
  // What is actually needed is a parsed style with a vector source in it, and
  // that is what the reads below test.
  let style
  try {
    if (gl.getLayer(TAXIWAY_LABEL_ID)) return   // already done
    style = gl.getStyle()
  } catch {
    return                                       // style not parsed yet
  }
  if (!style?.sources) return

  try {
    // Found rather than named. The two OpenFreeMap styles do not agree on the
    // id: liberty calls it `aeroway_taxiway` and dark calls it
    // `aeroway-taxiway`, so hard-coding either one restyles half the themes
    // and silently skips the other. Caught exactly that way: the letters
    // appeared on the dark map over the vendor's own hairline taxiways.
    for (const l of style.layers ?? []) {
      const sl = l['source-layer']

      if (l.type === 'line' && sl === 'aeroway' && /taxiway/i.test(l.id)) {
        gl.setPaintProperty(l.id, 'line-color', TAXIWAY)
        // Wider, and wider earlier, so a taxiway system is legible from the
        // zoom a pilot is at while deciding how to join rather than only once
        // they are over the threshold. Same curve shape as the vendor's, moved
        // up and left.
        gl.setPaintProperty(l.id, 'line-width', [
          'interpolate', ['exponential', 1.2], ['zoom'],
          10 + LEAFLET_TO_GL, 0.8,
          12 + LEAFLET_TO_GL, 2.2,
          14 + LEAFLET_TO_GL, 5,
          21 + LEAFLET_TO_GL, 16,
        ])
        continue
      }

      // The road network gives way to the aerodrome. Lines dim, names go.
      // Opacity rather than visibility, because visibility cannot be made to
      // depend on zoom and this has to come back when the pilot zooms out.
      if (sl === 'transportation' && (l.type === 'line' || l.type === 'fill')) {
        gl.setPaintProperty(l.id, `${l.type}-opacity`, ROAD_FADE)
      } else if (sl === 'transportation_name' && l.type === 'symbol') {
        gl.setPaintProperty(l.id, 'text-opacity', ROAD_NAME_FADE)
        gl.setPaintProperty(l.id, 'icon-opacity', ROAD_NAME_FADE)
      }
    }

    const source = Object.entries(style.sources)
      .find(([, s]) => s.type === 'vector')?.[0]
    if (!source) return

    gl.addLayer({
      id: TAXIWAY_LABEL_ID,
      type: 'symbol',
      source,
      'source-layer': 'aeroway',
      minzoom: LABEL_MIN_ZOOM,
      filter: ['all',
        ['==', ['get', 'class'], 'taxiway'],
        ['has', 'ref'],
        // Some airports map a taxiway as an area rather than a line. A symbol
        // placed along a polygon's ring runs around its edge, which is not
        // what a taxiway label is.
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      ],
      layout: {
        // Repeated along the taxiway rather than once in the middle of it,
        // which is what a real airport diagram does and what makes a long
        // taxiway readable from wherever the pilot happens to be looking.
        // OSM splits taxiways at every junction, so one-per-feature would
        // cluster the letters at the junctions and leave the runs bare.
        'symbol-placement': 'line',
        // Closer together than before. A letter every 190px was one per
        // taxiway on a phone, which is fine when you are already over the
        // field and useless when you are looking at the whole of it.
        'symbol-spacing': 150,
        'text-field': ['get', 'ref'],
        // The three the style ships glyphs for. Anything else renders nothing
        // at all, silently.
        'text-font': ['Noto Sans Bold'],
        // Bigger at every zoom, and already readable at the new floor rather
        // than starting as a speck that has to be zoomed into.
        'text-size': ['interpolate', ['linear'], ['zoom'],
          12 + LEAFLET_TO_GL, 11,
          15 + LEAFLET_TO_GL, 14,
          19 + LEAFLET_TO_GL, 18],
        'text-letter-spacing': 0.08,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-padding': 3,
        // Let the collision engine thin them out. A busy field like KJFK has
        // over a hundred taxiway segments in view at once and every one of
        // them wants a label.
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': LABEL_INK,
        'text-halo-color': LABEL_HALO,
        // Wider than it was when the ink was white. Yellow on the light
        // theme's pale apron has far less contrast to lean on than white did,
        // and the halo is what puts it back.
        'text-halo-width': 1.7,
        'text-halo-blur': 0.2,
      },
    })
  } catch (e) {
    // A vendor style that has renamed its aeroway layer, or a glyph endpoint
    // that will not answer, must not take the basemap down with it.
    console.warn('[aeroway] could not dress taxiways:', e?.message ?? e)
  }
}

// Keep a running map dressed, whatever it does next.
//
// One call is not enough and neither is one event. `styledata` fires while the
// style is still being assembled, so the first few land before isStyleLoaded
// is true and do nothing; `load` needs a first render, which a backgrounded
// tab never grants. So all three, plus `idle`, which fires whenever the map
// has finished whatever it was doing. dressAeroways returns on its first line
// once the work is done, so the repeats cost a property lookup.
//
// Returns the unsubscribe, because a component that dies with handlers still
// attached to a live GL map is a leak.
export function keepAerowaysDressed(gl) {
  if (!gl) return () => {}
  const run = () => dressAeroways(gl)
  const events = ['styledata', 'load', 'idle']
  events.forEach(e => gl.on(e, run))
  run()
  return () => events.forEach(e => gl.off(e, run))
}
