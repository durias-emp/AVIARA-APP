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

export function IconGear({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V19.9a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H4.1a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10a1.7 1.7 0 0 0 1.04-1.56V4.1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10a1.7 1.7 0 0 0 1.56 1.04h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.56 1.04z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
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
