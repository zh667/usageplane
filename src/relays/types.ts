import type { RelayConfig } from "../core/config.js"

/**
 * What a relay site's API can answer. Not every site offers every capability —
 * many only expose balance/total consumption (docs/relay-sites.md), so the UI
 * must degrade per capability instead of assuming per-request logs exist.
 */
export type RelayCapability = "balance" | "usage_log" | "checkin" | "pricing"

export interface RelayBalance {
  /** Remaining quota in the site's native quota units. */
  quota: number
  /** Total consumed quota units, when the site reports it. */
  used_quota?: number
  /** Remaining balance in USD (quota / quota_per_unit). */
  balance_usd: number
  used_usd?: number
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
