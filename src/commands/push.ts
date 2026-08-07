import { loadConfig, resolveHubToken } from "../core/config.js"
import { dataDir, dbPath } from "../core/paths.js"
import { Store } from "../core/store.js"

/**
 * Push every local usage record to the aggregation hub's /api/ingest.
 * Safe to run repeatedly — the hub's upsert is last-write-wins per bucket.
 * Run `sync` first so the push carries fresh data.
 */
export async function runPush(urlArg?: string, opts: { quiet?: boolean } = {}): Promise<void> {
  const log = opts.quiet ? () => {} : console.log
  const dir = dataDir()
  const cfg = loadConfig(dir)
  const url = urlArg ?? cfg.hub?.url
  if (!url) {
    console.error("no hub url — pass one (usageplane push http://…) or set hub.url in usageplane.yaml")
    process.exitCode = 1
    return
  }
  const token = resolveHubToken(cfg.hub)
  if (!token) {
    console.error("no hub token — set hub.token or hub.token_env in usageplane.yaml (same value as on the hub)")
    process.exitCode = 1
    return
  }

  const store = new Store(dbPath(dir))
  let records
  let sessions
  try {
    records = store.allRecords()
    sessions = store.allSessionRows()
  } finally {
    store.close()
  }
  if (records.length === 0) {
    log("nothing to push — run `usageplane sync` first")
    return
  }

  const endpoint = `${url.replace(/\/+$/, "")}/api/ingest`
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ records, sessions }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    console.error(`push failed: HTTP ${res.status} ${text.slice(0, 200)}`)
    process.exitCode = 1
    return
  }
  const result = (await res.json()) as { upserted?: number; total?: number }
  log(`pushed ${records.length} buckets → hub upserted ${result.upserted}, hub now holds ${result.total} records`)
}
