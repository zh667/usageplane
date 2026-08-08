// Mirrors TokenTracker SkillsPage (My Skills tab): agent filter + search +
// count, rows with skill name, description excerpt, and per-agent install
// chips. Detail drawer manages LOCAL user-scope installs via link toggles;
// plugin caches stay read-only and remote rows are display-only. Browse
// (cloud skill library) is deferred — it depends on a hosted index.
import { useEffect, useMemo, useState } from "react"
import { IconClose, IconRefresh } from "../components/icons.jsx"
import ProviderIcon, { BRAND_CLASS } from "../components/ProviderIcon.jsx"
import { getJson } from "../lib/format.js"

const AGENT_LABELS = { "claude-code": "Claude", codex: "Codex", agents: "Shared" }
const MANAGED_AGENTS = ["claude-code", "codex", "agents"]
const SCOPES = [
  ["all", "All sources"],
  ["user", "User"],
  ["plugin", "Plugin"],
]

/** Must mirror the server's skillKey() — used to address rows in the API. */
const clientKey = (s) => `${s.scope}:${s.source ?? ""}:${s.name.toLowerCase()}`

/** Fixed three-column agent icon matrix: installed marks get full brand
 *  color, absent ones stay faint — rows stay vertically aligned. */
function AgentMatrix({ agents, device }) {
  return (
    <span className="grid w-[66px] shrink-0 grid-cols-3 justify-items-center">
      {MANAGED_AGENTS.map((a) => (
        <ProviderIcon
          key={a}
          id={a}
          size={14}
          label={`${AGENT_LABELS[a]}${agents.includes(a) ? " installed" : " not installed"}${device ? ` on ${device}` : ""}`}
          className={agents.includes(a) ? BRAND_CLASS[a] : "opacity-15"}
        />
      ))}
    </span>
  )
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
  return data
}

export default function SkillsPage() {
  const [skills, setSkills] = useState(null)
  const [selfDevice, setSelfDevice] = useState("")
  const [err, setErr] = useState(null)
  const [agent, setAgent] = useState("all")
  const [scope, setScope] = useState("all")
  const [q, setQ] = useState("")
  const [detail, setDetail] = useState(null) // the selected list row
  const [localInfo, setLocalInfo] = useState(null) // /api/skills/detail for local rows
  const [opMsg, setOpMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const reload = () =>
    getJson("/api/skills")
      .then((d) => {
        setSelfDevice(d.device ?? "")
        setSkills(d.skills ?? [])
        return d
      })
      .catch(setErr)

  useEffect(() => {
    reload()
  }, [])

  const openDetail = (s) => {
    setDetail(s)
    setOpMsg(null)
    setLocalInfo(null)
    getJson(`/api/skills/detail?key=${encodeURIComponent(clientKey(s))}`)
      .then(setLocalInfo)
      .catch(() => setLocalInfo(null)) // 404 = not installed locally (remote-only row)
  }

  const toggle = async (agentId, enable) => {
    if (!detail) return
    setBusy(true)
    setOpMsg(null)
    try {
      const r = await postJson("/api/skills/toggle", { key: clientKey(detail), agent: agentId, enable })
      setOpMsg({ ok: true, text: r.message })
      const d = await reload()
      const fresh = (d?.skills ?? []).find((x) => clientKey(x) === clientKey(detail))
      if (fresh) setDetail(fresh)
      getJson(`/api/skills/detail?key=${encodeURIComponent(clientKey(detail))}`)
        .then(setLocalInfo)
        .catch(() => setLocalInfo(null))
    } catch (e) {
      setOpMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const refresh = async () => {
    setBusy(true)
    try {
      await postJson("/api/skills/refresh")
      await reload()
    } finally {
      setBusy(false)
    }
  }

  // --- Browse (discover) tab ------------------------------------------------
  const [tab, setTab] = useState("my")
  const [browse, setBrowse] = useState(null) // {skills, cached, error}
  const [browseQ, setBrowseQ] = useState("")
  const [installMsg, setInstallMsg] = useState(null)

  const loadBrowse = (force = false) => {
    setBrowse(null)
    getJson(`/api/skills/discover${force ? "?force=1" : ""}`)
      .then(setBrowse)
      .catch((e) => setBrowse({ skills: [], error: e.message }))
  }
  useEffect(() => {
    if (tab === "browse" && browse === null) loadBrowse()
  }, [tab])

  const install = async (s) => {
    setBusy(true)
    setInstallMsg(null)
    try {
      const r = await postJson("/api/skills/install", { key: s.key })
      setInstallMsg({ ok: true, text: `${r.message} — Claude: ${r.linked?.["claude-code"]}, Codex: ${r.linked?.codex}` })
      loadBrowse()
      reload()
    } catch (e) {
      setInstallMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const uninstall = async (s) => {
    setBusy(true)
    setInstallMsg(null)
    try {
      const r = await postJson("/api/skills/uninstall", { key: s.key })
      setInstallMsg({ ok: true, text: r.message })
      loadBrowse()
      reload()
    } catch (e) {
      setInstallMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const browseFiltered = (browse?.skills ?? []).filter((s) => {
    const needle = browseQ.trim().toLowerCase()
    return !needle || `${s.name} ${s.description} ${s.repo_owner}/${s.repo_name}`.toLowerCase().includes(needle)
  })

  const agents = useMemo(
    () => [...new Set((skills ?? []).flatMap((s) => s.agents))].sort(),
    [skills],
  )

  const filtered = useMemo(() => {
    if (!skills) return []
    const needle = q.trim().toLowerCase()
    return skills.filter((s) => {
      if (agent !== "all" && !s.agents.includes(agent)) return false
      if (scope !== "all" && (s.scope ?? "user") !== scope) return false
      if (needle && !`${s.name} ${s.description} ${s.source ?? ""}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [skills, agent, scope, q])

  if (err) return <div className="p-8 text-oai-gray-500">load failed: {String(err.message ?? err)}</div>

  return (
    <div className="mx-auto max-w-page px-2">
      <h1 className="font-oai text-hero">Skills</h1>

      <div
        role="tablist"
        aria-label="Skills view"
        className="mt-4 flex gap-6 border-b border-oai-gray-200 text-[14px] dark:border-oai-gray-800"
        onKeyDown={(e) => {
          // WAI-ARIA Tabs: arrows move AND activate, focus follows.
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
          const next = tab === "my" ? "browse" : "my"
          setTab(next)
          document.getElementById(`skills-tab-${next}`)?.focus()
        }}
      >
        {[
          ["my", "My Skills"],
          ["browse", "Browse"],
        ].map(([key, label]) => (
          <button
            key={key}
            id={`skills-tab-${key}`}
            role="tab"
            aria-selected={tab === key}
            aria-controls={`skills-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "border-b-2 border-oai-black pb-2 font-medium dark:border-oai-white"
                : "pb-2 text-oai-gray-400 hover:text-oai-black dark:hover:text-oai-white"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "browse" && (
        <div id="skills-panel-browse" role="tabpanel" aria-labelledby="skills-tab-browse">
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              value={browseQ}
              onChange={(e) => setBrowseQ(e.target.value)}
              placeholder="Search discoverable skills…"
              className="up-input w-72"
            />
            <button
              onClick={() => loadBrowse(true)}
              disabled={busy || browse === null}
              title="Refetch the skill repositories (bypasses the 1h cache)"
              className="up-btn h-8 w-8 justify-center px-0"
            >
              <IconRefresh size={14} />
            </button>
            <span className="ml-auto text-[12px] text-oai-gray-400">
              {browse === null ? "fetching repositories…" : `${browseFiltered.length} of ${browse.skills.length} skills${browse.cached ? " · cached" : ""}`}
            </span>
          </div>
          {installMsg && (
            <div className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${installMsg.ok ? "bg-brand-500/10 text-brand-600" : "bg-red-500/10 text-red-600"}`}>
              {installMsg.text}
            </div>
          )}
          {browse?.partial && (
            <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-600">
              部分仓库获取失败，目录可能不完整（稍后自动重试）：{(browse.errors ?? []).join("；")}
            </div>
          )}
          {browse?.error && <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-600">{browse.error}</div>}
          {browse === null && <div className="p-8 text-oai-gray-400">loading…</div>}
          {/* Equal-height card grid: 3 cols wide, 2 medium, 1 narrow. */}
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {browseFiltered.map((s) => (
              <div key={s.key} className="up-card flex h-full flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate text-[14px] font-semibold">{s.name}</span>
                  <a
                    href={s.readme_url}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-[150px] shrink-0 truncate text-[11px] text-oai-gray-400 hover:text-accent"
                    title={`${s.repo_owner}/${s.repo_name} — view SKILL.md on GitHub`}
                  >
                    {s.repo_owner}/{s.repo_name}
                  </a>
                </div>
                <p className="mt-1.5 line-clamp-3 flex-1 text-[13px] leading-relaxed text-oai-gray-500">
                  {s.description || "—"}
                </p>
                <div className="mt-3 flex items-center justify-between border-t border-oai-gray-100 pt-3 dark:border-oai-gray-800">
                  <span className="flex items-center gap-1.5 text-oai-gray-400" title="安装目标：Claude 与 Codex">
                    <ProviderIcon id="claude" size={14} className={s.installed ? BRAND_CLASS.claude : ""} />
                    <ProviderIcon id="codex" size={14} className={s.installed ? BRAND_CLASS.codex : ""} />
                  </span>
                  {s.installed ? (
                    <span className="flex items-center gap-2">
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success dark:bg-success-dark/10 dark:text-success-dark">
                        Installed
                      </span>
                      <button onClick={() => uninstall(s)} disabled={busy} className="up-btn danger-hover h-7 text-[12px]">
                        卸载
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => install(s)}
                      disabled={busy}
                      title="下载到 UsagePlane 托管目录并链接给 Claude 与 Codex"
                      className="up-btn primary h-7 text-[12px]"
                    >
                      安装
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {browse !== null && browseFiltered.length === 0 && !browse?.error && (
            <div className="p-8 text-center text-oai-gray-400">no skills match</div>
          )}
        </div>
      )}

      {tab === "my" && (
      <div id="skills-panel-my" role="tabpanel" aria-labelledby="skills-tab-my">
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="up-seg">
          <button onClick={() => setAgent("all")} className={`up-pill${agent === "all" ? " active" : ""}`}>
            All agents
          </button>
          {agents.map((a) => (
            <button key={a} onClick={() => setAgent(a)} className={`up-pill${agent === a ? " active" : ""}`}>
              {AGENT_LABELS[a] ?? a}
            </button>
          ))}
        </div>
        <div className="up-seg">
          {SCOPES.map(([key, label]) => (
            <button key={key} onClick={() => setScope(key)} className={`up-pill${scope === key ? " active" : ""}`}>
              {label}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter installed skills…"
          className="up-input w-64"
        />
        <button
          onClick={refresh}
          disabled={busy}
          title="Rescan skill directories (no files are modified)"
          className="up-btn h-8 w-8 justify-center px-0"
        >
          <IconRefresh size={14} />
        </button>
        <span className="ml-auto text-[12px] text-oai-gray-400">
          {skills ? `${filtered.length} of ${skills.length} skills` : "loading…"}
        </span>
      </div>

      <div className="up-card mt-4 px-5">
        {skills === null && <div className="p-8 text-oai-gray-400">loading…</div>}
        {filtered.map((s) => (
          <div
            key={`${s.scope}:${s.source ?? ""}:${s.name}`}
            onClick={() => openDetail(s)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openDetail(s))}
            className="-mx-2 cursor-pointer border-b border-oai-gray-100 px-2 py-3.5 last:border-0 hover:bg-oai-gray-50 dark:border-oai-gray-800/60 dark:hover:bg-oai-gray-800/40"
          >
            {/* flex-wrap lets the matrix drop to its own row on narrow
                viewports instead of stretching the document sideways. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="flex min-w-0 items-center gap-2 text-[14px] font-semibold">
                <span className="truncate">{s.name}</span>
                {s.scope === "plugin" && (
                  <span
                    title={`plugin cache${s.source ? ` — ${s.source}` : ""} (read-only inventory)`}
                    className="max-w-[220px] truncate rounded-full bg-oai-gray-100 px-2 py-0.5 text-[10px] font-normal text-oai-gray-400 dark:bg-oai-gray-800"
                  >
                    Plugin{s.source ? ` · ${s.source}` : ""}
                  </span>
                )}
              </span>
              {/* Explicit device×agent view — the local device is labeled too,
                  so the same skill reads identically from any device's page.
                  Fixed-width icon matrix keeps every row's columns aligned. */}
              <span className="ml-auto flex min-w-0 flex-col items-end gap-0.5">
                {(s.installs ?? [{ device: "", agents: s.agents }]).map((inst) => (
                  <span key={inst.device} className="flex items-center gap-2">
                    <span
                      className={`max-w-[160px] truncate text-[10px] ${inst.device === selfDevice ? "text-oai-gray-500" : "text-oai-gray-400"}`}
                    >
                      {inst.device === selfDevice ? `${inst.device} (本机)` : inst.device || "—"}
                    </span>
                    <AgentMatrix agents={inst.agents} device={inst.device} />
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
      )}

      {detail && (
        <div className="fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/20" onClick={() => setDetail(null)} />
          <aside className="absolute inset-y-0 right-0 w-[400px] max-w-full overflow-y-auto border-l border-oai-gray-200 bg-white p-6 shadow-xl dark:border-oai-gray-800 dark:bg-oai-gray-900">
            <div className="flex items-start justify-between gap-3">
              <h2 className="min-w-0 truncate text-[18px] font-semibold">{detail.name}</h2>
              <button
                onClick={() => setDetail(null)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-oai-gray-500 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800"
              >
                <IconClose size={16} />
              </button>
            </div>

            {detail.scope === "plugin" && (
              <div className="mt-2 rounded-lg bg-oai-gray-50 px-3 py-2 text-[12px] text-oai-gray-500 dark:bg-oai-gray-800/60">
                Plugin cache{detail.source ? ` · ${detail.source}` : ""} — 只读盘点项，随插件升级更新，不提供管理操作
              </div>
            )}

            <p className="mt-3 text-[13px] leading-relaxed text-oai-gray-500">{detail.description || "—"}</p>

            <div className="up-nav-label mt-5 px-0">INSTALLS</div>
            {(detail.installs ?? []).map((inst) => (
              <div key={inst.device} className="flex items-center justify-between py-1 text-[13px]">
                <span className={inst.device === selfDevice ? "font-medium" : "text-oai-gray-400"}>
                  {inst.device === selfDevice ? `${inst.device} (本机)` : inst.device}
                </span>
                <AgentMatrix agents={inst.agents} device={inst.device} />
              </div>
            ))}

            {localInfo?.manageable && (
              <>
                <div className="up-nav-label mt-5 px-0">本机 AGENT 安装管理</div>
                {MANAGED_AGENTS.map((a) => {
                  const installed = Boolean(localInfo.paths?.[a])
                  const st = localInfo.install_states?.[a]
                  // Removal is only offered where unlink would succeed: our
                  // own link with at least one other install remaining.
                  const stateLabel = !installed
                    ? null
                    : st?.state === "real"
                      ? "真实目录"
                      : st?.state === "foreign-link"
                        ? "手工链接"
                        : st?.removable
                          ? "已安装"
                          : "唯一安装"
                  return (
                    <div key={a} className="flex items-center justify-between py-1.5 text-[13px]">
                      <span className="flex min-w-0 items-center gap-2 truncate" title={localInfo.paths?.[a] ?? ""}>
                        <ProviderIcon id={a} size={15} className={installed ? BRAND_CLASS[a] : "opacity-30"} />
                        {AGENT_LABELS[a] ?? a}
                        {stateLabel && <span className="ml-1 text-[11px] text-oai-gray-400">{stateLabel}</span>}
                      </span>
                      {!installed && (
                        <button onClick={() => toggle(a, true)} disabled={busy} className="up-btn primary h-7 text-[12px]">
                          安装
                        </button>
                      )}
                      {installed && st?.removable && (
                        <button onClick={() => toggle(a, false)} disabled={busy} className="up-btn danger-hover h-7 text-[12px]">
                          移除链接
                        </button>
                      )}
                    </div>
                  )
                })}
                <p className="mt-2 text-[11px] leading-relaxed text-oai-gray-400">
                  安装 = 在目标 agent 的技能根目录创建链接（Windows junction / Unix symlink）；移除只删除
                  UsagePlane 自己创建的链接，真实技能目录与手工链接永不触碰。
                </p>
              </>
            )}
            {localInfo === null && detail.scope !== "plugin" && !(detail.devices ?? []).includes(selfDevice) && (
              <p className="mt-4 text-[12px] text-oai-gray-400">
                此技能仅安装在远端设备，本机不代操作其文件；到对应设备上管理。
              </p>
            )}

            {opMsg && (
              <div className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${opMsg.ok ? "bg-brand-500/10 text-brand-600" : "bg-red-500/10 text-red-600"}`}>
                {opMsg.text}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
