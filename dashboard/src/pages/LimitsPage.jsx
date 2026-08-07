// Mirrors TokenTracker LimitsPage: one block per provider, connected ones
// show labeled progress bars per window with reset countdown; the rest show
// "Not connected". Respects the Settings → Limits Display preference.
import { useEffect, useState } from "react"
import { getJson } from "../lib/format.js"
import { getPref } from "../lib/prefs.js"

const ICONS = { claude: "✳", codex: "◎", cursor: "▟", gemini: "✦" }

function resetIn(iso) {
  if (!iso) return ""
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return ""
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

function Bar({ window: w, mode }) {
  const used = Math.max(0, Math.min(100, w.utilization))
  const shown = mode === "left" ? 100 - used : used
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-12 shrink-0 text-[12px] text-oai-gray-500">{w.label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${used}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right text-[12px] font-semibold">{Math.round(shown)}%</span>
      <span className="w-10 shrink-0 text-right text-[11px] text-oai-gray-400">{resetIn(w.resets_at)}</span>
    </div>
  )
}

export default function LimitsPage() {
  const [providers, setProviders] = useState(null)
  const [selfDevice, setSelfDevice] = useState("")
  const [err, setErr] = useState(null)
  const mode = getPref("limitsDisplay", "used")

  useEffect(() => {
    getJson("/api/limits")
      .then((d) => {
        setSelfDevice(d.device ?? "")
        setProviders(d.providers ?? [])
      })
      .catch(setErr)
  }, [])

  if (err) return <div className="p-8 text-oai-gray-500">load failed: {String(err.message ?? err)}</div>

  return (
    <div className="px-2">
      <h1 className="font-oai text-hero">Limits</h1>
      <p className="mt-1 text-[15px] text-oai-gray-500">Rate limits and quota usage across your AI tools.</p>

      <div className="up-card mt-6 p-6">
        <div className="up-nav-label px-0">USAGE LIMITS · {mode === "left" ? "LEFT" : "USED"}</div>
        {providers === null && <div className="p-6 text-oai-gray-400">loading…</div>}
        {providers?.map((p) => (
          <div
            key={`${p.device_id}:${p.id}`}
            className="border-t border-oai-gray-100 py-4 first:border-t-0 dark:border-oai-gray-800"
          >
            <div className="flex items-center gap-2 text-[14px] font-medium">
              <span className="text-provider-claude">{ICONS[p.id] ?? "•"}</span>
              {p.name}
              {p.device_id && p.device_id !== selfDevice && (
                <span
                  className="rounded-full bg-oai-gray-100 px-2 py-0.5 text-[10px] font-normal text-oai-gray-500 dark:bg-oai-gray-800"
                  title={`来自 ${p.device_id} 的同步快照`}
                >
                  {p.device_id}
                </span>
              )}
            </div>
            {p.connected ? (
              <div className="mt-2">
                {p.windows.map((w) => (
                  <Bar key={w.label} window={w} mode={mode} />
                ))}
                {p.error && <div className="mt-1 text-[12px] text-amber">{p.error}</div>}
                {p.windows.length === 0 && !p.error && (
                  <div className="text-[12px] text-oai-gray-400">no windows reported</div>
                )}
              </div>
            ) : (
              <div className="mt-1 text-[12px] text-oai-gray-400">Not connected</div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-oai-gray-400">
        限额数据来自本机已登录的订阅凭证，随缓存最长延迟 2 分钟；接口与 Claude Code 共享配额，因此刻意低频。
      </p>
    </div>
  )
}
