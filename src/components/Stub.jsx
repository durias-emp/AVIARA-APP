export default function Stub({ title, desc, Icon, badge }) {
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div style={{
        width: 72,
        height: 72,
        borderRadius: 18,
        background: 'var(--accent-light)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 20px',
        color: 'var(--text-secondary)',
      }}>
        {Icon && <Icon size={32} />}
      </div>
      <h2 style={{
        fontSize: 24,
        fontWeight: 700,
        letterSpacing: '-0.3px',
        color: 'var(--text)',
        marginBottom: 8,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
      }}>{title}</h2>
      <p style={{
        fontSize: 15,
        color: 'var(--text-secondary)',
        lineHeight: 1.5,
        maxWidth: 280,
        margin: '0 auto 20px',
      }}>{desc}</p>
      <span style={{
        display: 'inline-block',
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        background: badge ? 'var(--bg-card)' : 'var(--accent-light)',
        padding: '6px 14px',
        borderRadius: 20,
        border: badge ? '0.5px solid var(--border)' : 'none',
        letterSpacing: '-0.1px',
      }}>
        {badge || 'Coming soon'}
      </span>
    </div>
  )
}
