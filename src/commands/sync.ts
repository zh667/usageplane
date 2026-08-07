import { collectClaudeCode } from "../collectors/claude-code.js"
import { loadConfig } from "../core/config.js"
import { dataDir, dbPath } from "../core/paths.js"
import { Store } from "../core/store.js"

/** Run all enabled collectors and upsert their buckets into the local store. */
export async function runSync(): Promise<void> {
  const dir = dataDir()
  const cfg = loadConfig(dir)
  const store = new Store(dbPath(dir))
  try {
    let total = 0
    for (const collector of cfg.collectors) {
      if (collector === "claude-code") {
        const records = await collectClaudeCode({ deviceId: cfg.device })
        const n = store.upsertUsage(records)
        console.log(`claude-code: ${n} hourly buckets synced`)
        total += n
      } else {
        console.warn(`skipping unknown collector "${collector}" (available: claude-code)`)
      }
    }
    console.log(`done — ${total} buckets, database now holds ${store.countRecords()} records`)
  } finally {
    store.close()
  }
}
