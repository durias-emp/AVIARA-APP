// Generic "are you sure?" confirmation overlay — same fixed/blurred-backdrop
// card pattern as the custom-aircraft modal in Aircraft.jsx, just factored
// out so any destructive action (delete aircraft, clear recently deleted...)
// can reuse it instead of hand-rolling its own.
export default function ConfirmModal({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, busy = false, onConfirm, onCancel,
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 24px',
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 360,
        background: 'var(--bg-card)',
        borderRadius: 20, padding: '24px 20px 20px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 4, textAlign: 'center' }}>
          {title}
        </h3>
        {message && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18, textAlign: 'center', lineHeight: 1.5 }}>
            {message}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: message ? 0 : 18 }}>
          <button onClick={onCancel} disabled={busy} style={{
            flex: 1, padding: '12px', borderRadius: 'var(--r-md)',
            border: '0.5px solid var(--border)', background: 'var(--bg-card-2)',
            color: 'var(--text-secondary)', fontSize: 15, fontWeight: 500, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>{cancelLabel}</button>
          <button onClick={onConfirm} disabled={busy} style={{
            flex: 1, padding: '12px', borderRadius: 'var(--r-md)', border: 'none',
            background: danger ? 'var(--danger)' : 'var(--accent)',
            color: danger ? '#fff' : 'var(--accent-fg)',
            fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1, fontFamily: 'inherit',
          }}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
