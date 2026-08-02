import { BackButton } from '../../components/Shell'
import { IconCompass } from '../../components/Icons'

// Placeholder landing spot for the social/marketplace feature — a real
// profile, feed, following, DMs, and an aircraft-for-sale marketplace are
// planned, not built yet. This exists now so the Home button and the name
// ("Discover", working title) are real and tappable while that gets built,
// rather than claiming a feature that isn't there.
export default function Discover() {
  return (
    <div>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton />
        <h2 style={{
          fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
        }}>Discover</h2>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '60px 32px 0', color: 'var(--text-secondary)',
      }}>
        <span style={{ color: 'var(--text-tertiary)', marginBottom: 14 }}>
          <IconCompass size={40} />
        </span>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
          Coming soon
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 280 }}>
          A pilot community feed and an aircraft-for-sale marketplace —
          follow other pilots, share photos, and browse listings, including
          a one-tap listing straight from your Hangar.
        </p>
      </div>
    </div>
  )
}
