// Layout mirrors TokenTracker DashboardPage: left column (stats, model
// ranking, heatmap), right column (range pills, hero total, tool split,
// daily breakdown). Plus our own relay-assets card — the two money scopes
// (estimated vs site-reported) are never merged.
import { useEffect, useState } from "react"
import Heatmap from "../components/Heatmap.jsx"
import { fmt, getJson } from "../lib/format.js"

const RANGES = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
  ["total", "Total"],
]

export default function TokensPage() {
  const [range, setRange] = useState("month")
  const [data, setData] = useState(null)
  const [heat, setHeat] = useState([])
  const [relays, setRelays] = useState([])
  const [relayUsage, setRelayUsage] = useState([])
  const [err, setErr] = useState(null)

  useEffect(() => {
    getJson(`/api/usage?range=${range}`).then(setData).catch(setErr)
  }, [range])
  useEffect(() => {
    getJson("/api/heatmap").then(setHeat).catch(() => {})
    getJson("/api/relays").then(setRelays).catch(() => {})
    getJson("/api/relays/usage").then(setRelayUsage).catch(() => {})
  }, [])

  if (err) return <div className="p-8 text-oai-gray-500">load failed: {String(err.message ?? err)}</div>
  if (!data) return <div className="p-8 text-oai-gray-400">loading…</div>

  const models = data.models.filter((m) => m.model !== "unknown")
  const modelTotal = Math.max(1, models.reduce((s, m) => s + m.total_tokens, 0))

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      {/* left column */}
      <div className="space-y-6">
        <section className="up-card p-5">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              [fmt(data.last7d), "7d"],
              [fmt(data.last30d), "30d"],
              [fmt(data.daily_avg), "avg"],
              [String(data.totals.conversation_count), "convs"],
            ].map(([v, l]) => (
              <div key={l} className="rounded-lg bg-oai-gray-50 px-2 py-3 dark:bg-oai-gray-800/60">
                <div className="text-[17px] font-bold">{v}</div>
                <div className="text-[11px] text-oai-gray-400">{l}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {models.slice(0, 4).map((m, i) => (
              <div key={m.model} className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-oai-gray-100 text-[11px] text-oai-gray-500 dark:bg-oai-gray-800">
                    {i + 1}
                  </span>
                  {m.model}
                </span>
                <span className="font-semibold">{((m.total_tokens / modelTotal) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-between border-t border-oai-gray-100 pt-3 text-[12px] text-oai-gray-400 dark:border-oai-gray-800">
            <span>Started {data.started?.slice(0, 10) ?? "—"}</span>
            <span>Active days {data.active_days}</span>
          </div>
        </section>

        <section className="up-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[12px] font-semibold tracking-wide text-oai-gray-500">ACTIVITY HEATMAP</h3>
            <span className="text-[11px] text-oai-gray-400">UTC</span>
          </div>
          <Heatmap days={heat} />
        </section>

        <section className="up-card p-5">
          <h3 className="mb-3 text-[12px] font-semibold tracking-wide text-oai-gray-500">中转站资产 · 站点报告值</h3>
          {relays.length === 0 && <div className="text-[13px] text-oai-gray-400">未配置中转站</div>}
          {relays.map((r) => {
            const u = relayUsage.find((x) => x.id === r.id)
            return (
              <div key={r.id} className="py-1.5">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-[13px]">{r.id} ({r.type})</div>
                    <div className="text-[11px] text-oai-gray-400">
                      {r.error ? `error — ${r.error}` : r.used_usd !== undefined ? `used ${r.currency}${r.used_usd.toFixed(4)}` : ""}
                    </div>
                  </div>
                  <div className="text-[18px] font-bold">
                    {r.error ? "—" : r.unlimited ? "∞" : r.balance_usd !== undefined ? `${r.currency}${r.balance_usd.toFixed(2)}` : "n/a"}
                  </div>
                </div>
                {u?.supported && !u.error && (
                  <div className="mt-2 rounded-lg bg-oai-gray-50 px-3 py-2 dark:bg-oai-gray-800/60">
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className="text-oai-gray-400">
                        今日消费{u.partial ? "（分页截断，可能偏低）" : ""} · {u.requests} 次请求
                      </span>
                      <span className="text-[14px] font-bold">{r.currency}{u.usd.toFixed(4)}</span>
                    </div>
                    {(u.models ?? []).slice(0, 5).map((m) => (
                      <div key={m.model} className="mt-1 flex items-center justify-between text-[11px] text-oai-gray-500">
                        <span className="truncate pr-2">{m.model}</span>
                        <span className="shrink-0">{r.currency}{m.usd.toFixed(4)} · {m.requests}</span>
                      </div>
                    ))}
                  </div>
                )}
                {u?.error && <div className="mt-1 text-[11px] text-oai-gray-400">今日用量不可用 — {u.error}</div>}
              </div>
            )
          })}
        </section>
      </div>

      {/* right column */}
      <div className="space-y-6">
        <section className="up-card p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex gap-1">
              {RANGES.map(([key, label]) => (
                <button key={key} onClick={() => setRange(key)} className={`up-pill${range === key ? " active" : ""}`}>
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => getJson(`/api/usage?range=${range}`).then(setData)}
              className="rounded-full border border-oai-gray-200 px-3 py-1.5 text-[13px] text-oai-gray-500 hover:text-oai-black dark:border-oai-gray-800 dark:hover:text-oai-white"
            >
              ↻
            </button>
          </div>

          <div className="text-center">
            <div className="text-[12px] font-semibold tracking-[0.15em] text-oai-gray-400">TOTAL TOKENS</div>
            <div className="mt-1 font-oai text-display">{fmt(data.totals.total_tokens)}</div>
            <div
              className="mt-2 text-[18px] font-bold text-brand-600"
              title="按官方标价估算（订阅用量为等价成本）；estimated 口径，永不与中转站实扣相加"
            >
              ${(data.estimated_cost ?? 0).toFixed(2)}
            </div>
          </div>

          <div className="mt-6 h-1 rounded-full bg-provider-claude" />

          <div className="mt-5 flex gap-3">
            {[{ tool: "All", total: data.totals.total_tokens, models: models.length }, ...data.tools.map((t) => ({ tool: t.tool.toUpperCase(), total: t.total_tokens, models: data.models.filter((m) => m.tool === t.tool && m.model !== "unknown").length }))].map((c) => (
              <div key={c.tool} className="min-w-[130px] rounded-xl border border-oai-gray-200 px-4 py-3 dark:border-oai-gray-800">
                <div className="text-[13px] font-medium">{c.tool}</div>
                <div className="text-[20px] font-bold">{((c.total / Math.max(1, data.totals.total_tokens)) * 100).toFixed(2)}%</div>
                <div className="text-[11px] text-oai-gray-400">{c.models} models</div>
              </div>
            ))}
          </div>
        </section>

        <section className="up-card p-6">
          <div className="mb-3 flex gap-4 text-[13px]">
            <span className="rounded-full bg-oai-gray-100 px-3 py-1 font-medium dark:bg-oai-gray-800">Daily Breakdown</span>
          </div>
          <table className="up-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="n">Total</th>
                <th className="n">Input</th>
                <th className="n">Output</th>
                <th className="n">Cached</th>
                <th className="n">Reasoning</th>
                <th className="n">Convs</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td className="n">{fmt(d.total_tokens)}</td>
                  <td className="n">{fmt(d.input_tokens)}</td>
                  <td className="n">{fmt(d.output_tokens)}</td>
                  <td className="n">{fmt(d.cached_input_tokens)}</td>
                  <td className="n">{fmt(d.reasoning_output_tokens)}</td>
                  <td className="n">{d.conversation_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}
