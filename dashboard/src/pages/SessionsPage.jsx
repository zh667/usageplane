// Mirrors TokenTracker SessionsPage: filter row (tool pills, time range,
// search, count), session rows with metadata columns and a one-click
// resume-command copy button.
import { useEffect, useMemo, useState } from "react"
import { fmt, getJson } from "../lib/format.js"

const TOOLS = [
  ["all", "All"],
  ["claude-code", "Claude Code"],
  ["codex", "Codex"],
]
const AGES = [
  ["all", "All"],
  ["7", "7d"],
  ["30", "30d"],
  ["90", "90d"],
]

function fmtDuration(ms) {
  const m = Math.round(ms / 60000)
  if (m < 1) return "<1m"
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function fmtDate(iso) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function CopyButton({ command }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(command).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      title={command}
      className="shrink-0 rounded-full border border-oai-gray-200 px-3 py-1.5 text-[12px] text-oai-gray-500 hover:text-oai-black dark:border-oai-gray-800 dark:hover:text-oai-white"
    >
      {copied ? "✓ Copied" : ">_ Copy command"}
    </button>
  )
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState(null)
  const [err, setErr] = useState(null)
  const [tool, setTool] = useState("all")
  const [age, setAge] = useState("all")
  const [q, setQ] = useState("")

  useEffect(() => {
    getJson("/api/sessions").then(setSessions).catch(setErr)
  }, [])

  const filtered = useMemo(() => {
    if (!sessions) return []
    const cutoff = age === "all" ? null : Date.now() - Number(age) * 24 * 3600 * 1000
    const needle = q.trim().toLowerCase()
    return sessions.filter((s) => {
      if (tool !== "all" && s.tool !== tool) return false
      if (cutoff && (!s.ended_at || Date.parse(s.ended_at) < cutoff)) return false
      if (needle && !`${s.title} ${s.project} ${s.model}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [sessions, tool, age, q])

  if (err) return <div className="p-8 text-oai-gray-500">load failed: {String(err.message ?? err)}</div>

  return (
    <div className="px-2">
      <h1 className="font-oai text-hero">Sessions</h1>
      <p className="mt-1 text-[15px] text-oai-gray-500">
        Browse your local Claude Code and Codex sessions and copy a resume command in one click.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex rounded-full border border-oai-gray-200 p-0.5 dark:border-oai-gray-800">
          {TOOLS.map(([key, label]) => (
            <button key={key} onClick={() => setTool(key)} className={`up-pill${tool === key ? " active" : ""}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-full border border-oai-gray-200 p-0.5 dark:border-oai-gray-800">
          {AGES.map(([key, label]) => (
            <button key={key} onClick={() => setAge(key)} className={`up-pill${age === key ? " active" : ""}`}>
              {label}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title, project, model…"
          className="w-64 rounded-full border border-oai-gray-200 bg-transparent px-4 py-1.5 text-[13px] outline-none placeholder:text-oai-gray-400 focus:border-oai-gray-400 dark:border-oai-gray-800"
        />
        <span className="ml-auto text-[12px] text-oai-gray-400">
          {sessions ? `${filtered.length} of ${sessions.length}` : "loading…"}
        </span>
      </div>

      <div className="mt-4">
        {sessions === null && <div className="p-8 text-oai-gray-400">loading…</div>}
        {filtered.map((s) => (
          <div
            key={`${s.tool}:${s.id}`}
            className="flex items-center gap-4 border-b border-oai-gray-100 py-3.5 dark:border-oai-gray-800/60"
          >
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.tool === "codex" ? "bg-provider-codex" : "bg-provider-claude"}`}
              title={s.tool}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium">{s.title}</div>
              <div className="mt-0.5 text-[12px] text-oai-gray-400">
                {[s.project || "—", s.model, fmtDate(s.ended_at), fmtDuration(s.duration_ms)].join(" · ")}
              </div>
            </div>
            <div className="flex shrink-0 gap-5 text-right">
              {[
                [fmt(s.total_tokens), "Tokens"],
                [String(s.turns), "Turns"],
                [String(s.edits), "Edits"],
              ].map(([v, l]) => (
                <div key={l} className="w-14">
                  <div className="text-[13px] font-semibold">{v}</div>
                  <div className="text-[11px] text-oai-gray-400">{l}</div>
                </div>
              ))}
            </div>
            <CopyButton command={s.resume_command} />
          </div>
        ))}
        {sessions !== null && filtered.length === 0 && (
          <div className="p-8 text-center text-oai-gray-400">no sessions match</div>
        )}
      </div>
    </div>
  )
}
