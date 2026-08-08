import { useState } from "react"
import { Route, Routes } from "react-router-dom"
import Sidebar, { Brand } from "./components/Sidebar.jsx"
import { IconClose, IconMenu } from "./components/icons.jsx"
import TokensPage from "./pages/TokensPage.jsx"
import SessionsPage from "./pages/SessionsPage.jsx"
import LimitsPage from "./pages/LimitsPage.jsx"
import SkillsPage from "./pages/SkillsPage.jsx"
import SettingsPage from "./pages/SettingsPage.jsx"

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const close = () => setMenuOpen(false)

  return (
    <div className="min-h-screen lg:flex">
      {/* Narrow screens: 56px top bar + drawer nav; the sidebar would
          otherwise eat 216px of an already-small window. */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-oai-gray-200 bg-white/90 px-4 backdrop-blur dark:border-oai-gray-800 dark:bg-oai-gray-900/90 lg:hidden">
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-1.5 text-oai-gray-500 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800"
        >
          <IconMenu size={18} />
        </button>
        <Brand />
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={close} />
          <div className="absolute inset-y-0 left-0 w-[260px] bg-white shadow-xl dark:bg-oai-gray-900">
            <button
              onClick={close}
              aria-label="Close menu"
              className="absolute right-3 top-4 rounded-lg p-1.5 text-oai-gray-500 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800"
            >
              <IconClose size={16} />
            </button>
            <Sidebar onNavigate={close} />
          </div>
        </div>
      )}

      <div className="hidden shrink-0 lg:block">
        <Sidebar />
      </div>

      {/* Pages own their card surfaces — no page-wide outer card. */}
      <main className="min-w-0 flex-1 p-4 lg:py-5 lg:pl-2 lg:pr-6">
        <Routes>
          <Route path="/" element={<TokensPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/limits" element={<LimitsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
