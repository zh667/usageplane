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
      const used = b.used_usd === undefined ? "" : `, used $${b.used_usd.toFixed(2)}`
      console.log(`${relay.id} (${relay.type}): balance $${b.balance_usd.toFixed(2)}${used}`)
    } catch (err) {
      console.error(`${relay.id}: ${err instanceof Error ? err.message : String(err)}`)
      failures++
    }
  }
  if (failures > 0) process.exitCode = 1
}
