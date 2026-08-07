import { Route, Routes } from "react-router-dom"
import Sidebar from "./components/Sidebar.jsx"
import TokensPage from "./pages/TokensPage.jsx"
import SessionsPage from "./pages/SessionsPage.jsx"
import LimitsPage from "./pages/LimitsPage.jsx"
import SkillsPage from "./pages/SkillsPage.jsx"
import SettingsPage from "./pages/SettingsPage.jsx"

export default function App() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1 p-4">
        <div className="up-card min-h-[calc(100vh-2rem)] p-6">
          <Routes>
            <Route path="/" element={<TokensPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/limits" element={<LimitsPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
