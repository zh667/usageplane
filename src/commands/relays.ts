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

      if (adapter.fetchTodayUsage && adapter.supports.includes("usage_log")) {
        try {
          const u = await adapter.fetchTodayUsage(relay)
          const partial = u.partial ? " (partial — page cap hit)" : ""
          console.log(`  today: ${cur}${u.usd.toFixed(4)}, ${u.requests} requests${partial}`)
          for (const m of u.models.slice(0, 8)) {
            console.log(`    ${m.model.padEnd(32)} ${cur}${m.usd.toFixed(4).padStart(9)}  ${String(m.requests).padStart(4)} req`)
          }
        } catch (err) {
          console.log(`  today: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } catch (err) {
      console.error(`${relay.id}: ${err instanceof Error ? err.message : String(err)}`)
      failures++
    }
  }
  if (failures > 0) process.exitCode = 1
}
