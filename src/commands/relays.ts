import { loadConfig } from "../core/config.js"
import { dataDir } from "../core/paths.js"
import { getAdapter, supportedTypes } from "../relays/index.js"

/** Query every configured relay's balance and print a summary table. */
export async function runRelays(): Promise<void> {
  const cfg = loadConfig(dataDir())
  if (cfg.relays.length === 0) {
    console.log("no relays configured — add them to usageplane.yaml (see relays example)")
    return
  }

  let failures = 0
  for (const relay of cfg.relays) {
    const adapter = getAdapter(relay.type)
    if (!adapter) {
      console.warn(`${relay.id}: unsupported type "${relay.type}" (supported: ${supportedTypes().join(", ")})`)
      failures++
      continue
    }
    try {
      const b = await adapter.fetchBalance(relay)
      const cur = relay.currency ?? "$"
      const used = b.used_usd === undefined ? "" : `, used ${cur}${b.used_usd.toFixed(4)}`
      const balance = b.unlimited
        ? "unlimited"
        : b.balance_usd === undefined
          ? "n/a"
          : `${cur}${b.balance_usd.toFixed(4)}`
      const scope = b.scope === "key" ? " [key scope — use an access token for account balance]" : ""
      console.log(`${relay.id} (${relay.type}): balance ${balance}${used}${scope}`)
    } catch (err) {
      console.error(`${relay.id}: ${err instanceof Error ? err.message : String(err)}`)
      failures++
    }
  }
  if (failures > 0) process.exitCode = 1
}
