// Shared "copy to clipboard" button using the archivos icon. Pass `onDark`
// when the surrounding surface is dark (glass panels, photos, dark cards) so
// the icon inverts to white; leave it off on light/card backgrounds so it
// stays dark and keeps contrast either way.
export function CopyIconButton({ onCopy, copied, onDark = false, size = 16 }) {
  return (
    <button
      onClick={onCopy}
      aria-label={copied ? 'Copied' : 'Copy'}
      style={{
        borderRadius: 999, padding: '7px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: onDark ? 'rgba(255,255,255,0.14)' : 'var(--bg-card-2)',
        border: onDark ? '1px solid rgba(255,255,255,0.18)' : '0.5px solid var(--border)',
        cursor: 'pointer',
      }}
    >
      <img
        src="/archivos.png" alt="" width={size} height={size}
        style={{
          filter: onDark ? 'brightness(0) invert(1)' : 'var(--icon-filter)',
          opacity: 0.85,
        }}
      />
    </button>
  )
}

export function IconClock({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M12 7V12L15 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconBook({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 19.5C4 18.1193 5.11929 17 6.5 17H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M6.5 2H20V22H6.5C5.11929 22 4 20.8807 4 19.5V4.5C4 3.11929 5.11929 2 6.5 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconCloud({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M18 10C18 10 18 10 18 10C18 7.23858 15.7614 5 13 5C10.7672 5 8.8662 6.47749 8.17 8.5C6.35 8.5 5 9.85 5 11.5C5 13.15 6.35 14.5 8 14.5H18C19.6569 14.5 21 13.1569 21 11.5C21 9.84315 19.6569 8.5 18 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconPlane({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M21 16L13 12V5C13 4.44772 12.5523 4 12 4C11.4477 4 11 4.44772 11 5V12L3 16L3.5 17L11 14.5V19L9 20.5V21.5L12 21L15 21.5V20.5L13 19V14.5L20.5 17L21 16Z" fill="currentColor"/>
    </svg>
  )
}

export function IconRadioOff({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 12v9M8 21h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M8 8a4 4 0 0 1 6.5-3.1M16 9.5A4 4 0 0 1 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M5 5a10 10 0 0 1 3-2M19 5a10 10 0 0 1 0 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

export function IconLightGun({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="4" y="10" width="10" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M14 12h3l3-3v8l-3-3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M2 8v2M2 16v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

export function IconMarshaller({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M12 8v7M12 8L6 5M12 8l6-3M12 15l-4 6M12 15l4 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconMap({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M9 4v14M15 6v14" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconWrench({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.83 2.83-2.12-2.12L14.7 6.3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  )
}

// Eight-tooth gear, generated rather than hand-drawn: the previous path was
// a hand-transcribed copy of a stock icon with malformed arcs (and a stray
// horizontal-line command mid-path), which rendered as a lump at the 22px
// the Settings card actually uses. Every point here is a polar coordinate
// off one centre, so the teeth are identical by construction — 18° tips,
// 16° valleys, tip radius 10.15 leaving room for the 1.5 stroke inside the
// 24-unit box.
export function IconGear({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M10.41 1.97A10.15 10.15 0 0 1 13.59 1.97L13.90 4.64A7.6 7.6 0 0 1 15.86 5.45L17.97 3.79A10.15 10.15 0 0 1 20.21 6.03L18.55 8.14A7.6 7.6 0 0 1 19.36 10.10L22.03 10.41A10.15 10.15 0 0 1 22.03 13.59L19.36 13.90A7.6 7.6 0 0 1 18.55 15.86L20.21 17.97A10.15 10.15 0 0 1 17.97 20.21L15.86 18.55A7.6 7.6 0 0 1 13.90 19.36L13.59 22.03A10.15 10.15 0 0 1 10.41 22.03L10.10 19.36A7.6 7.6 0 0 1 8.14 18.55L6.03 20.21A10.15 10.15 0 0 1 3.79 17.97L5.45 15.86A7.6 7.6 0 0 1 4.64 13.90L1.97 13.59A10.15 10.15 0 0 1 1.97 10.41L4.64 10.10A7.6 7.6 0 0 1 5.45 8.14L3.79 6.03A10.15 10.15 0 0 1 6.03 3.79L8.14 5.45A7.6 7.6 0 0 1 10.10 4.64Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  )
}

// One glyph for the whole sky, keyed to WeatherAnimation's condition types
// (clear / few / scattered / broken / overcast / rain / snow / storm / fog).
// The Airports card used to carry a full painted scene; a pilot glancing at
// a home screen wants to know "sun, cloud, or wet", and one symbol answers
// that faster than an illustration does.
export function IconSky({ type = 'clear', size = 22 }) {
  const s = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }
  const cloud = <path d="M7.4 18.4h8.6a3.4 3.4 0 0 0 0-6.8 5 5 0 0 0-9.4 1.5 2.9 2.9 0 0 0 .8 5.3z" {...s} />
  const sunSmall = (
    <>
      <circle cx="8.6" cy="7.8" r="3" {...s} />
      <path d="M8.6 2.6v1.4M8.6 11.6v1.4M3.4 7.8h1.4M12.4 7.8h1.4M4.9 4.1l1 1M11.3 10.5l1 1M12.3 4.1l-1 1M5.9 10.5l-1 1" {...s} />
    </>
  )
  switch (type) {
    case 'clear':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4.6" {...s} />
          <path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6" {...s} />
        </svg>
      )
    case 'few': case 'scattered':
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none">{sunSmall}{cloud}</svg>
    case 'broken': case 'overcast':
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none">{cloud}</svg>
    case 'rain':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M7.4 15.4h8.6a3.4 3.4 0 0 0 0-6.8 5 5 0 0 0-9.4 1.5 2.9 2.9 0 0 0 .8 5.3z" {...s} />
          <path d="M8.6 18.2l-.8 2.4M12 18.2l-.8 2.4M15.4 18.2l-.8 2.4" {...s} />
        </svg>
      )
    case 'snow':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M7.4 15.4h8.6a3.4 3.4 0 0 0 0-6.8 5 5 0 0 0-9.4 1.5 2.9 2.9 0 0 0 .8 5.3z" {...s} />
          <path d="M8.4 19.2h.02M11.9 20.4h.02M15.4 19.2h.02" {...s} strokeWidth="2.4" />
        </svg>
      )
    case 'storm':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M7.4 14.6h8.6a3.4 3.4 0 0 0 0-6.8 5 5 0 0 0-9.4 1.5 2.9 2.9 0 0 0 .8 5.3z" {...s} />
          <path d="M12.8 16.4l-2.4 3.4h2.6l-1.4 2.6" {...s} />
        </svg>
      )
    case 'fog':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M7.4 13.6h8.6a3.4 3.4 0 0 0 0-6.8 5 5 0 0 0-9.4 1.5 2.9 2.9 0 0 0 .8 5.3z" {...s} />
          <path d="M5.4 17h13M7.4 20.2h9" {...s} />
        </svg>
      )
    default:
      return <svg width={size} height={size} viewBox="0 0 24 24" fill="none">{cloud}</svg>
  }
}

/* ── Home card glyphs ──────────────────────────────────────────────────
   One line weight (1.6), one 24-unit box, no fills except where a shape
   reads better solid. They sit at 22px on a black card, so anything more
   detailed than this turns to mush — the restraint is the design. ── */

// Crossed runways — the way a field is drawn on a chart. An earlier version
// was a control tower, which at 22px read as a candle.
//
// Each runway is a pair of parallel edges, so four lines in total: the strip
// shape is what makes it a runway rather than a plus sign. Angles are
// deliberately not 90° apart — real fields cross at odd angles, and the
// asymmetry is what stops it reading as a crosshair.
export function IconRunways({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      {/* long runway, NNE/SSW */}
      <path d="M8.2 21.2 12.6 3.1M11.6 21.9 16 3.8" />
      {/* crossing runway, WNW/ESE */}
      <path d="M2.9 9.9 20.4 13.3M2.5 12.1 20 15.5" />
    </svg>
  )
}

// Hangar: pitched roof, walls, door. An earlier version used a rounded
// arch, which read as a tunnel — a peak is what makes it a building.
export function IconHangar({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.9 12.1 12 5.1l10.1 7" />
      <path d="M3.9 10.7v9.8M20.1 10.7v9.8" />
      <path d="M1.6 20.5h20.8" />
      {/* The door is what separates a hangar from a house: it spans almost
          the whole frontage, because an aeroplane has to fit through it. */}
      <path d="M6.6 20.5v-6.6h10.8v6.6" />
    </svg>
  )
}

// The Pilot mark: the project's own logo (public/pilot-helmet.png, from
// brand/pqrh-logo-source.jpeg), not a redrawing of it. Two attempts to
// letter it as line art both drifted off-brand, which is the argument for
// using the asset itself.
//
// Same treatment as the Pilot artwork in HomeHeroArt: the source is dark
// engraving on cream, so inverting it would reverse every tone and turn the
// pale goggle lenses dark. Instead the image drives a luminance mask over a
// flat currentColor fill, keeping the drawing's own tonal sense. The
// transfer curve is steep so the cream ground goes to zero and the card
// shows through rather than carrying a pale rectangle.
//
// The window into the source (x 44, y 12, 60.9 x 60 in the original's
// units) is the helmet's own box — that crop is also how the "PQRH"
// wordmark below it gets dropped. Those numbers are mapped into this
// 24-unit box by LOGO_SCALE; keep them in step with HomeHeroArt if the
// crop ever moves.
export function IconHelmet({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {/* Leather flying helmet, front on: the dome, ear flaps tapering in
          toward the chin, and the goggles. Proportioned so the lenses sit
          clear of both the dome line and the flaps — an earlier pass had
          all three touching and the result read as headphones. */}
      <path d="M4.1 13.4a7.9 7.9 0 0 1 15.8 0" />
      <path d="M4.1 13.4v2.4c0 1.6 1.1 2.9 2.6 3.2M19.9 13.4v2.4c0 1.6-1.1 2.9-2.6 3.2" />
      <circle cx="9.1" cy="13.1" r="2.2" />
      <circle cx="14.9" cy="13.1" r="2.2" />
      <path d="M11.3 13.1h1.4" />
    </svg>
  )
}

// A three-fix route: departure, a turning point, destination. Scalene on
// purpose — an equilateral triangle reads as a warning sign or a play
// button, while uneven legs read as a route someone actually planned.
export function IconRoute({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.6 19.2 9.9 5.2M9.9 5.2 20.1 12.4" strokeDasharray="2.5 2.3" />
      <circle cx="4.6" cy="19.2" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="9.9" cy="5.2" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="20.1" cy="12.4" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

// Atom — nucleus plus three electron shells at 60° to each other. Ellipses
// with a rotate transform rather than paths, so the three orbits are the
// same shape by construction and stay perfectly symmetric at any size.
export function IconAtom({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="12" rx="10.2" ry="4.1" stroke="currentColor" strokeWidth="1.5"/>
      <ellipse cx="12" cy="12" rx="10.2" ry="4.1" stroke="currentColor" strokeWidth="1.5" transform="rotate(60 12 12)"/>
      <ellipse cx="12" cy="12" rx="10.2" ry="4.1" stroke="currentColor" strokeWidth="1.5" transform="rotate(120 12 12)"/>
      <circle cx="12" cy="12" r="2.1" fill="currentColor"/>
    </svg>
  )
}

export function IconCompass({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M15.5 8.5L13 13L8.5 15.5L11 11L15.5 8.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
}

// Two overlapping people — a "friends/people" glyph distinct from
// IconPerson (a single figure, already used for Discover's own Profile
// tab), for the Home screen's Friends card.
export function IconFriends({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M3 20c.8-3.5 3-5.5 6-5.5s5.2 2 6 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="17" cy="7" r="2.3" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M14.5 14c2.2.3 3.7 1.8 4.3 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconHome({ size = 24, filled = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 11L12 4L20 11V20C20 20.5523 19.5523 21 19 21H15V15H9V21H5C4.44772 21 4 20.5523 4 20V11Z"
        fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconSearch({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M20 20L15.8 15.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  )
}

export function IconPerson({ size = 24, filled = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"/>
      <path d="M4.5 20C5.5 16 8.4 14 12 14C15.6 14 18.5 16 19.5 20"
        fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconChevronRight({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function IconChevronLeft({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// Flying saucer — disc + dome + a couple of beam lines below, for the
// Tools menu's UAP Report entry.
export function IconUap({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="11" rx="9" ry="2.6" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 10.5C8.3 7 10 5.5 12 5.5C14 5.5 15.7 7 16 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M7 13.5L5.5 17M17 13.5L18.5 17M12 14V18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

// Paper-plane — used both for the Discover chrome's inbox entry button and
// the per-pilot message button in ExploreTab.
export function IconSend({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M21 3L3 10.5L11 12.5M21 3L13.5 21L11 12.5M21 3L11 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// Same idea as CopyIconButton: `onDark` inverts to white on dark surfaces
// (glass panels, photo-like weather cards); leave it off on light surfaces
// so the icon stays dark and keeps contrast either way.
export function IconRefresh({ size = 16, onDark = true }) {
  return (
    <img
      src="/refresh.png" alt="" width={size} height={size}
      style={{ display: 'block', filter: onDark ? 'brightness(0) invert(1)' : 'var(--icon-filter)' }}
    />
  )
}
