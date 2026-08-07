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

/** All providers for the Limits page; unimplemented ones show "Not connected". */
export async function allLimits(fetchFn: typeof fetch = fetch): Promise<ProviderLimits[]> {
  const placeholders: ProviderLimits[] = [
    { id: "codex", name: "Codex", connected: false, windows: [] },
    { id: "cursor", name: "Cursor", connected: false, windows: [] },
    { id: "gemini", name: "Gemini", connected: false, windows: [] },
  ]
  return [await claudeLimits(fetchFn), ...placeholders]
}
