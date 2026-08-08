// Sidebar layout mirrors TokenTracker's: grouped nav (GENERAL / TOOLS /
// ACCOUNT), theme toggle bottom-left, GitHub link bottom-right. Rendered
// fixed on desktop and inside a drawer on narrow screens (App decides).
import { NavLink } from "react-router-dom"
import { setPref } from "../lib/prefs.js"
import {
  IconLimits,
  IconPlane,
  IconSessions,
  IconSettings,
  IconSkills,
  IconSun,
  IconTokens,
} from "./icons.jsx"

const GROUPS = [
  {
    label: "GENERAL",
    items: [
      { to: "/", label: "Tokens", Icon: IconTokens },
      { to: "/sessions", label: "Sessions", Icon: IconSessions },
      { to: "/limits", label: "Limits", Icon: IconLimits },
    ],
  },
  {
    label: "TOOLS",
    items: [{ to: "/skills", label: "Skills", Icon: IconSkills }],
  },
  {
    label: "ACCOUNT",
    items: [{ to: "/settings", label: "Settings", Icon: IconSettings }],
  },
]

function toggleTheme() {
  setPref("theme", document.documentElement.classList.contains("dark") ? "light" : "dark")
}

export function Brand() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-oai-black text-white dark:bg-oai-white dark:text-oai-black">
        <IconPlane size={14} />
      </span>
      <span className="text-[15px] font-semibold">UsagePlane</span>
    </span>
  )
}

export default function Sidebar({ onNavigate }) {
  return (
    <aside className="flex h-full w-[216px] shrink-0 flex-col px-2 pb-3 pt-4">
      <div className="px-3 pb-2">
        <Brand />
      </div>

      <nav className="flex-1">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="up-nav-label">{group.label}</div>
            {group.items.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                onClick={onNavigate}
                className={({ isActive }) => `up-nav-item${isActive ? " active" : ""}`}
              >
                <Icon size={15} className="opacity-70" />
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between px-2">
        <button
          onClick={toggleTheme}
          title="Toggle theme"
          className="rounded-full p-1.5 text-oai-gray-500 hover:bg-oai-gray-200 dark:hover:bg-oai-gray-800"
        >
          <IconSun size={15} />
        </button>
        <a
          href="https://github.com/zh667/usageplane"
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-oai-gray-200 px-3 py-1 text-[12px] text-oai-gray-500 hover:text-oai-black dark:border-oai-gray-800 dark:hover:text-oai-white"
        >
          GitHub
        </a>
      </div>
    </aside>
  )
}
