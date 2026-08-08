// Adapted from all-api-hub (AGPL-3.0):
//   src/services/apiService/newApiFamily/default/accountData.ts (endpoints, envelope)
//   src/services/apiTransport/compatHeaders.ts (user-id header fan-out)
//   src/constants/ui.ts (quota→USD conversion factor 500000)
// Upstream runs in a browser extension with cookie sessions; this port is
// token-auth only (access token via Bearer), per M3 scope.

import type { RelayConfig } from "../../core/config.js"
import { resolveRelayToken } from "../../core/config.js"
import type { RelayAdapter, RelayBalance, RelayModelUsage, RelayTodayUsage } from "../types.js"

/** Upstream default: 500000 quota units = 1 USD. Per-site overrides are rare; revisit if a site drifts. */
export const QUOTA_PER_UNIT = 500_000

/**
 * one-api/new-api report hard_limit_usd=100000000 for "unlimited" keys.
 * Treat anything at or above it as unlimited rather than a real balance.
 */
export const UNLIMITED_HARD_LIMIT_USD = 100_000_000

// Different One-API/New-API downstream forks read different user-id header
// names; fan the same id out across all known keys (upstream compatHeaders.ts).
const COMPAT_USER_ID_HEADERS = [
  "New-API-User",
  "Veloera-User",
  "X-Api-User",
  "voapi-user",
  "User-id",
  "Rix-Api-User",
  "neo-api-user",
] as const

export function buildHeaders(relay: RelayConfig): Record<string, string> {
  const token = resolveRelayToken(relay)
  if (!token) throw new Error(`relay "${relay.id}": no token configured (set token_env or token)`)
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  }
  if (relay.user_id !== undefined && relay.user_id !== null && `${relay.user_id}` !== "") {
    for (const name of COMPAT_USER_ID_HEADERS) headers[name] = String(relay.user_id)
  }
  return headers
}

/** GET an endpoint and unwrap the {success, message, data} envelope. */
async function apiGet<T>(relay: RelayConfig, endpoint: string, fetchFn: typeof fetch): Promise<T> {
  const url = `${relay.base_url.replace(/\/+$/, "")}${endpoint}`
  const res = await fetchFn(url, { headers: buildHeaders(relay) })
  if (!res.ok) {
    throw new Error(`relay "${relay.id}": HTTP ${res.status} on ${endpoint}`)
  }
  const body = (await res.json()) as { success?: boolean; message?: string; data?: T }
  if (body === null || typeof body !== "object") {
    throw new Error(`relay "${relay.id}": invalid response on ${endpoint}`)
  }
  if (body.success === false) {
    throw new Error(`relay "${relay.id}": ${body.message || "business error"} (${endpoint})`)
  }
  if (!("data" in body) || body.data === undefined) {
    throw new Error(`relay "${relay.id}": response has no data field (${endpoint})`)
  }
  return body.data
}

// --- Today usage (ported from upstream accountData.ts fetchTodayUsage) ----
// Upstream contract: paginate GET /api/log/self with type=2 (Consume) over
// the LOCAL day boundary (midnight → 23:59:59, unix seconds — matching what
// the site's own web console shows), summing quota / prompt_tokens /
// completion_tokens per row. GET /api/log/self/stat with the same params
// returns the exact day total quota; when available it is authoritative
// (immune to pagination truncation). Model breakdown is our extension: the
// same rows carry model_name, so we group while paginating (upstream only
// keeps totals).
const LOG_TYPE_CONSUME = 2
const LOG_PAGE_SIZE = 100
const LOG_MAX_PAGES = 100

/** Local-midnight day boundary in unix seconds (upstream getTodayTimestampRange). */
export function todayRangeSeconds(now = new Date()): { start: number; end: number } {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const start = Math.floor(d.getTime() / 1000)
  d.setHours(23, 59, 59, 999)
  return { start, end: Math.floor(d.getTime() / 1000) }
}

function logParams(page: number, range: { start: number; end: number }): string {
  return new URLSearchParams({
    p: String(page),
    page_size: String(LOG_PAGE_SIZE),
    type: String(LOG_TYPE_CONSUME),
    token_name: "",
    model_name: "",
    start_timestamp: String(range.start),
    end_timestamp: String(range.end),
    group: "",
  }).toString()
}

/** Log payloads come as {items,total} (new-api) or a bare array (older forks) — upstream accepts both. */
function normalizeLogPage(payload: unknown): { items: unknown[]; total: number | null } | null {
  if (Array.isArray(payload)) return { items: payload, total: null }
  if (payload === null || typeof payload !== "object") return null
  const rec = payload as { items?: unknown; total?: unknown }
  if (!Array.isArray(rec.items) || typeof rec.total !== "number" || !Number.isFinite(rec.total) || rec.total < 0) {
    return null
  }
  return { items: rec.items, total: rec.total }
}

async function fetchTodayUsageImpl(relay: RelayConfig, fetchFn: typeof fetch): Promise<RelayTodayUsage> {
  const token = resolveRelayToken(relay)
  if (token?.startsWith("sk-")) {
    // sk- keys can't auth the management log API — only access tokens can.
    throw new Error(`relay "${relay.id}": today usage needs an access token (sk- keys can't read /api/log/self)`)
  }

  const range = todayRangeSeconds()
  const perModel = new Map<string, RelayModelUsage>()
  let rowQuota = 0
  let requests = 0
  let promptTokens = 0
  let completionTokens = 0
  let partial = false

  for (let page = 1; page <= LOG_MAX_PAGES; page++) {
    const payload = await apiGet<unknown>(relay, `/api/log/self?${logParams(page, range)}`, fetchFn)
    const norm = normalizeLogPage(payload)
    if (!norm) throw new Error(`relay "${relay.id}": unrecognized /api/log/self payload shape`)
    for (const item of norm.items) {
      if (item === null || typeof item !== "object") continue
      const row = item as { quota?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown; model_name?: unknown }
      const quota = Number(row.quota)
      const prompt = Number(row.prompt_tokens)
      const completion = Number(row.completion_tokens)
      const model = typeof row.model_name === "string" && row.model_name ? row.model_name : "unknown"
      const m = perModel.get(model) ?? { model, quota: 0, usd: 0, requests: 0, prompt_tokens: 0, completion_tokens: 0 }
      perModel.set(model, m)
      requests += 1
      m.requests += 1
      if (Number.isFinite(quota)) {
        rowQuota += quota
        m.quota += quota
      }
      if (Number.isFinite(prompt)) {
        promptTokens += prompt
        m.prompt_tokens += prompt
      }
      if (Number.isFinite(completion)) {
        completionTokens += completion
        m.completion_tokens += completion
      }
    }
    const totalPages = norm.total === null ? 1 : Math.ceil(norm.total / LOG_PAGE_SIZE)
    if (page >= totalPages) break
    if (page === LOG_MAX_PAGES) partial = true
  }

  // Exact day total from the stat endpoint when the fork provides it.
  let quota = rowQuota
  try {
    const stat = await apiGet<{ quota?: unknown }>(relay, `/api/log/self/stat?${logParams(1, range)}`, fetchFn)
    const statQuota = Number(stat?.quota)
    if (Number.isFinite(statQuota)) quota = statQuota
  } catch {
    /* stat is an optimization — summed rows stand on their own */
  }

  for (const m of perModel.values()) m.usd = m.quota / QUOTA_PER_UNIT
  return {
    quota,
    usd: quota / QUOTA_PER_UNIT,
    requests,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    models: [...perModel.values()].sort((a, b) => b.quota - a.quota),
    partial,
  }
}

export const newApiFamilyAdapter: RelayAdapter = {
  type: "new-api",
  supports: ["balance", "usage_log"],

  async fetchTodayUsage(relay, fetchFn = fetch): Promise<RelayTodayUsage> {
    return fetchTodayUsageImpl(relay, fetchFn)
  },

  async fetchBalance(relay, fetchFn = fetch): Promise<RelayBalance> {
    // Two credential kinds exist on these sites (verified live 2026-08-07):
    //  - access token (console → profile) → /api/user/self, account-wide quota
    //  - sk- API key → OpenAI-compat billing endpoints, that key's own numbers
    const token = resolveRelayToken(relay)
    if (token?.startsWith("sk-")) return fetchKeyBalance(relay, fetchFn)

    const data = await apiGet<{ quota?: number; used_quota?: number }>(
      relay,
      "/api/user/self",
      fetchFn,
    )
    const quota = Number.isFinite(data.quota) ? (data.quota as number) : 0
    const usedQuota = Number.isFinite(data.used_quota) ? (data.used_quota as number) : undefined
    return {
      scope: "account",
      quota,
      used_quota: usedQuota,
      balance_usd: quota / QUOTA_PER_UNIT,
      used_usd: usedQuota === undefined ? undefined : usedQuota / QUOTA_PER_UNIT,
    }
  },
}

/**
 * Key-scoped balance via the OpenAI-compatible billing surface that
 * one-api/new-api implement for sk- keys (no envelope — raw JSON):
 *   GET /dashboard/billing/subscription → hard_limit_usd
 *   GET /dashboard/billing/usage        → total_usage in 0.01 USD units
 */
async function fetchKeyBalance(relay: RelayConfig, fetchFn: typeof fetch): Promise<RelayBalance> {
  const sub = await rawGet<{ hard_limit_usd?: number }>(relay, "/dashboard/billing/subscription", fetchFn)
  const end = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
  const usage = await rawGet<{ total_usage?: number }>(
    relay,
    `/dashboard/billing/usage?start_date=2020-01-01&end_date=${end}`,
    fetchFn,
  )
  const hardLimit = Number.isFinite(sub.hard_limit_usd) ? (sub.hard_limit_usd as number) : 0
  const usedUsd = Number.isFinite(usage.total_usage) ? (usage.total_usage as number) / 100 : undefined
  const unlimited = hardLimit >= UNLIMITED_HARD_LIMIT_USD
  return {
    scope: "key",
    used_usd: usedUsd,
    unlimited,
    balance_usd: unlimited ? undefined : hardLimit - (usedUsd ?? 0),
  }
}

/** GET returning a raw JSON body (billing endpoints have no {success,data} envelope). */
async function rawGet<T>(relay: RelayConfig, endpoint: string, fetchFn: typeof fetch): Promise<T> {
  const url = `${relay.base_url.replace(/\/+$/, "")}${endpoint}`
  const res = await fetchFn(url, { headers: buildHeaders(relay) })
  if (!res.ok) {
    throw new Error(`relay "${relay.id}": HTTP ${res.status} on ${endpoint}`)
  }
  return (await res.json()) as T
}
