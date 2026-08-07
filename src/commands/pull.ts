import { loadConfig, resolveHubToken } from "../core/config.js"
import { dataDir, dbPath } from "../core/paths.js"
import { Store, type DeviceStateRow, type SessionRow } from "../core/store.js"
import type { UsageRecord } from "../core/types.js"

/**
 * Pull the hub's full record set into the local store — the mirror of push.
 * After `pull`, this device's dashboard shows the merged all-devices view.
 * Idempotent: buckets upsert last-write-wins on the same keys.
 */
export async function runPull(urlArg?: string): Promise<void> {
  const dir = dataDir()
  const cfg = loadConfig(dir)
  const url = urlArg ?? cfg.hub?.url
  if (!url) {
    console.error("no hub url — pass one (usageplane pull http://…) or set hub.url in usageplane.yaml")
    process.exitCode = 1
    return
  }
  const token = resolveHubToken(cfg.hub)
  if (!token) {
    console.error("no hub token — set hub.token or hub.token_env in usageplane.yaml (same value as on the hub)")
    process.exitCode = 1
    return
  }

  const endpoint = `${url.replace(/\/+$/, "")}/api/export`
  const res = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    console.error(`pull failed: HTTP ${res.status} ${text.slice(0, 200)}`)
    process.exitCode = 1
    return
  }
  const payload = (await res.json()) as {
    records?: UsageRecord[]
    sessions?: SessionRow[]
    state?: DeviceStateRow[]
  }
  if (!Array.isArray(payload.records)) {
    console.error("pull failed: hub response has no records array")
    process.exitCode = 1
    return
  }

  const store = new Store(dbPath(dir))
  try {
    const n = store.upsertUsage(payload.records)
    const nSessions = Array.isArray(payload.sessions) ? store.upsertSessionRows(payload.sessions) : 0
    const nState = Array.isArray(payload.state) ? store.upsertDeviceState(payload.state) : 0
    console.log(
      `pulled ${n} buckets + ${nSessions} session entries + ${nState} device-state rows — local database now holds ${store.countRecords()} records`,
    )
  } finally {
    store.close()
  }
}
