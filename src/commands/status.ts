import { loadConfig } from "../core/config.js"
import { dataDir, dbPath } from "../core/paths.js"
import { Store } from "../core/store.js"
import { getAdapter } from "../relays/index.js"

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

/**
 * Two-column summary for terminals (the no-browser VPS case):
 * AI coding usage from the local store, relay assets queried live.
 * The two sections are deliberately separate — token counts and relay
 * money are different scopes and are never merged into one number.
 */
export async function runStatus(): Promise<void> {
  const dir = dataDir()
  const cfg = loadConfig(dir)
  const store = new Store(dbPath(dir))
  try {
    console.log(`device: ${cfg.device}\n`)

    console.log("AI 编程用量 (local store)")
    const tools = store.totalsByTool()
    if (tools.length === 0) {
      console.log("  (empty — run `usageplane sync` first)")
    }
    for (const t of tools) {
      console.log(
        `  ${t.tool}: ${fmt(t.total_tokens)} tokens (in ${fmt(t.input_tokens)} / out ${fmt(t.output_tokens)}), ${t.conversation_count} conversations`,
      )
    }
    const devices = store.totalsByDevice()
    if (devices.length > 1) {
      for (const d of devices) {
        console.log(`    ${d.device_id} ${d.tool}: ${fmt(d.total_tokens)} tokens`)
      }
    }
    const days = store.totalsByDay(3)
    for (const d of days) {
      console.log(`    ${d.day} ${d.tool}: ${fmt(d.total_tokens)} tokens`)
    }

    console.log("\n中转站资产 (live)")
    if (cfg.relays.length === 0) {
      console.log("  (no relays configured)")
    }
    for (const relay of cfg.relays) {
      const adapter = getAdapter(relay.type)
      if (!adapter) {
        console.log(`  ${relay.id}: unsupported type "${relay.type}"`)
        continue
      }
      try {
        const b = await adapter.fetchBalance(relay)
        const cur = relay.currency ?? "$"
        const balance = b.unlimited ? "unlimited" : b.balance_usd === undefined ? "n/a" : `${cur}${b.balance_usd.toFixed(2)}`
        const used = b.used_usd === undefined ? "" : `, used ${cur}${b.used_usd.toFixed(2)}`
        console.log(`  ${relay.id}: balance ${balance}${used} [${b.scope}]`)
      } catch (err) {
        console.log(`  ${relay.id}: error — ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } finally {
    store.close()
  }
}
