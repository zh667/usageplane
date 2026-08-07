// Mirrors TokenTracker SkillsPage (My Skills tab): agent filter + search +
// count, rows with skill name, description excerpt, and per-agent install
// chips. Browse (cloud skill library) is deferred — it depends on a hosted
// index we don't run yet.
import { useEffect, useMemo, useState } from "react"
import { getJson } from "../lib/format.js"

const AGENT_LABELS = { "claude-code": "Claude", codex: "Codex" }

export default function SkillsPage() {
  const [skills, setSkills] = useState(null)
  const [err, setErr] = useState(null)
  const [agent, setAgent] = useState("all")
  const [q, setQ] = useState("")

  useEffect(() => {
    getJson("/api/skills").then(setSkills).catch(setErr)
  }, [])

  const agents = useMemo(
    () => [...new Set((skills ?? []).flatMap((s) => s.agents))].sort(),
    [skills],
  )

  const filtered = useMemo(() => {
    if (!skills) return []
    const needle = q.trim().toLowerCase()
    return skills.filter((s) => {
      if (agent !== "all" && !s.agents.includes(agent)) return false
      if (needle && !`${s.name} ${s.description}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [skills, agent, q])

  if (err) return <div className="p-8 text-oai-gray-500">load failed: {String(err.message ?? err)}</div>

  return (
    <div className="px-2">
      <h1 className="font-oai text-hero">Skills</h1>

      <div className="mt-4 flex gap-6 border-b border-oai-gray-200 text-[14px] dark:border-oai-gray-800">
        <span className="border-b-2 border-oai-black pb-2 font-medium dark:border-oai-white">My Skills</span>
        <span className="pb-2 text-oai-gray-400" title="云端技能库随官方 hub（v0.3）上线">
          Browse
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-full border border-oai-gray-200 p-0.5 dark:border-oai-gray-800">
          <button onClick={() => setAgent("all")} className={`up-pill${agent === "all" ? " active" : ""}`}>
            All agents
          </button>
          {agents.map((a) => (
            <button key={a} onClick={() => setAgent(a)} className={`up-pill${agent === a ? " active" : ""}`}>
              {AGENT_LABELS[a] ?? a}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter installed skills…"
          className="w-64 rounded-full border border-oai-gray-200 bg-transparent px-4 py-1.5 text-[13px] outline-none placeholder:text-oai-gray-400 focus:border-oai-gray-400 dark:border-oai-gray-800"
        />
        <span className="ml-auto text-[12px] text-oai-gray-400">
          {skills ? `${filtered.length} of ${skills.length} skills` : "loading…"}
        </span>
      </div>

      <div className="mt-2">
        {skills === null && <div className="p-8 text-oai-gray-400">loading…</div>}
        {filtered.map((s) => (
          <div key={s.name} className="border-b border-oai-gray-100 py-3.5 dark:border-oai-gray-800/60">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[14px] font-semibold">{s.name}</span>
              <span className="flex shrink-0 gap-1.5">
                {s.agents.map((a) => (
                  <span
                    key={a}
                    title={`installed for ${a}`}
                    className="rounded-full bg-oai-gray-100 px-2 py-0.5 text-[10px] text-oai-gray-500 dark:bg-oai-gray-800"
                  >
                    {AGENT_LABELS[a] ?? a}
                  </span>
                ))}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 max-w-4xl text-[13px] text-oai-gray-500">{s.description || "—"}</p>
          </div>
        ))}
        {skills !== null && filtered.length === 0 && (
          <div className="p-8 text-center text-oai-gray-400">no skills match</div>
        )}
      </div>
    </div>
  )
}
