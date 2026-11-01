import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import Layout from './Layout'
import AuthGate from './components/AuthGate'
// Centre de recherche IA (accueil) et démarrage
import ResearchHomePage from './pages/ResearchHomePage'
import QuickStartPage from './pages/QuickStartPage'
import OnboardingPage from './pages/OnboardingPage'
// Hubs et favoris
import HubPage from './pages/HubPage'
import FavoritesPage from './pages/FavoritesPage'
// Éditer
import InteractiveTreePage from './pages/InteractiveTreePage'
import PersonPage from './pages/PersonPage'
// Graphiques
import TreePage from './pages/TreePage'
import TimelinePage from './pages/TimelinePage'
import HourglassPage from './pages/charts/HourglassPage'
import PedigreePage from './pages/charts/PedigreePage'
import DescendancyPage from './pages/charts/DescendancyPage'
import FanChartPage from './pages/charts/FanChartPage'
import DoublePedigreePage from './pages/charts/DoublePedigreePage'
import NameDistributionPage from './pages/charts/NameDistributionPage'
import StatisticsPage from './pages/charts/StatisticsPage'
import KinshipPage from './pages/charts/KinshipPage'
import SociogramPage from './pages/charts/SociogramPage'
import CircularTreePage from './pages/charts/CircularTreePage'
import GenogramPage from './pages/charts/GenogramPage'
// Vues
import MapPage from './pages/MapPage'
import VirtualTreePage from './pages/views/VirtualTreePage'
import GlobePage from './pages/views/GlobePage'
import StatsMapPage from './pages/views/StatsMapPage'
import QuizPage from './pages/views/QuizPage'
// Rapports, listes, publication
import ReportPage from './pages/ReportPage'
import StoryPage from './pages/StoryPage'
import ListPage from './pages/ListPage'
import PublicationPage from './pages/publication/PublicationPage'
// Recherche, archives, réglages
import DashboardPage from './pages/DashboardPage'
import ResearchPage from './pages/ResearchPage'
import ArchivesPage from './pages/ArchivesPage'
import QuestionsPage from './pages/QuestionsPage'
import AssistantPage from './pages/AssistantPage'
import SettingsPage from './pages/SettingsPage'
// v0.3 : livre, import de documents, transparence des recherches
import BookPage from './pages/BookPage'
import BookPersonPage from './pages/BookPersonPage'
import BookAnnexPage from './pages/BookAnnexPage'
import DocumentImportPage from './pages/DocumentImportPage'
import ResearchTracePage from './pages/ResearchTracePage'
import SourcesConsultedPage from './pages/SourcesConsultedPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <HashRouter>
        <Routes>
          <Route path="/bienvenue" element={<OnboardingPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<ResearchHomePage />} />
            <Route path="/demarrer" element={<QuickStartPage />} />
            <Route path="/section/:id" element={<HubPage />} />
            <Route path="/favoris" element={<FavoritesPage />} />
            <Route path="/tableau-de-bord" element={<DashboardPage />} />
            <Route path="/arbre-interactif" element={<InteractiveTreePage />} />
            <Route path="/personnes/:id" element={<PersonPage />} />
            <Route path="/arbre" element={<TreePage />} />
            <Route path="/chronologie" element={<TimelinePage />} />
            <Route path="/graphiques/sablier" element={<HourglassPage />} />
            <Route path="/graphiques/ascendance" element={<PedigreePage />} />
            <Route path="/graphiques/descendance" element={<DescendancyPage />} />
            <Route path="/graphiques/eventail" element={<FanChartPage />} />
            <Route path="/graphiques/double-ascendance" element={<DoublePedigreePage />} />
            <Route path="/graphiques/distribution" element={<NameDistributionPage />} />
            <Route path="/graphiques/statistiques" element={<StatisticsPage />} />
            <Route path="/graphiques/liens" element={<KinshipPage />} />
            <Route path="/graphiques/sociogramme" element={<SociogramPage />} />
            <Route path="/graphiques/circulaire" element={<CircularTreePage />} />
            <Route path="/graphiques/genogramme" element={<GenogramPage />} />
            <Route path="/carte" element={<MapPage />} />
            <Route path="/vues/arbre-virtuel" element={<VirtualTreePage />} />
            <Route path="/vues/globe" element={<GlobePage />} />
            <Route path="/vues/cartes-statistiques" element={<StatsMapPage />} />
            <Route path="/vues/quiz" element={<QuizPage />} />
            <Route path="/rapports/:type" element={<ReportPage />} />
            <Route path="/histoire" element={<StoryPage />} />
            <Route path="/listes/:type" element={<ListPage />} />
            <Route path="/publication/:type" element={<PublicationPage />} />
            <Route path="/livre" element={<BookPage />} />
            <Route path="/livre/personne" element={<BookPersonPage />} />
            <Route path="/livre/personne/:id" element={<BookPersonPage />} />
            <Route path="/livre/:annex" element={<BookAnnexPage />} />
            <Route path="/documents/importer" element={<DocumentImportPage />} />
            <Route path="/enquetes/:taskId" element={<ResearchTracePage />} />
            <Route path="/sources-consultees" element={<SourcesConsultedPage />} />
            <Route path="/enquetes" element={<ResearchPage />} />
            <Route path="/archives" element={<ArchivesPage />} />
            <Route path="/questions" element={<QuestionsPage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/parametres" element={<SettingsPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthGate>
  </StrictMode>,
)
