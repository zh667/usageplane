import { collectClaudeCode } from "../collectors/claude-code.js"
import { collectCodex } from "../collectors/codex.js"
import { loadConfig } from "../core/config.js"
import { dataDir, dbPath } from "../core/paths.js"
import { allLimits } from "../core/limits.js"
import { listSessions } from "../core/sessions.js"
import { listSkills } from "../core/skills.js"
import { Store } from "../core/store.js"
import { runPush } from "./push.js"

/**
 * Run all enabled collectors and upsert their buckets into the local store.
 * When a hub is configured, pushes afterwards (TokenTracker's sync-uploads
 * behavior); quiet mode is for the Stop hook.
 */
export async function runSync(opts: { quiet?: boolean } = {}): Promise<void> {
  const log = opts.quiet ? () => {} : console.log
  const dir = dataDir()
  const cfg = loadConfig(dir)
  const store = new Store(dbPath(dir))
  try {
    let total = 0
    for (const collector of cfg.collectors) {
      if (collector === "claude-code") {
        const records = await collectClaudeCode({ deviceId: cfg.device })
        const n = store.upsertUsage(records)
        log(`claude-code: ${n} hourly buckets synced`)
        total += n
      } else if (collector === "codex") {
        const records = await collectCodex({ deviceId: cfg.device })
        const n = store.upsertUsage(records)
        log(`codex: ${n} hourly buckets synced`)
        total += n
      } else if (!opts.quiet) {
        console.warn(`skipping unknown collector "${collector}" (available: claude-code, codex)`)
      }
    }
    // Session metadata (titles etc. — never message bodies) is stored so
    // push can sync it to the hub and other devices can browse it.
    // Content-derived titles (user's first message) never leave the device;
    // hub.sync_sessions: false disables session sync entirely.
    if (cfg.hub?.sync_sessions !== false) {
      const sessions = await listSessions()
      const nSessions = store.upsertSessionRows(
        sessions.map((s) => ({
          ...s,
          device_id: cfg.device,
          title: s.title_source === "content" ? "" : s.title,
        })),
      )
      log(`sessions: ${nSessions} synced`)
    }
    // Device-side metadata for the cross-device view: installed skills and
    // subscription-limit snapshots (names and percentages — no secrets).
    const skills = await listSkills()
    store.replaceDeviceState(
      cfg.device,
      "skill",
      skills.map((s) => ({ key: s.name, payload: JSON.stringify({ description: s.description, agents: s.agents }) })),
    )
    const limits = (await allLimits()).filter((p) => p.connected)
    store.replaceDeviceState(
      cfg.device,
      "limit",
      limits.map((p) => ({ key: p.id, payload: JSON.stringify(p) })),
    )
    log(`device state: ${skills.length} skills, ${limits.length} connected providers`)
    log(`done — ${total} buckets, database now holds ${store.countRecords()} records`)
  } finally {
    store.close()
  }

  if (cfg.hub?.url) {
    await runPush(undefined, { quiet: opts.quiet }).catch((err) => {
      if (!opts.quiet) console.error(`auto-push failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }
}
