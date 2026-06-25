import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useTheme } from './hooks/useTheme'
import Shell from './components/Shell'
import Home from './pages/Home/Home'
import Calculators from './pages/Calculators/Calculators'
import Checklists from './pages/Checklists/Checklists'
import Aircraft from './pages/Aircraft/Aircraft'
import Currency from './pages/Currency/Currency'
import Reference from './pages/Reference/Reference'
import Weather from './pages/Weather/Weather'

export default function App() {
  const { theme } = useTheme()

  return (
    <BrowserRouter>
      <Shell theme={theme}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/calc" element={<Calculators />} />
          <Route path="/checklists" element={<Checklists />} />
          <Route path="/aircraft" element={<Aircraft />} />
          <Route path="/currency" element={<Currency />} />
          <Route path="/reference" element={<Reference />} />
          <Route path="/weather" element={<Weather />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  )
}
