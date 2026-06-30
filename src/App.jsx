import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useTheme } from './hooks/useTheme'
import { PilotProfileProvider, usePilotProfile } from './context/PilotProfile'
import Shell from './components/Shell'
import Home from './pages/Home/Home'
import Calculators from './pages/Calculators/Calculators'
import Checklists from './pages/Checklists/Checklists'
import Aircraft from './pages/Aircraft/Aircraft'
import Currency from './pages/Currency/Currency'
import Reference from './pages/Reference/Reference'
import Weather from './pages/Weather/Weather'
import Onboarding from './pages/Onboarding/Onboarding'
import Profile from './pages/Profile/Profile'

function AppRoutes({ theme }) {
  const { profile } = usePilotProfile()

  if (profile === null) return null

  if (!profile.onboardingComplete) return <Onboarding />

  return (
    <Shell theme={theme}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/calc" element={<Calculators />} />
        <Route path="/checklists" element={<Checklists />} />
        <Route path="/aircraft" element={<Aircraft />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/currency" element={<Currency />} />
        <Route path="/reference" element={<Reference />} />
        <Route path="/weather" element={<Weather />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

export default function App() {
  const { theme } = useTheme()

  return (
    <PilotProfileProvider>
      <BrowserRouter>
        <AppRoutes theme={theme} />
      </BrowserRouter>
    </PilotProfileProvider>
  )
}
