import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Store } from "../src/core/store.js"
import type { UsageRecord } from "../src/core/types.js"

function tempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-test-"))
  return path.join(dir, "test.db")
}

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    device_id: "test-device",
    tool: "claude-code",
    project: "my-project",
    source_kind: "unknown",
    model: "claude-sonnet-5",
    hour_start: "2026-08-07T09:00:00Z",
    input_tokens: 100,
    output_tokens: 50,
    cached_input_tokens: 1000,
    cache_creation_input_tokens: 200,
    reasoning_output_tokens: 0,
    total_tokens: 1350,
    conversation_count: 1,
    ...overrides,
  }
}

test("upsert inserts then overwrites the same bucket (last write wins)", () => {
  const store = new Store(tempDb())
  assert.equal(store.upsertUsage([record()]), 1)
  assert.equal(store.countRecords(), 1)

  store.upsertUsage([record({ input_tokens: 999, total_tokens: 2249 })])
  assert.equal(store.countRecords(), 1, "same key must not create a second row")
  const totals = store.totalsByTool()
  assert.equal(totals[0].input_tokens, 999)
  store.close()
})

test("different bucket keys create separate rows", () => {
  const store = new Store(tempDb())
  store.upsertUsage([
    record(),
    record({ hour_start: "2026-08-07T10:00:00Z" }),
    record({ model: "claude-opus-5" }),
    record({ device_id: "other-device" }),
  ])
  assert.equal(store.countRecords(), 4)
  store.close()
})

test("totalsByTool aggregates across buckets per tool", () => {
  const store = new Store(tempDb())
  store.upsertUsage([
    record(),
    record({ hour_start: "2026-08-07T10:00:00Z" }),
    record({ tool: "codex", input_tokens: 7 }),
  ])
  const totals = store.totalsByTool()
  const claude = totals.find((t) => t.tool === "claude-code")
  const codex = totals.find((t) => t.tool === "codex")
  assert.equal(claude?.input_tokens, 200)
  assert.equal(claude?.conversation_count, 2)
  assert.equal(codex?.input_tokens, 7)
  store.close()
})

test("reopening an existing database is idempotent (migrations do not re-run)", () => {
  const dbFile = tempDb()
  const a = new Store(dbFile)
  a.upsertUsage([record()])
  a.close()
  const b = new Store(dbFile)
  assert.equal(b.countRecords(), 1)
  b.close()
})

test("negative token counts are rejected", () => {
  const store = new Store(tempDb())
  assert.throws(() => store.upsertUsage([record({ input_tokens: -1 })]), /non-negative/)
  store.close()
})

test("replaceOtherDevicesState: hub rows replace other devices' state, own device untouched", () => {
  const store = new Store(":memory:")
  store.upsertDeviceState([
    { device_id: "self", kind: "skill", key: "user::mine", payload: "{}" },
    { device_id: "remote", kind: "skill", key: "user::stale", payload: "{}" },
  ])
  store.replaceOtherDevicesState("self", [
    { device_id: "remote", kind: "skill", key: "user::fresh", payload: "{}" },
    // Own-device rows in the payload are ignored — local state is authoritative.
    { device_id: "self", kind: "skill", key: "user::hub-copy", payload: "{}" },
  ])
  const rows = store.deviceState("skill").map((r) => `${r.device_id}:${r.key}`).sort()
  assert.deepEqual(rows, ["remote:user::fresh", "self:user::mine"])
  store.close()
})
