import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"
import { Store } from "../src/core/store.js"
import { createServer } from "../src/server/index.js"
import type { UsageRecord } from "../src/core/types.js"

function seededDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-srv-"))
  const store = new Store(path.join(dir, "usageplane.db"))
  const rec: UsageRecord = {
    device_id: "test",
    tool: "claude-code",
    project: "proj-a",
    source_kind: "unknown",
    model: "claude-sonnet-5",
    hour_start: "2026-08-07T09:00:00.000Z",
    input_tokens: 10,
    output_tokens: 20,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 30,
    conversation_count: 2,
  }
  store.upsertUsage([rec, { ...rec, hour_start: "2026-08-06T10:00:00.000Z", project: "proj-b" }])
  store.close()
  return dir
}

async function withServer<T>(dir: string, fn: (base: string) => Promise<T>): Promise<T> {
  const server = createServer(dir)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
  }
}

test("/api/summary aggregates tools, models, projects, days", async () => {
  await withServer(seededDir(), async (base) => {
    const s = await fetch(`${base}/api/summary`).then((r) => r.json())
    assert.equal(s.record_count, 2)
    assert.equal(s.tools[0].tool, "claude-code")
    assert.equal(s.tools[0].total_tokens, 60)
    assert.equal(s.models[0].model, "claude-sonnet-5")
    assert.deepEqual(s.projects.map((p: { project: string }) => p.project).sort(), ["proj-a", "proj-b"])
    assert.equal(s.days.length, 2)
    assert.equal(s.days[0].day, "2026-08-07")
  })
})

test("/api/relays returns [] with no relays configured; / serves the dashboard; unknown 404s", async () => {
  await withServer(seededDir(), async (base) => {
    const relays = await fetch(`${base}/api/relays`).then((r) => r.json())
    assert.deepEqual(relays, [])

    const page = await fetch(base)
    assert.equal(page.status, 200)
    assert.match(page.headers.get("content-type") ?? "", /text\/html/)
    assert.match(await page.text(), /UsagePlane/)

    const missing = await fetch(`${base}/nope`)
    assert.equal(missing.status, 404)
  })
})

test("store aggregation queries group correctly", () => {
  const dir = seededDir()
  const store = new Store(path.join(dir, "usageplane.db"))
  assert.equal(store.totalsByModel()[0].total_tokens, 60)
  assert.equal(store.totalsByProject().length, 2)
  assert.equal(store.totalsByDay(1).length, 1, "LIMIT applies")
  store.close()
})
