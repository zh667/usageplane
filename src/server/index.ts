// Local HTTP API + dashboard host. Routing style follows TokenTracker's
// src/lib/local-api.js (plain node:http, no framework) — MIT-inspired
// structure, no code copied.

import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig, resolveHubToken } from "../core/config.js"
import { dataDir, dbPath } from "../core/paths.js"
import { Store, type DeviceStateRow, type SessionRow } from "../core/store.js"
import type { UsageRecord } from "../core/types.js"
import { allLimits } from "../core/limits.js"
import { computeRowCost } from "../core/pricing.js"
import { listSessionsCached } from "../core/sessions.js"
import { listSkills, skillKey, skillStateRows } from "../core/skills.js"
import { classifyInstalls, linkSkill, unlinkSkill } from "../core/skill-links.js"
import { discoverSkills, installDiscoveredSkill, readManaged, uninstallManagedSkill } from "../core/skill-discover.js"
import { runPush } from "../commands/push.js"
import { getAdapter } from "../relays/index.js"
import { DASHBOARD_HTML } from "./dashboard-html.js"

const MAX_INGEST_BYTES = 32 * 1024 * 1024

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

/** Discover installs always target these agents; per-agent tuning happens
 *  afterwards in the My Skills drawer. Never taken from the request body. */
const INSTALL_AGENTS = ["claude-code", "codex"] as const

/**
 * Guard for unauthenticated endpoints that WRITE to the local filesystem.
 * Loopback binding alone doesn't stop DNS rebinding or a browser page firing
 * cross-site requests at local ports, so require all of:
 *  - a loopback Host header (rebinding leaves the attacker's hostname here)
 *  - a loopback Origin / non-cross-site Sec-Fetch-Site when the browser sends them
 *  - a JSON content type (plain cross-site forms cannot produce one)
 */
function rejectNonLocalWrite(req: http.IncomingMessage): string | null {
  const hostHeader = String(req.headers.host ?? "")
  const host = hostHeader.replace(/:\d+$/, "")
  if (!LOCAL_HOSTNAMES.has(host)) return "writes are only accepted from localhost"
  const origin = req.headers.origin
  if (typeof origin === "string" && origin !== "") {
    // STRICT same-origin: scheme+host+port must equal this request's own
    // authority. "null" (opaque/sandboxed contexts) is rejected too — being
    // loopback-adjacent is not the same as being our page.
    if (origin.toLowerCase() !== `http://${hostHeader.toLowerCase()}`) return "cross-origin write rejected"
  }
  const site = req.headers["sec-fetch-site"]
  if (typeof site === "string" && site !== "" && !["same-origin", "same-site", "none"].includes(site)) {
    return "cross-site write rejected"
  }
  if (!String(req.headers["content-type"] ?? "").includes("application/json")) {
    return "content-type must be application/json"
  }
  return null
}

const VERSION = (() => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
    ) as { version?: string }
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
})()

/** Hub token presence without throwing on unset token_env (summary must not 500). */
function resolveHubTokenSafe(cfg: ReturnType<typeof loadConfig>): string | undefined {
  try {
    return resolveHubToken(cfg.hub)
  } catch {
    return undefined
  }
}

// Built React dashboard (dashboard/dist). Falls back to the legacy inline
// page when not built, so `npx tsx` from a fresh clone still shows something.
const DIST_DIR = fileURLToPath(new URL("../../dashboard/dist", import.meta.url))

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json",
}

/** Range key → since ISO (null = all time). Day is since UTC midnight; week/month are rolling. */
function rangeSince(range: string): string | null | undefined {
  const now = Date.now()
  switch (range) {
    case "day": {
      const d = new Date(now)
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
    }
    case "week":
      return new Date(now - 7 * 24 * 3600 * 1000).toISOString()
    case "month":
      return new Date(now - 30 * 24 * 3600 * 1000).toISOString()
    case "total":
      return null
    default:
      return undefined
  }
}

const RELAY_CACHE_MS = 60_000

interface RelayStatus {
  id: string
  type: string
  currency: string
  scope?: "account" | "key"
  balance_usd?: number
  used_usd?: number
  unlimited?: boolean
  error?: string
}

/** Build the local server. Reads config/store from `dir` on every request so `sync` results appear without restart. */
interface RelayUsageStatus {
  id: string
  type: string
  currency: string
  usd?: number
  requests?: number
  prompt_tokens?: number
  completion_tokens?: number
  models?: { model: string; usd: number; requests: number; prompt_tokens: number; completion_tokens: number }[]
  partial?: boolean
  supported: boolean
  error?: string
}

export function createServer(dir = dataDir(), homeDir = os.homedir()): http.Server {
  let relayCache: { at: number; data: RelayStatus[] } | null = null

  // After a skills mutation (or explicit refresh): rescan disk truth, update
  // this device's state rows, and quietly push so other devices converge.
  async function rescanSkillState(): Promise<void> {
    const cfg = loadConfig(dir)
    const skills = await listSkills(homeDir)
    const store = new Store(dbPath(dir))
    try {
      store.replaceDeviceState(cfg.device, "skill", skillStateRows(skills))
    } finally {
      store.close()
    }
    if (cfg.hub?.url && resolveHubToken(cfg.hub)) {
      runPush(undefined, { quiet: true }).catch(() => {})
    }
  }
  let relayUsageCache: { at: number; data: RelayUsageStatus[] } | null = null

  // Today usage walks paginated logs — cache harder than the balance call.
  async function relayUsageStatuses(): Promise<RelayUsageStatus[]> {
    if (relayUsageCache && Date.now() - relayUsageCache.at < RELAY_CACHE_MS * 2) return relayUsageCache.data
    const cfg = loadConfig(dir)
    const data = await Promise.all(
      cfg.relays.map(async (relay): Promise<RelayUsageStatus> => {
        const base = { id: relay.id, type: relay.type, currency: relay.currency ?? "$" }
        const adapter = getAdapter(relay.type)
        if (!adapter?.fetchTodayUsage || !adapter.supports.includes("usage_log")) {
          return { ...base, supported: false }
        }
        try {
          const u = await adapter.fetchTodayUsage(relay)
          return {
            ...base,
            supported: true,
            usd: u.usd,
            requests: u.requests,
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            models: u.models.map((m) => ({
              model: m.model,
              usd: m.usd,
              requests: m.requests,
              prompt_tokens: m.prompt_tokens,
              completion_tokens: m.completion_tokens,
            })),
            partial: u.partial,
          }
        } catch (err) {
          return { ...base, supported: true, error: err instanceof Error ? err.message : String(err) }
        }
      }),
    )
    relayUsageCache = { at: Date.now(), data }
    return data
  }

  async function relayStatuses(): Promise<RelayStatus[]> {
    if (relayCache && Date.now() - relayCache.at < RELAY_CACHE_MS) return relayCache.data
    const cfg = loadConfig(dir)
    const data = await Promise.all(
      cfg.relays.map(async (relay): Promise<RelayStatus> => {
        const base = { id: relay.id, type: relay.type, currency: relay.currency ?? "$" }
        const adapter = getAdapter(relay.type)
        if (!adapter) return { ...base, error: `unsupported type "${relay.type}"` }
        try {
          const b = await adapter.fetchBalance(relay)
          return { ...base, scope: b.scope, balance_usd: b.balance_usd, used_usd: b.used_usd, unlimited: b.unlimited }
        } catch (err) {
          return { ...base, error: err instanceof Error ? err.message : String(err) }
        }
      }),
    )
    relayCache = { at: Date.now(), data }
    return data
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    try {
      if (url.pathname === "/api/usage") {
        const range = url.searchParams.get("range") ?? "month"
        // Device filter (""=all). Every range aggregate below is scoped to it;
        // the `devices` list itself is not, so the card can switch or clear.
        const device = url.searchParams.get("device") ?? ""
        let since: string | null
        let until: string | null = null
        if (range === "custom") {
          // Inclusive UTC calendar-day bounds: from=YYYY-MM-DD&to=YYYY-MM-DD.
          const from = url.searchParams.get("from") ?? ""
          const to = url.searchParams.get("to") ?? ""
          const day = /^\d{4}-\d{2}-\d{2}$/
          if (!day.test(from) || !day.test(to) || from > to) {
            json(res, 400, { error: "custom range needs from=YYYY-MM-DD&to=YYYY-MM-DD with from <= to" })
            return
          }
          since = `${from}T00:00:00.000Z`
          until = new Date(Date.parse(`${to}T00:00:00.000Z`) + 24 * 3600 * 1000).toISOString()
        } else {
          const mapped = rangeSince(range)
          if (mapped === undefined) {
            json(res, 400, { error: "range must be day|week|month|total|custom" })
            return
          }
          since = mapped
        }
        const store = new Store(dbPath(dir))
        try {
          const summary = store.rangeSummary(since, until, device)
          const models = summary.models.map((m) => ({ ...m, estimated_cost: computeRowCost(m) }))
          const estimatedCost = models.reduce((s, m) => s + m.estimated_cost, 0)
          // Fold (project, tool, model) groups into per-project rows; cost is
          // priced per model group, then summed — never from project totals.
          const projectMap = new Map<
            string,
            {
              project: string
              input_tokens: number
              output_tokens: number
              cached_input_tokens: number
              cache_creation_input_tokens: number
              reasoning_output_tokens: number
              total_tokens: number
              conversation_count: number
              estimated_cost: number
            }
          >()
          for (const g of summary.project_models) {
            const key = g.project || "unknown"
            const p =
              projectMap.get(key) ??
              projectMap
                .set(key, {
                  project: key,
                  input_tokens: 0,
                  output_tokens: 0,
                  cached_input_tokens: 0,
                  cache_creation_input_tokens: 0,
                  reasoning_output_tokens: 0,
                  total_tokens: 0,
                  conversation_count: 0,
                  estimated_cost: 0,
                })
                .get(key)!
            p.input_tokens += g.input_tokens
            p.output_tokens += g.output_tokens
            p.cached_input_tokens += g.cached_input_tokens
            p.cache_creation_input_tokens += g.cache_creation_input_tokens
            p.reasoning_output_tokens += g.reasoning_output_tokens
            p.total_tokens += g.total_tokens
            p.conversation_count += g.conversation_count
            p.estimated_cost += computeRowCost(g)
          }
          const projects = [...projectMap.values()].sort((a, b) => b.total_tokens - a.total_tokens)
          // Same folding rule as projects: price each (device, tool, model)
          // group, then sum — never price from a device's total_tokens.
          const deviceMap = new Map<string, { device_id: string; total_tokens: number; conversation_count: number; estimated_cost: number }>()
          for (const g of store.deviceModelTotals(since, until)) {
            const key = g.device_id || "unknown"
            const d =
              deviceMap.get(key) ??
              deviceMap.set(key, { device_id: key, total_tokens: 0, conversation_count: 0, estimated_cost: 0 }).get(key)!
            d.total_tokens += g.total_tokens
            d.conversation_count += g.conversation_count
            d.estimated_cost += computeRowCost(g)
          }
          const devices = [...deviceMap.values()].sort((a, b) => b.total_tokens - a.total_tokens)
          const last7d = store.rangeSummary(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(), null, device).totals
          const last30d = store.rangeSummary(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(), null, device).totals
          const span = store.activitySpan(device)
          const { project_models: _pm, ...summaryOut } = summary
          json(res, 200, {
            ...summaryOut,
            models,
            projects,
            devices,
            self_device: loadConfig(dir).device,
            estimated_cost: estimatedCost,
            last7d: last7d.total_tokens,
            last30d: last30d.total_tokens,
            daily_avg: Math.round(last30d.total_tokens / 30),
            started: span.started,
            active_days: span.active_days,
          })
        } finally {
          store.close()
        }
        return
      }
      if (url.pathname === "/api/sessions") {
        // Local file scan (freshest) merged with hub-synced session metadata
        // from OTHER devices; each row carries its device.
        const cfg = loadConfig(dir)
        const local = (await listSessionsCached()).map((s) => ({ ...s, device_id: cfg.device }))
        const store = new Store(dbPath(dir))
        let remote
        try {
          remote = store.allSessionRows().filter((r) => r.device_id !== cfg.device)
        } finally {
          store.close()
        }
        const merged = [...local, ...remote].sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""))
        json(res, 200, { device: cfg.device, sessions: merged })
        return
      }
      if (url.pathname === "/api/limits") {
        // Local live providers + hub-synced snapshots from other devices.
        const cfg = loadConfig(dir)
        const local = (await allLimits()).map((p) => ({ ...p, device_id: cfg.device }))
        const store = new Store(dbPath(dir))
        let remote: unknown[] = []
        try {
          remote = store
            .deviceState("limit")
            .filter((r) => r.device_id !== cfg.device)
            .map((r) => ({ ...(JSON.parse(r.payload) as object), device_id: r.device_id }))
        } finally {
          store.close()
        }
        json(res, 200, { device: cfg.device, providers: [...local, ...remote] })
        return
      }
      if (url.pathname === "/api/skills/discover") {
        const result = await discoverSkills({ force: url.searchParams.get("force") === "1" })
        const installed = new Set(readManaged().map((m) => m.key))
        json(res, 200, {
          ...result,
          skills: result.skills.map((s) => ({ ...s, installed: installed.has(s.key) })),
        })
        return
      }
      if (url.pathname === "/api/skills/install" && req.method === "POST") {
        const guard = rejectNonLocalWrite(req)
        if (guard) {
          json(res, 403, { error: guard })
          return
        }
        const body = JSON.parse(await readBody(req, 64 * 1024)) as { key?: string }
        if (typeof body.key !== "string") {
          json(res, 400, { error: "body must be {key}" })
          return
        }
        // Resolve the key against the current discover cache/fetch — install
        // parameters come from OUR discovery data, never raw client fields.
        // Target agents are a fixed server-side allowlist, not client input.
        const { skills } = await discoverSkills()
        const skill = skills.find((s) => s.key === body.key)
        if (!skill) {
          json(res, 404, { error: "unknown skill key — refresh Browse and retry" })
          return
        }
        const result = await installDiscoveredSkill(skill, [...INSTALL_AGENTS], homeDir)
        if (result.ok) await rescanSkillState()
        json(res, result.ok ? 200 : 409, result)
        return
      }
      if (url.pathname === "/api/skills/uninstall" && req.method === "POST") {
        const guard = rejectNonLocalWrite(req)
        if (guard) {
          json(res, 403, { error: guard })
          return
        }
        const body = JSON.parse(await readBody(req, 8 * 1024)) as { key?: string }
        if (typeof body.key !== "string") {
          json(res, 400, { error: "body must be {key}" })
          return
        }
        const result = uninstallManagedSkill(body.key)
        if (result.ok) await rescanSkillState()
        json(res, result.ok ? 200 : 409, result)
        return
      }
      if (url.pathname === "/api/skills/detail") {
        // Drawer data for a LOCAL install: SKILL.md metadata + install paths.
        // Remote-only rows never reach here — no skill content crosses devices.
        const key = url.searchParams.get("key") ?? ""
        const skill = (await listSkills(homeDir)).find((s) => skillKey(s) === key)
        if (!skill) {
          json(res, 404, { error: "not installed on this device" })
          return
        }
        // Per-agent ownership so the UI only offers removal where unlink
        // would succeed: owned links with at least one other install left.
        const states = classifyInstalls(skill.paths)
        const installCount = Object.keys(skill.paths ?? {}).length
        const installStates = Object.fromEntries(
          Object.entries(states).map(([agent, state]) => [
            agent,
            { state, removable: state === "owned-link" && installCount > 1 },
          ]),
        )
        json(res, 200, { ...skill, manageable: skill.scope === "user", install_states: installStates })
        return
      }
      if (url.pathname === "/api/skills/toggle" && req.method === "POST") {
        const guard = rejectNonLocalWrite(req)
        if (guard) {
          json(res, 403, { error: guard })
          return
        }
        const body = JSON.parse(await readBody(req, 64 * 1024)) as {
          key?: string
          agent?: string
          enable?: boolean
        }
        if (typeof body.key !== "string" || typeof body.agent !== "string" || typeof body.enable !== "boolean") {
          json(res, 400, { error: "body must be {key, agent, enable}" })
          return
        }
        const result = body.enable
          ? await linkSkill(body.key, body.agent, homeDir)
          : await unlinkSkill(body.key, body.agent, homeDir)
        if (result.ok) await rescanSkillState()
        json(res, result.ok ? 200 : 409, result)
        return
      }
      if (url.pathname === "/api/skills/refresh" && req.method === "POST") {
        const guard = rejectNonLocalWrite(req)
        if (guard) {
          json(res, 403, { error: guard })
          return
        }
        // Rescan only — never touches skill files.
        await rescanSkillState()
        json(res, 200, { ok: true })
        return
      }
      if (url.pathname === "/api/skills") {
        // Local scan merged with other devices' synced inventories. Every
        // install is attributed explicitly — including the local device — via
        // installs[{device, agents}], the real device×agent matrix; the flat
        // agents/devices arrays remain as filter conveniences.
        const cfg = loadConfig(dir)
        interface SkillRow {
          name: string
          description: string
          scope: string
          source?: string
          agents: string[]
          devices: string[]
          installs: { device: string; agents: string[] }[]
        }
        const byKey = new Map<string, SkillRow>()
        const addInstall = (
          key: string,
          device: string,
          s: { name: string; description: string; scope: string; source?: string; agents: string[] },
        ): void => {
          const existing = byKey.get(key)
          if (existing) {
            if (!existing.devices.includes(device)) existing.devices.push(device)
            for (const a of s.agents) if (!existing.agents.includes(a)) existing.agents.push(a)
            if (!existing.description && s.description) existing.description = s.description
            existing.installs.push({ device, agents: s.agents })
          } else {
            byKey.set(key, {
              name: s.name,
              description: s.description,
              scope: s.scope,
              ...(s.source ? { source: s.source } : {}),
              agents: [...s.agents],
              devices: [device],
              installs: [{ device, agents: s.agents }],
            })
          }
        }
        for (const s of await listSkills(homeDir)) addInstall(skillKey(s), cfg.device, s)
        const store = new Store(dbPath(dir))
        try {
          for (const r of store.deviceState("skill")) {
            if (r.device_id === cfg.device) continue
            const p = JSON.parse(r.payload) as {
              name?: string
              description?: string
              agents?: string[]
              scope?: string
              source?: string
            }
            // Devices on older builds pushed plain-name keys and no scope.
            const scope = p.scope ?? "user"
            const name = p.name ?? (r.key.includes(":") ? r.key.split(":").pop() ?? r.key : r.key)
            const key = r.key.includes(":") ? r.key : `user::${r.key.toLowerCase()}`
            addInstall(key, r.device_id, {
              name,
              description: p.description ?? "",
              scope,
              ...(p.source ? { source: p.source } : {}),
              agents: p.agents ?? [],
            })
          }
        } finally {
          store.close()
        }
        json(res, 200, {
          device: cfg.device,
          skills: [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope)),
        })
        return
      }
      if (url.pathname === "/api/heatmap") {
        const store = new Store(dbPath(dir))
        try {
          json(res, 200, store.heatmapDays(url.searchParams.get("device") ?? ""))
        } finally {
          store.close()
        }
        return
      }
      if (url.pathname === "/api/summary") {
        const cfg = loadConfig(dir)
        const store = new Store(dbPath(dir))
        try {
          json(res, 200, {
            device: cfg.device,
            hub_url: cfg.hub?.url ?? null,
            hub_configured: Boolean(resolveHubTokenSafe(cfg)),
            version: VERSION,
            generated_at: new Date().toISOString(),
            record_count: store.countRecords(),
            devices: store.totalsByDevice(),
            tools: store.totalsByTool(),
            models: store.totalsByModel(),
            projects: store.totalsByProject(),
            days: store.totalsByDay(14),
          })
        } finally {
          store.close()
        }
        return
      }
      if (url.pathname === "/api/export" && req.method === "GET") {
        // Mirror of ingest: lets satellites `usageplane pull` the hub's full
        // record set so every device can render the merged view locally.
        const expected = resolveHubToken(loadConfig(dir).hub)
        if (!expected) {
          json(res, 403, { error: "export disabled — set hub.token (or token_env) in usageplane.yaml" })
          return
        }
        if ((req.headers.authorization ?? "") !== `Bearer ${expected}`) {
          json(res, 401, { error: "bad token" })
          return
        }
        const store = new Store(dbPath(dir))
        try {
          json(res, 200, {
            records: store.allRecords(),
            sessions: store.allSessionRows(),
            state: store.deviceState(),
          })
        } finally {
          store.close()
        }
        return
      }
      if (url.pathname === "/api/ingest" && req.method === "POST") {
        const expected = resolveHubToken(loadConfig(dir).hub)
        if (!expected) {
          json(res, 403, { error: "ingest disabled — set hub.token (or token_env) in usageplane.yaml" })
          return
        }
        const auth = req.headers.authorization ?? ""
        if (auth !== `Bearer ${expected}`) {
          json(res, 401, { error: "bad token" })
          return
        }
        const body = await readBody(req, MAX_INGEST_BYTES)
        const payload = JSON.parse(body) as {
          records?: UsageRecord[]
          sessions?: SessionRow[]
          state?: DeviceStateRow[]
          state_device?: string
          state_kinds?: string[]
        }
        if (!Array.isArray(payload.records)) {
          json(res, 400, { error: "body must be {records: UsageRecord[]}" })
          return
        }
        const store = new Store(dbPath(dir))
        try {
          const upserted = store.upsertUsage(payload.records)
          const sessionsUpserted = Array.isArray(payload.sessions)
            ? store.upsertSessionRows(payload.sessions)
            : 0
          // Snapshot semantics when declared: replace each announced
          // (device, kind) group wholesale so deletions propagate. Legacy
          // pushers without the declaration keep plain upsert.
          let stateUpserted = 0
          const state = Array.isArray(payload.state) ? payload.state : []
          if (typeof payload.state_device === "string" && Array.isArray(payload.state_kinds)) {
            for (const kind of payload.state_kinds) {
              stateUpserted += store.replaceDeviceState(
                payload.state_device,
                String(kind),
                state.filter((r) => r.device_id === payload.state_device && r.kind === kind),
              )
            }
          } else if (state.length > 0) {
            stateUpserted = store.upsertDeviceState(state)
          }
          json(res, 200, {
            upserted,
            sessions_upserted: sessionsUpserted,
            state_upserted: stateUpserted,
            total: store.countRecords(),
          })
        } finally {
          store.close()
        }
        return
      }
      if (url.pathname === "/api/relays") {
        json(res, 200, await relayStatuses())
        return
      }
      if (url.pathname === "/api/relays/usage") {
        json(res, 200, await relayUsageStatuses())
        return
      }
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        serveStatic(res, url.pathname)
        return
      }
      json(res, 404, { error: "not found" })
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  })
}

/** Serve the built SPA; unknown extension-less paths get index.html (client routing). */
function serveStatic(res: http.ServerResponse, pathname: string): void {
  const indexFile = path.join(DIST_DIR, "index.html")
  if (!fs.existsSync(indexFile)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(DASHBOARD_HTML)
    return
  }
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "")
  const file = path.join(DIST_DIR, rel)
  if (!file.startsWith(DIST_DIR)) {
    json(res, 403, { error: "forbidden" })
    return
  }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : indexFile
  res.writeHead(200, { "content-type": MIME[path.extname(target)] ?? "application/octet-stream" })
  res.end(fs.readFileSync(target))
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error(`body exceeds ${limit} bytes`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}

export function runServe(port: number): void {
  const server = createServer()
  server.listen(port, "127.0.0.1", () => {
    console.log(`usageplane dashboard: http://127.0.0.1:${port}`)
  })
}
