import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ATCTrainer from './ATCTrainer'
import './prototype.css'

export function PrototypeApp() {
  return (
    <main className="prototypeStage">
      <div className="prototypeDevice">
        <ATCTrainer />
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PrototypeApp />
  </StrictMode>,
)
