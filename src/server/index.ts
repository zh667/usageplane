// Local HTTP API + dashboard host. Routing style follows TokenTracker's
// src/lib/local-api.js (plain node:http, no framework) — MIT-inspired
// structure, no code copied.

import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig, resolveHubToken } from "../core/config.js"
import { dataDir, dbPath } from "../core/paths.js"
import { Store, type SessionRow } from "../core/store.js"
import type { UsageRecord } from "../core/types.js"
import { listSessionsCached } from "../core/sessions.js"
import { getAdapter } from "../relays/index.js"
import { DASHBOARD_HTML } from "./dashboard-html.js"

const MAX_INGEST_BYTES = 32 * 1024 * 1024

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
export function createServer(dir = dataDir()): http.Server {
  let relayCache: { at: number; data: RelayStatus[] } | null = null

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
        const since = rangeSince(url.searchParams.get("range") ?? "month")
        if (since === undefined) {
          json(res, 400, { error: "range must be day|week|month|total" })
          return
        }
        const store = new Store(dbPath(dir))
        try {
          const summary = store.rangeSummary(since)
          const last7d = store.rangeSummary(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()).totals
          const last30d = store.rangeSummary(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()).totals
          const span = store.activitySpan()
          json(res, 200, {
            ...summary,
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
      if (url.pathname === "/api/heatmap") {
        const store = new Store(dbPath(dir))
        try {
          json(res, 200, store.heatmapDays())
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
          json(res, 200, { records: store.allRecords(), sessions: store.allSessionRows() })
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
        const payload = JSON.parse(body) as { records?: UsageRecord[]; sessions?: SessionRow[] }
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
          json(res, 200, { upserted, sessions_upserted: sessionsUpserted, total: store.countRecords() })
        } finally {
          store.close()
        }
        return
      }
      if (url.pathname === "/api/relays") {
        json(res, 200, await relayStatuses())
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
