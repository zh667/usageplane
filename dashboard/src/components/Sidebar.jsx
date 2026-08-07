// Sidebar layout mirrors TokenTracker's: grouped nav (GENERAL / TOOLS /
// ACCOUNT), theme toggle bottom-left, GitHub link bottom-right.
import { NavLink } from "react-router-dom"

const GROUPS = [
  {
    label: "GENERAL",
    items: [
      { to: "/", label: "Tokens", icon: "📊" },
      { to: "/sessions", label: "Sessions", icon: "🕘" },
      { to: "/limits", label: "Limits", icon: "⏱" },
    ],
  },
  {
    label: "TOOLS",
    items: [{ to: "/skills", label: "Skills", icon: "✨" }],
  },
  {
    label: "ACCOUNT",
    items: [{ to: "/settings", label: "Settings", icon: "⚙️" }],
  },
]

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle("dark")
  localStorage.setItem("usageplane-theme", isDark ? "dark" : "light")
}

export default function Sidebar() {
  return (
    <aside className="flex w-[216px] shrink-0 flex-col px-2 pb-3 pt-4">
      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-oai-black text-[13px] text-white dark:bg-oai-white dark:text-oai-black">
          ✈
        </span>
        <span className="text-[15px] font-semibold">UsagePlane</span>
      </div>

      <nav className="flex-1">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <div className="up-nav-label">{group.label}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => `up-nav-item${isActive ? " active" : ""}`}
              >
                <span className="w-4 text-center text-[13px] opacity-70">{item.icon}</span>
                {item.label}
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
          ☀
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
