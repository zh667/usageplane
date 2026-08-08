// Mirrors TokenTracker LimitsPage: one block per provider, connected ones
// show labeled progress bars per window with reset countdown; the rest show
// "Not connected" plus a diagnosis hint. Adds pace prediction (projected
// usage at reset), a warn-threshold highlight, and provider visibility —
// all driven by Settings → Limits Display preferences.
import { useEffect, useState } from "react"
import { getJson } from "../lib/format.js"
import { getPref } from "../lib/prefs.js"

const ICONS = { claude: "✳", codex: "◎", cursor: "▟", gemini: "✦" }

// Why each provider might be disconnected, and what to do about it.
const CONNECT_HINTS = {
  claude: "未找到订阅 OAuth 凭证——API key/中转站模式的机器没有订阅限额；运行 usageplane doctor 可确认本机认证方式",
  codex: "未找到 ~/.codex/auth.json——用 codex 登录一次即可自动识别",
  cursor: "Cursor 限额采集暂未支持（后续批次）",
  gemini: "Gemini 限额采集暂未支持（后续批次）",
}

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

/** Window length in ms from its label ("5h", "7d", "30d"); null if unknown. */
function windowMs(label) {
  const m = /^(\d+)([hd])$/.exec(label ?? "")
  if (!m) return null
  return Number(m[1]) * (m[2] === "h" ? 3600e3 : 86400e3)
}

/**
 * Linear pace projection: with `used`% consumed and `remaining` ms until
 * reset in a window of `total` ms, usage at reset ≈ used * total / elapsed.
 * Only meaningful once a fair share of the window has elapsed.
 */
function projectedAtReset(w) {
  const total = windowMs(w.label)
  const remaining = w.resets_at ? Date.parse(w.resets_at) - Date.now() : NaN
  if (!total || !Number.isFinite(remaining) || remaining <= 0 || remaining >= total) return null
  const elapsed = total - remaining
  if (elapsed < total * 0.1) return null // too early to extrapolate
  return (w.utilization / elapsed) * total
}

function Bar({ window: w, mode, warnAt }) {
  const used = Math.max(0, Math.min(100, w.utilization))
  const shown = mode === "left" ? 100 - used : used
  const projected = projectedAtReset(w)
  const hot = warnAt !== null && used >= warnAt
  const willCap = projected !== null && projected >= 100 && used < 100
  return (
    <div className="py-1">
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-[12px] text-oai-gray-500">{w.label}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800">
          <div
            className={`h-full rounded-full ${hot ? "bg-red-500" : willCap ? "bg-amber-500" : "bg-brand-500"}`}
            style={{ width: `${used}%` }}
          />
        </div>
        <span className={`w-12 shrink-0 text-right text-[12px] font-semibold ${hot ? "text-red-600" : ""}`}>
          {Math.round(shown)}%
        </span>
        <span className="w-10 shrink-0 text-right text-[11px] text-oai-gray-400">{resetIn(w.resets_at)}</span>
      </div>
      {(hot || willCap) && (
        <div className={`ml-[60px] text-[11px] ${hot ? "text-red-600" : "text-amber-600"}`}>
          {hot ? `已达 ${warnAt}% 告警阈值` : `按当前节奏，重置前将达约 ${Math.round(projected)}%`}
        </div>
      )}
    </div>
  )
}

export default function LimitsPage() {
  const [providers, setProviders] = useState(null)
  const [selfDevice, setSelfDevice] = useState("")
  const [err, setErr] = useState(null)
  const mode = getPref("limitsDisplay", "used")
  const warnPref = getPref("limitsWarn", "80")
  const warnAt = warnPref === "off" ? null : Number(warnPref)
  const hidden = (() => {
    try {
      return JSON.parse(getPref("hiddenProviders", "[]"))
    } catch {
      return []
    }
  })()

  useEffect(() => {
    getJson("/api/limits")
      .then((d) => {
        setSelfDevice(d.device ?? "")
        setProviders(d.providers ?? [])
      })
      .catch(setErr)
  }, [])

  if (err) return <div className="p-8 text-oai-gray-500">load failed: {String(err.message ?? err)}</div>

  const visible = providers?.filter((p) => !hidden.includes(p.id))

  return (
    <div className="px-2">
      <h1 className="font-oai text-hero">Limits</h1>
      <p className="mt-1 text-[15px] text-oai-gray-500">Rate limits and quota usage across your AI tools.</p>

      <div className="up-card mt-6 p-6">
        <div className="up-nav-label px-0">
          USAGE LIMITS · {mode === "left" ? "LEFT" : "USED"}
          {warnAt !== null && <span className="ml-2 font-normal normal-case">告警阈值 {warnAt}%</span>}
        </div>
        {providers === null && <div className="p-6 text-oai-gray-400">loading…</div>}
        {visible?.map((p) => (
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
                  <Bar key={w.label} window={w} mode={mode} warnAt={warnAt} />
                ))}
                {p.error && <div className="mt-1 text-[12px] text-amber-600">{p.error}</div>}
                {p.windows.length === 0 && !p.error && (
                  <div className="text-[12px] text-oai-gray-400">no windows reported</div>
                )}
              </div>
            ) : (
              <div className="mt-1 text-[12px] text-oai-gray-400">
                Not connected
                {CONNECT_HINTS[p.id] && <span className="ml-2">— {CONNECT_HINTS[p.id]}</span>}
              </div>
            )}
          </div>
        ))}
        {visible?.length === 0 && (
          <div className="p-6 text-center text-[13px] text-oai-gray-400">
            所有 Provider 均已在 Settings → Limits Display 中隐藏
          </div>
        )}
      </div>
      <p className="mt-3 text-[12px] text-oai-gray-400">
        限额数据来自本机已登录的订阅凭证，随缓存最长延迟 2 分钟；接口与 Claude Code 共享配额，因此刻意低频。
        预测为线性外推，仅在窗口已过 10% 后显示。
      </p>
    </div>
  )
}
