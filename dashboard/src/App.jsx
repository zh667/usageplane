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
    // Full-height app shell: the document never scrolls — the main region
    // owns its scrollbar, so the desktop sidebar stays put at any depth.
    <div className="flex h-dvh flex-col overflow-hidden lg:flex-row">
      {/* Narrow screens: 56px top bar + drawer nav; the sidebar would
          otherwise eat 220px of an already-small window. */}
      <header className="z-20 flex h-14 shrink-0 items-center gap-3 border-b border-oai-gray-200 bg-white px-4 dark:border-oai-gray-800 dark:bg-oai-gray-900 lg:hidden">
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

      <div className="hidden h-full shrink-0 lg:block">
        <Sidebar />
      </div>

      {/* Pages own their card surfaces — no page-wide outer card.
          This is the ONLY vertical scroll region on desktop. */}
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 lg:py-5 lg:pl-2 lg:pr-6">
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
