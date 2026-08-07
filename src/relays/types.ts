import type { RelayConfig } from "../core/config.js"

/**
 * What a relay site's API can answer. Not every site offers every capability —
 * many only expose balance/total consumption (docs/relay-sites.md), so the UI
 * must degrade per capability instead of assuming per-request logs exist.
 */
export type RelayCapability = "balance" | "usage_log" | "checkin" | "pricing"

export interface RelayBalance {
  /** What the credential could see: whole account, or just its own key. */
  scope: "account" | "key"
  /** Remaining quota in the site's native quota units (account scope only). */
  quota?: number
  /** Total consumed quota units, when the site reports it. */
  used_quota?: number
  /**
   * Remaining balance in USD. Undefined when unlimited — an unlimited key
   * has spend history but no meaningful remaining balance.
   */
  balance_usd?: number
  used_usd?: number
  /** True when the site reports the sentinel "unlimited" quota for this key. */
  unlimited?: boolean
}

export interface RelayAdapter {
  /** Architecture bucket this adapter implements, e.g. "new-api". */
  readonly type: string
  readonly supports: readonly RelayCapability[]
  fetchBalance(relay: RelayConfig, fetchFn?: typeof fetch): Promise<RelayBalance>
}

const registry = new Map<string, RelayAdapter>()

export function registerAdapter(adapter: RelayAdapter, ...aliases: string[]): void {
  for (const type of [adapter.type, ...aliases]) registry.set(type, adapter)
}

export function getAdapter(type: string): RelayAdapter | undefined {
  return registry.get(type)
}

export function supportedTypes(): string[] {
  return [...registry.keys()].sort()
}
