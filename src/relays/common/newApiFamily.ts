// Adapted from all-api-hub (AGPL-3.0):
//   src/services/apiService/newApiFamily/default/accountData.ts (endpoints, envelope)
//   src/services/apiTransport/compatHeaders.ts (user-id header fan-out)
//   src/constants/ui.ts (quota→USD conversion factor 500000)
// Upstream runs in a browser extension with cookie sessions; this port is
// token-auth only (access token via Bearer), per M3 scope.

import type { RelayConfig } from "../../core/config.js"
import { resolveRelayToken } from "../../core/config.js"
import type { RelayAdapter, RelayBalance } from "../types.js"

/** Upstream default: 500000 quota units = 1 USD. Per-site overrides are rare; revisit if a site drifts. */
export const QUOTA_PER_UNIT = 500_000

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

export const newApiFamilyAdapter: RelayAdapter = {
  type: "new-api",
  supports: ["balance"],

  async fetchBalance(relay, fetchFn = fetch): Promise<RelayBalance> {
    const data = await apiGet<{ quota?: number; used_quota?: number }>(
      relay,
      "/api/user/self",
      fetchFn,
    )
    const quota = Number.isFinite(data.quota) ? (data.quota as number) : 0
    const usedQuota = Number.isFinite(data.used_quota) ? (data.used_quota as number) : undefined
    return {
      quota,
      used_quota: usedQuota,
      balance_usd: quota / QUOTA_PER_UNIT,
      used_usd: usedQuota === undefined ? undefined : usedQuota / QUOTA_PER_UNIT,
    }
  },
}
