import { removeBackground } from '@imgly/background-removal-node'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const AIRCRAFT = [
  'CESNA 152.png',
  'CENSA 172S.png',
  'Piper PA-28 Archer.png',
  'Cessna 182 Skylane.png',
  'Cirrus SR22.png',
  'Cessna 208B Grand Caravan EX.png',
  'Pilatus PC-12 NGX.png',
  'Beechcraft King Air 350i.png',
  'Robinson R66 Turbine.png',
  'Bell 206B-3 JetRanger III.png',
  'Airbus H125.png',
]

const publicDir = resolve(process.cwd(), 'public')

for (const name of AIRCRAFT) {
  const path = resolve(publicDir, name)
  console.log(`Processing: ${name}`)
  try {
    const buf = readFileSync(path)
    const blob = new Blob([buf], { type: 'image/png' })
    const result = await removeBackground(blob)
    const out = Buffer.from(await result.arrayBuffer())
    writeFileSync(path, out)
    console.log(`  Done: ${name}`)
  } catch (e) {
    console.error(`  Failed: ${name} — ${e.message}`)
  }
}

console.log('All done.')
