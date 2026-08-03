// Left-edge title label shared by every "hero" button on Home (Weather,
// Map, Airports, Pilot, My Hangar) — a translucent sliver so the
// background art still bleeds through, with the button's name readable
// vertically.
export const HERO_LABEL_WIDTH = 30

export default function HeroLabel({ children }) {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: HERO_LABEL_WIDTH,
      // Comfortably above Leaflet's own internal pane z-indexes (up to
      // ~700-800 for its marker/control panes) — the Map preview card uses
      // this label too, and a low z-index here gets silently painted over
      // by the map tiles, same class of bug as the earlier preview glitch.
      zIndex: 1000, background: 'rgba(0,0,0,0.3)', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Keep labels short (roughly 8 characters or fewer) — rotated text
          in a fixed-height sliver clips silently past that, no ellipsis or
          wrap possible in this orientation. */}
      <span style={{
        color: '#fff', fontSize: 13, fontWeight: 800, letterSpacing: '0.04em',
        writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap',
      }}>
        {children}
      </span>
    </div>
  )
}
