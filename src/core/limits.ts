// Subscription limit windows — ported from TokenTracker src/lib/usage-limits.js
// (MIT): Claude OAuth usage endpoint, scoped-weekly extraction, and the
// mandatory cache + 429 backoff. Upstream lesson: this endpoint SHARES quota
// with Claude Code itself — hammering it degrades the user's real sessions,
// so the cache and persisted retry-after are load-bearing, not an optimization.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { dataDir } from "./paths.js"

const CACHE_TTL_MS = 120_000

export interface LimitWindow {
  label: string
  utilization: number
  resets_at: string | null
}

export interface ProviderLimits {
  id: string
  name: string
  connected: boolean
  windows: LimitWindow[]
  error?: string
}

interface CacheFile {
  fetched_at?: number
  retry_until?: number
  windows?: LimitWindow[]
  error?: string
}

function cachePath(): string {
  return path.join(dataDir(), "cache", "claude-limits.json")
}

function readCache(): CacheFile {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), "utf8")) as CacheFile
  } catch {
    return {}
  }
}

function writeCache(data: CacheFile): void {
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
  fs.writeFileSync(cachePath(), JSON.stringify(data))
}

function readClaudeAccessToken(home = os.homedir()): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home, ".claude", ".credentials.json"), "utf8")) as {
      claudeAiOauth?: { accessToken?: string }
    }
    return raw.claudeAiOauth?.accessToken ?? null
  } catch {
    return null
  }
}

/** Map the oauth/usage body into display windows (5h / 7d / per-model scoped). */
export function parseClaudeUsageBody(body: Record<string, unknown>): LimitWindow[] {
  const out: LimitWindow[] = []
  const push = (label: string, entry: unknown) => {
    const e = entry as { utilization?: unknown; resets_at?: unknown } | null
    const utilization = Number(e?.utilization)
    if (!e || !Number.isFinite(utilization)) return
    out.push({ label, utilization, resets_at: typeof e.resets_at === "string" ? e.resets_at : null })
  }
  push("5h", body.five_hour)
  push("7d", body.seven_day)
  push("Opus", body.seven_day_opus)
  // Newer accounts deliver per-model weekly windows in `limits` as
  // kind:"weekly_scoped" with scope.model.display_name (upstream extractor).
  if (Array.isArray(body.limits)) {
    for (const entry of body.limits as Array<Record<string, unknown>>) {
      if (entry?.kind !== "weekly_scoped") continue
      const model = (entry.scope as { model?: { display_name?: string; id?: string } } | undefined)?.model
      const label = model?.display_name?.trim() || model?.id?.trim()
      const utilization = Number(entry.percent)
      if (!label || !Number.isFinite(utilization)) continue
      if (body.seven_day_opus && label.toLowerCase() === "opus") continue
      out.push({
        label,
        utilization,
        resets_at: typeof entry.resets_at === "string" ? entry.resets_at : null,
      })
    }
  }
  return out
}

export async function claudeLimits(fetchFn: typeof fetch = fetch): Promise<ProviderLimits> {
  const base: ProviderLimits = { id: "claude", name: "Claude", connected: false, windows: [] }
  const token = readClaudeAccessToken()
  if (!token) return base

  const cache = readCache()
  const now = Date.now()
  if (cache.windows && cache.fetched_at && now - cache.fetched_at < CACHE_TTL_MS) {
    return { ...base, connected: true, windows: cache.windows }
  }
  if (cache.retry_until && now < cache.retry_until) {
    return {
      ...base,
      connected: true,
      windows: cache.windows ?? [],
      error: `rate limited — retrying after ${new Date(cache.retry_until).toLocaleTimeString()}`,
    }
  }

  try {
    const res = await fetchFn("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
      },
    })
    if (res.status === 401) {
      return { ...base, connected: true, error: "Claude token expired — run `claude` once to refresh" }
    }
    if (res.status === 429 || res.status === 503) {
      const ra = Number.parseInt(res.headers.get("retry-after") ?? "", 10)
      const retryMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 20 * 60 * 1000
      writeCache({ ...cache, retry_until: now + retryMs })
      return { ...base, connected: true, windows: cache.windows ?? [], error: `HTTP ${res.status} — backing off` }
    }
    if (!res.ok) {
      return { ...base, connected: true, windows: cache.windows ?? [], error: `Claude API returned ${res.status}` }
    }
    const windows = parseClaudeUsageBody((await res.json()) as Record<string, unknown>)
    writeCache({ fetched_at: now, windows })
    return { ...base, connected: true, windows }
  } catch (err) {
    return {
      ...base,
      connected: true,
      windows: cache.windows ?? [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// --- Codex (ChatGPT subscription) --------------------------------------
// Windows are classified by limit_window_seconds, never by slot name:
// free-tier accounts get only a weekly window delivered in the primary
// slot, and position-based reading would mislabel it "5h" (upstream lesson,
// aligned with CodexBar's normalizer).
const CODEX_SESSION_WINDOW_SECONDS = 18000
const CODEX_WEEKLY_WINDOW_SECONDS = 604800

/** Unknown window sizes get a duration label (e.g. 2628000s ≈ one month → "30d")
 *  instead of leaking internal slot names into the UI. */
function windowLabel(seconds: number, slot: string): string {
  if (seconds === CODEX_SESSION_WINDOW_SECONDS) return "5h"
  if (seconds === CODEX_WEEKLY_WINDOW_SECONDS) return "7d"
  if (!Number.isFinite(seconds) || seconds <= 0) return slot
  return seconds >= 172800 ? `${Math.round(seconds / 86400)}d` : `${Math.round(seconds / 3600)}h`
}

function readCodexAuth(home = os.homedir()): { token: string; accountId: string | null } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home, ".codex", "auth.json"), "utf8")) as {
      tokens?: { access_token?: string; account_id?: string }
      access_token?: string
    }
    const token = raw.tokens?.access_token ?? raw.access_token
    if (!token) return null
    return { token, accountId: raw.tokens?.account_id ?? null }
  } catch {
    return null
  }
}

export function parseCodexUsageBody(body: Record<string, unknown>, nowMs = Date.now()): LimitWindow[] {
  const rl = (body.rate_limit ?? body) as Record<string, unknown>
  const out: LimitWindow[] = []
  for (const slot of ["primary_window", "secondary_window"]) {
    const w = rl[slot] as Record<string, unknown> | undefined
    if (!w || typeof w !== "object") continue
    const used = Number(w.used_percent)
    const seconds = Number(w.limit_window_seconds)
    if (!Number.isFinite(used)) continue
    const label = windowLabel(seconds, slot)
    // Reset time arrives in several shapes across plan tiers: string resets_at,
    // numeric reset_at/resets_at (epoch seconds or ms), or a countdown in
    // resets_in_seconds / reset_after_seconds.
    let resetsAt: string | null = typeof w.resets_at === "string" ? w.resets_at : null
    if (!resetsAt) {
      const epoch = Number(w.resets_at ?? w.reset_at)
      if (Number.isFinite(epoch) && epoch > 0) {
        resetsAt = new Date(epoch > 1e12 ? epoch : epoch * 1000).toISOString()
      }
    }
    if (!resetsAt) {
      const resetsIn = Number(w.resets_in_seconds ?? w.reset_after_seconds)
      if (Number.isFinite(resetsIn) && resetsIn > 0) {
        resetsAt = new Date(nowMs + resetsIn * 1000).toISOString()
      }
    }
    out.push({ label, utilization: Math.round(Math.max(0, Math.min(100, used))), resets_at: resetsAt })
  }
  return out
}

export async function codexLimits(fetchFn: typeof fetch = fetch): Promise<ProviderLimits> {
  const base: ProviderLimits = { id: "codex", name: "Codex", connected: false, windows: [] }
  const auth = readCodexAuth()
  if (!auth) return base

  const cacheFile = path.join(dataDir(), "cache", "codex-limits.json")
  const cache: CacheFile = (() => {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, "utf8")) as CacheFile
    } catch {
      return {}
    }
  })()
  const now = Date.now()
  if (cache.windows && cache.fetched_at && now - cache.fetched_at < CACHE_TTL_MS) {
    return { ...base, connected: true, windows: cache.windows }
  }
  if (cache.retry_until && now < cache.retry_until) {
    return { ...base, connected: true, windows: cache.windows ?? [], error: "rate limited — backing off" }
  }

  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${auth.token}`, Accept: "application/json" }
    // Some plan tiers reject wham without an explicit account id (upstream).
    if (auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId
    const res = await fetchFn("https://chatgpt.com/backend-api/wham/usage", { headers })
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      // "No usage data for this auth state" — neutral empty, not an error.
      return { ...base, connected: true, windows: [], error: `no usage data (HTTP ${res.status}) — run codex once to refresh auth` }
    }
    if (res.status === 429 || res.status === 503) {
      const ra = Number.parseInt(res.headers.get("retry-after") ?? "", 10)
      const retryMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 20 * 60 * 1000
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
      fs.writeFileSync(cacheFile, JSON.stringify({ ...cache, retry_until: now + retryMs }))
      return { ...base, connected: true, windows: cache.windows ?? [], error: `HTTP ${res.status} — backing off` }
    }
    if (!res.ok) {
      return { ...base, connected: true, windows: cache.windows ?? [], error: `Codex API returned ${res.status}` }
    }
    const windows = parseCodexUsageBody((await res.json()) as Record<string, unknown>, now)
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
    fs.writeFileSync(cacheFile, JSON.stringify({ fetched_at: now, windows }))
    return { ...base, connected: true, windows }
  } catch (err) {
    return { ...base, connected: true, windows: cache.windows ?? [], error: err instanceof Error ? err.message : String(err) }
  }
}

/** All providers for the Limits page; unimplemented ones show "Not connected". */
export async function allLimits(fetchFn: typeof fetch = fetch): Promise<ProviderLimits[]> {
  const placeholders: ProviderLimits[] = [
    { id: "cursor", name: "Cursor", connected: false, windows: [] },
    { id: "gemini", name: "Gemini", connected: false, windows: [] },
  ]
  return [await claudeLimits(fetchFn), await codexLimits(fetchFn), ...placeholders]
}
