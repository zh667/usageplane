// Mirrors TokenTracker SettingsPage: left sub-nav (Appearance / Account /
// Limits Display), setting rows with title+description left and control
// right, version footer.
import { useEffect, useState } from "react"
import { IconLimits, IconPalette, IconUser } from "../components/icons.jsx"
import { getJson } from "../lib/format.js"
import { getPref, setPref } from "../lib/prefs.js"

function Seg({ options, value, onChange }) {
  return (
    <div className="up-seg">
      {options.map(([key, label]) => (
        <button key={key} onClick={() => onChange(key)} className={`up-pill${value === key ? " active" : ""}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

function Row({ title, desc, children }) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-oai-gray-100 py-4 first:border-t-0 dark:border-oai-gray-800">
      <div>
        <div className="text-[14px] font-medium">{title}</div>
        <div className="mt-0.5 text-[12px] text-oai-gray-400">{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const SECTIONS = [
  ["appearance", "Appearance", IconPalette],
  ["account", "Account", IconUser],
  ["limits", "Limits Display", IconLimits],
]

export default function SettingsPage() {
  const [section, setSection] = useState("appearance")
  const [meta, setMeta] = useState(null)
  // Preferences live in localStorage; this state only forces re-render.
  const [, bump] = useState(0)
  const set = (name, value) => {
    setPref(name, value)
    bump((n) => n + 1)
  }

  useEffect(() => {
    getJson("/api/summary").then(setMeta).catch(() => {})
  }, [])

  return (
    <div className="mx-auto max-w-page px-2">
      <h1 className="font-oai text-hero">Settings</h1>

      <div className="mt-6 grid gap-8 md:grid-cols-[200px_1fr]">
        <nav>
          {SECTIONS.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={`up-nav-item${section === key ? " active" : ""}`}
            >
              <Icon size={15} className="opacity-70" />
              {label}
            </button>
          ))}
        </nav>

        <div className="up-card px-6 py-2">
          {section === "appearance" && (
            <>
              <div className="up-nav-label px-0">APPEARANCE</div>
              <Row title="Theme" desc="Choose how UsagePlane looks across the dashboard.">
                <Seg
                  options={[["light", "Light"], ["dark", "Dark"], ["system", "System"]]}
                  value={getPref("theme", "system")}
                  onChange={(v) => set("theme", v)}
                />
              </Row>
              <Row title="Currency" desc="Display currency for usage cost estimates (relay balances keep each site's own currency).">
                <Seg
                  options={[["USD", "USD ($)"], ["CNY", "CNY (¥)"]]}
                  value={getPref("currency", "USD")}
                  onChange={(v) => set("currency", v)}
                />
              </Row>
              <Row title="Token numbers" desc="Apply K/M/B or full numbers everywhere.">
                <Seg
                  options={[["compact", "Compact"], ["full", "Full"]]}
                  value={getPref("numbers", "compact")}
                  onChange={(v) => set("numbers", v)}
                />
              </Row>
            </>
          )}

          {section === "account" && (
            <>
              <div className="up-nav-label px-0">ACCOUNT</div>
              <Row title="Device" desc="This device's name in the unified view (set in usageplane.yaml).">
                <span className="font-mono text-[13px]">{meta?.device ?? "—"}</span>
              </Row>
              <Row title="Hub" desc="Aggregation hub this device pushes to / pulls from.">
                <span className="font-mono text-[13px]">
                  {meta?.hub_configured ? (meta?.hub_url ?? "本机即 hub") : "未配置"}
                </span>
              </Row>
              <Row title="Sign in" desc="官方托管 hub 的账号体系随 v0.3 云端模式上线。">
                <span className="text-[13px] text-oai-gray-400">coming in v0.3</span>
              </Row>
            </>
          )}

          {section === "limits" && (
            <>
              <div className="up-nav-label px-0">LIMITS DISPLAY</div>
              <Row title="Progress bars" desc="Show subscription windows as percent used or percent left (applies to the Limits page).">
                <Seg
                  options={[["used", "% used"], ["left", "% left"]]}
                  value={getPref("limitsDisplay", "used")}
                  onChange={(v) => set("limitsDisplay", v)}
                />
              </Row>
              <Row title="Warn threshold" desc="Highlight windows at or above this usage on the Limits page.">
                <Seg
                  options={[["off", "Off"], ["70", "70%"], ["80", "80%"], ["90", "90%"]]}
                  value={getPref("limitsWarn", "80")}
                  onChange={(v) => set("limitsWarn", v)}
                />
              </Row>
              <Row title="Providers" desc="Hide providers you don't use from the Limits page.">
                <div className="flex flex-wrap gap-2">
                  {[["claude", "Claude"], ["codex", "Codex"], ["cursor", "Cursor"], ["gemini", "Gemini"]].map(
                    ([id, label]) => {
                      const hidden = (() => {
                        try {
                          return JSON.parse(getPref("hiddenProviders", "[]"))
                        } catch {
                          return []
                        }
                      })()
                      const isHidden = hidden.includes(id)
                      return (
                        <button
                          key={id}
                          aria-pressed={!isHidden}
                          onClick={() =>
                            set(
                              "hiddenProviders",
                              JSON.stringify(isHidden ? hidden.filter((x) => x !== id) : [...hidden, id]),
                            )
                          }
                          className={`up-pill ${isHidden ? "line-through opacity-50" : "active"}`}
                        >
                          {label}
                        </button>
                      )
                    },
                  )}
                </div>
              </Row>
            </>
          )}
        </div>
      </div>

      <div className="mt-8 text-center text-[12px] text-oai-gray-400">
        UsagePlane v{meta?.version ?? "…"} · <a className="hover:text-oai-gray-600" href="https://github.com/zh667/usageplane" target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </div>
  )
}
