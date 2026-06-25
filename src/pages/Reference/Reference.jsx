import Stub from '../../components/Stub'
import { IconBook } from '../../components/Icons'
import { BackButton } from '../../components/Shell'

export default function Reference() {
  return (
    <div>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton />
        <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>Reference</h2>
      </div>
      <Stub title="Reference Library" Icon={IconBook} desc="Air law · Light signals · Squawk codes · METAR decoder · Chart legends" />
    </div>
  )
}
