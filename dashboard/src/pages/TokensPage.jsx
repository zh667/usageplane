// Layout mirrors TokenTracker DashboardPage: left column (stats, model
// ranking, heatmap), right column (range pills, hero total, tool split,
// daily breakdown). Plus our own relay-assets card — the two money scopes
// (estimated vs site-reported) are never merged.
import { useEffect, useState } from "react"
import Heatmap from "../components/Heatmap.jsx"
import { IconRefresh } from "../components/icons.jsx"
import { fmt, getJson } from "../lib/format.js"

const RANGES = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
  ["total", "Total"],
  ["custom", "Custom"],
]

const DAY_COLS = [
  ["day", "Date"],
  ["total_tokens", "Total"],
  ["input_tokens", "Input"],
  ["output_tokens", "Output"],
  ["cached_input_tokens", "Cached"],
  ["reasoning_output_tokens", "Reasoning"],
  ["conversation_count", "Convs"],
]

const PROJECT_COLS = [
  ["project", "Project"],
  ["total_tokens", "Total"],
  ["input_tokens", "Input"],
  ["output_tokens", "Output"],
  ["cached_input_tokens", "Cached"],
  ["reasoning_output_tokens", "Reasoning"],
  ["conversation_count", "Convs"],
  ["estimated_cost", "Cost"],
]

function sortRows(rows, sort) {
  return [...rows].sort((a, b) => {
    const va = a[sort.key]
    const vb = b[sort.key]
    const c = va < vb ? -1 : va > vb ? 1 : 0
    return sort.dir === "asc" ? c : -c
  })
}

/** Accessible sortable header: a real button (keyboard-operable) + aria-sort. */
function SortableHeader({ col, label, numeric, sort, onSort }) {
  const active = sort.key === col
  return (
    <th aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"} className={numeric ? "n" : ""}>
      <button
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-0.5 hover:text-oai-gray-600 dark:hover:text-oai-gray-300${numeric ? " w-full justify-end" : ""}`}
      >
        {label}
        {active && <span aria-hidden="true">{sort.dir === "desc" ? "▾" : "▴"}</span>}
      </button>
    </th>
  )
}

/** Table display keeps the short project name; the full path lives in title. */
const shortProject = (p) => (p === "unknown" || !p ? "Unknown" : p.split(/[\\/]/).filter(Boolean).pop() || p)

export default function TokensPage() {
  const [range, setRange] = useState("month")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [data, setData] = useState(null)
  const [heat, setHeat] = useState([])
  const [relays, setRelays] = useState([])
  const [relayUsage, setRelayUsage] = useState([])
  const [view, setView] = useState("daily")
  const [sort, setSort] = useState({ key: "day", dir: "desc" })
  const [projSort, setProjSort] = useState({ key: "total_tokens", dir: "desc" })
  const [toolDetail, setToolDetail] = useState(null)
  const [err, setErr] = useState(null)

  // Custom waits until both bounds are picked; other ranges fetch directly.
  const query =
    range === "custom" ? (from && to && from <= to ? `range=custom&from=${from}&to=${to}` : null) : `range=${range}`
  useEffect(() => {
    if (!query) return
    getJson(`/api/usage?${query}`).then(setData).catch(setErr)
  }, [query])
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
      <div className="min-w-0 space-y-6">
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
      <div className="min-w-0 space-y-6">
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
              onClick={() => query && getJson(`/api/usage?${query}`).then(setData)}
              title="Refresh"
              className="rounded-full border border-oai-gray-200 p-2 text-oai-gray-500 hover:text-oai-black dark:border-oai-gray-800 dark:hover:text-oai-white"
            >
              <IconRefresh size={14} />
            </button>
          </div>

          {range === "custom" && (
            <div className="mb-6 flex flex-wrap items-center gap-2 text-[13px]">
              <input
                type="date"
                aria-label="From date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-full border border-oai-gray-200 bg-transparent px-3 py-1.5 outline-none focus:border-oai-gray-400 dark:border-oai-gray-800"
              />
              <span className="text-oai-gray-400" aria-hidden="true">→</span>
              <input
                type="date"
                aria-label="To date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-full border border-oai-gray-200 bg-transparent px-3 py-1.5 outline-none focus:border-oai-gray-400 dark:border-oai-gray-800"
              />
              {from && to && from > to && <span className="text-[12px] text-oai-gray-400">start must be ≤ end</span>}
            </div>
          )}

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

          {/* Narrow viewports: 2-up grid; sm+: original horizontal row.
              Cards toggle a per-source model detail panel below. */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:flex">
            {[
              { key: "all", label: "All", total: data.totals.total_tokens, models: models.length },
              ...data.tools.map((t) => ({
                key: t.tool,
                label: t.tool.toUpperCase(),
                total: t.total_tokens,
                models: data.models.filter((m) => m.tool === t.tool && m.model !== "unknown").length,
              })),
            ].map((c) => (
              <button
                key={c.key}
                onClick={() => setToolDetail(toolDetail === c.key ? null : c.key)}
                className={`rounded-xl border px-4 py-3 text-left sm:min-w-[130px] ${
                  toolDetail === c.key
                    ? "border-oai-gray-400 bg-oai-gray-50 dark:border-oai-gray-600 dark:bg-oai-gray-800/60"
                    : "border-oai-gray-200 hover:border-oai-gray-300 dark:border-oai-gray-800 dark:hover:border-oai-gray-700"
                }`}
              >
                <div className="text-[13px] font-medium">{c.label}</div>
                <div className="text-[20px] font-bold">{((c.total / Math.max(1, data.totals.total_tokens)) * 100).toFixed(2)}%</div>
                <div className="text-[11px] text-oai-gray-400">{c.models} models</div>
              </button>
            ))}
          </div>

          {toolDetail && (
            <div className="mt-4 rounded-xl bg-oai-gray-50 px-4 py-3 dark:bg-oai-gray-800/40">
              {/* Share is of ALL models in range (matches the card percentages),
                  not within-source — the headers make the denominator explicit. */}
              <div className="flex items-baseline justify-between border-b border-oai-gray-200 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-oai-gray-400 dark:border-oai-gray-700">
                <span>Model</span>
                <span className="flex shrink-0 gap-4">
                  <span>Tokens</span>
                  <span className="w-14 text-right">% of all</span>
                  <span className="w-16 text-right">Est. cost</span>
                </span>
              </div>
              {(toolDetail === "all" ? models : models.filter((m) => m.tool === toolDetail)).map((m) => (
                <div
                  key={`${m.tool}:${m.model}`}
                  className="flex items-baseline justify-between border-b border-oai-gray-100 py-1.5 text-[13px] last:border-0 dark:border-oai-gray-800/60"
                >
                  <span className="min-w-0 truncate pr-3">{m.model}</span>
                  <span className="flex shrink-0 gap-4 tabular-nums text-oai-gray-500">
                    <span>{fmt(m.total_tokens)}</span>
                    <span className="w-14 text-right">{((m.total_tokens / modelTotal) * 100).toFixed(1)}%</span>
                    <span className="w-16 text-right">${(m.estimated_cost ?? 0).toFixed(2)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="up-card p-6">
          <div role="tablist" aria-label="Usage breakdown view" className="mb-3 flex gap-2 text-[13px]">
            {[
              ["daily", "Daily Breakdown"],
              ["project", "Project Usage"],
            ].map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={`rounded-full px-3 py-1 ${
                  view === key
                    ? "bg-oai-gray-100 font-medium dark:bg-oai-gray-800"
                    : "text-oai-gray-400 hover:text-oai-black dark:hover:text-oai-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {view === "daily" && (
            <div className="overflow-x-auto">
              <table className="up-table min-w-[520px]">
                <thead>
                  <tr>
                    {DAY_COLS.map(([key, label]) => (
                      <SortableHeader
                        key={key}
                        col={key}
                        label={label}
                        numeric={key !== "day"}
                        sort={sort}
                        onSort={(col) => setSort((s) => ({ key: col, dir: s.key === col && s.dir === "desc" ? "asc" : "desc" }))}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortRows(data.days, sort).map((d) => (
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
            </div>
          )}

          {view === "project" && (
            <div className="overflow-x-auto">
              <table className="up-table min-w-[600px]">
                <thead>
                  <tr>
                    {PROJECT_COLS.map(([key, label]) => (
                      <SortableHeader
                        key={key}
                        col={key}
                        label={label}
                        numeric={key !== "project"}
                        sort={projSort}
                        onSort={(col) =>
                          setProjSort((s) => ({ key: col, dir: s.key === col && s.dir === "desc" ? "asc" : "desc" }))
                        }
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortRows(data.projects ?? [], projSort).map((p) => (
                    <tr key={p.project}>
                      <td className="max-w-[180px] truncate" title={p.project}>
                        {shortProject(p.project)}
                      </td>
                      <td className="n">{fmt(p.total_tokens)}</td>
                      <td className="n">{fmt(p.input_tokens)}</td>
                      <td className="n">{fmt(p.output_tokens)}</td>
                      <td className="n">{fmt(p.cached_input_tokens)}</td>
                      <td className="n">{fmt(p.reasoning_output_tokens)}</td>
                      <td className="n">{p.conversation_count}</td>
                      <td className="n">${(p.estimated_cost ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
