import { TopicHeader, Card, Row, Disclaimer } from '../shared/ui'

// 14 CFR 91.185: Lost communications procedures for IFR flight.
export default function LostComm({ onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TopicHeader title="Lost-Comm Procedures" onBack={onBack} />

      <Card title="First things first" sub="14 CFR 91.185. Applies to IFR flight in IMC. If VFR conditions are encountered, continue in VFR and land as soon as practicable.">
        <Row label="Transponder" value="Squawk 7600" />
        <Row label="Keep flying" value="Continue per route/altitude rules below" last />
      </Card>

      <Card title="Route. Fly, in order" sub="Mnemonic: AVEF">
        <Row label="A: Assigned" value="Last route ATC assigned" />
        <Row label="V: Vectored" value="If being vectored, direct to the fix/route/airway specified in the vector clearance" />
        <Row label="E: Expected" value="Route ATC has told you to expect in a further clearance" />
        <Row label="F: Filed" value="Route filed in your flight plan" last />
      </Card>

      <Card title="Altitude. Fly the HIGHEST of" sub="Mnemonic: MEA">
        <Row label="M: Minimum IFR altitude" value="MEA / MOCA / MSA for the route segment" />
        <Row label="E: Expected" value="Altitude ATC told you to expect in a further clearance" />
        <Row label="A: Assigned" value="Last altitude ATC assigned" last />
      </Card>

      <Card title="At the clearance limit">
        <Row label="Limit is an approach fix" value="Start descent/approach as close as possible to your EFC time, or, if none given, your filed ETA" />
        <Row label="Limit is not an approach fix" value="Leave the fix at your EFC time (or on arrival if none given), proceed to a fix from which an approach begins, and commence approach as close as possible to your filed ETA" last />
      </Card>

      <Disclaimer>
        Study reference only, always fly the actual clearance and consult the AIM (4-2-3, 6-4-1) and your POH/AFM for full procedures.
      </Disclaimer>
    </div>
  )
}
