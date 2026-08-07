// Local HTTP API + dashboard host. Routing style follows TokenTracker's
// src/lib/local-api.js (plain node:http, no framework) — MIT-inspired
// structure, no code copied.

import http from "node:http"
import { loadConfig, resolveHubToken } from "../core/config.js"
import { dataDir, dbPath } from "../core/paths.js"
import { Store } from "../core/store.js"
import type { UsageRecord } from "../core/types.js"
import { getAdapter } from "../relays/index.js"
import { DASHBOARD_HTML } from "./dashboard-html.js"

const MAX_INGEST_BYTES = 32 * 1024 * 1024

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
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        res.end(DASHBOARD_HTML)
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
        const payload = JSON.parse(body) as { records?: UsageRecord[] }
        if (!Array.isArray(payload.records)) {
          json(res, 400, { error: "body must be {records: UsageRecord[]}" })
          return
        }
        const store = new Store(dbPath(dir))
        try {
          const upserted = store.upsertUsage(payload.records)
          json(res, 200, { upserted, total: store.countRecords() })
        } finally {
          store.close()
        }
        return
      }
      if (url.pathname === "/api/relays") {
        json(res, 200, await relayStatuses())
        return
      }
      json(res, 404, { error: "not found" })
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  })
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
