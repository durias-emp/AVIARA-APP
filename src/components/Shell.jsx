import { useLocation, useNavigate } from 'react-router-dom'

function IconChevronLeft({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function BackButton({ onBack }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => onBack ? onBack() : navigate('/')}
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        border: '0.5px solid var(--border)',
        background: 'var(--bg-card)',
        boxShadow: 'var(--shadow-md)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: 'var(--text)',
        flexShrink: 0,
      }}>
      <IconChevronLeft size={18} />
    </button>
  )
}

export default function Shell({ children }) {
  const location = useLocation()
  const isHome = location.pathname === '/'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <main style={{ flex: 1, overflowY: isHome ? 'hidden' : 'auto' }}>
        {children}
      </main>
    </div>
  )
}
