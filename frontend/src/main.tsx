import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import Layout from './Layout'
import DashboardPage from './pages/DashboardPage'
import TreePage from './pages/TreePage'
import TimelinePage from './pages/TimelinePage'
import MapPage from './pages/MapPage'
import ResearchPage from './pages/ResearchPage'
import ArchivesPage from './pages/ArchivesPage'
import QuestionsPage from './pages/QuestionsPage'
import AssistantPage from './pages/AssistantPage'
import SettingsPage from './pages/SettingsPage'
import PersonPage from './pages/PersonPage'
import OnboardingPage from './pages/OnboardingPage'
import StoryPage from './pages/StoryPage'
import AuthGate from './components/AuthGate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
    <HashRouter>
      <Routes>
        <Route path="/bienvenue" element={<OnboardingPage />} />
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/arbre" element={<TreePage />} />
          <Route path="/chronologie" element={<TimelinePage />} />
          <Route path="/carte" element={<MapPage />} />
          <Route path="/histoire" element={<StoryPage />} />
          <Route path="/enquetes" element={<ResearchPage />} />
          <Route path="/archives" element={<ArchivesPage />} />
          <Route path="/questions" element={<QuestionsPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="/personnes/:id" element={<PersonPage />} />
        </Route>
      </Routes>
    </HashRouter>
    </AuthGate>
  </StrictMode>,
)
