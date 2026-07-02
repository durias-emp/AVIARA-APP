import { useLocation, useNavigate } from 'react-router-dom'
import { useOverlayClose } from '../context/OverlayClose'

function IconChevronLeft({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function BackButton({ onBack }) {
  const navigate      = useNavigate()
  const closeOverlay  = useOverlayClose()

  function handleBack() {
    if (onBack)        { onBack();        return }
    if (closeOverlay)  { closeOverlay();  return }
    navigate('/')
  }

  return (
    <button
      onClick={handleBack}
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
    <div className="app-shell">
      <main style={{ flex: 1, overflowY: isHome ? 'hidden' : 'auto' }}>
        {children}
      </main>
    </div>
  )
}
