import Stub from '../../components/Stub'
import { IconCloud } from '../../components/Icons'
import { BackButton } from '../../components/Shell'

export default function Weather() {
  return (
    <div>
      <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BackButton />
        <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--text)', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>Weather</h2>
      </div>
      <Stub title="Live Weather" Icon={IconCloud} desc="METAR · TAF · NOTAM · TFR — requires an internet connection" badge="Available in V1.5" />
    </div>
  )
}
