import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { codexSessionIdFromPath, collectCodex, normalizeCodexUsage } from "../src/collectors/codex.js"

const UUID = "12345678-abcd-4abc-8def-1234567890ab"
const UUID2 = "87654321-abcd-4abc-8def-1234567890ab"

function makeCodexHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-codex-"))
  fs.mkdirSync(path.join(home, "sessions", "2026", "08", "07"), { recursive: true })
  return home
}

function writeRollout(home: string, name: string, lines: string[], sub = "sessions/2026/08/07"): void {
  fs.mkdirSync(path.join(home, sub), { recursive: true })
  fs.writeFileSync(path.join(home, sub, name), lines.join("\n") + "\n")
}

function meta(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "session_meta",
    timestamp: "2026-08-07T09:00:00Z",
    payload: { cwd: "/home/x/proj-x", model: "gpt-5.4", ...extra },
  })
}

function tokenCount(opts: {
  ts: string
  last?: Record<string, number> | null
  total: Record<string, number>
}): string {
  return JSON.stringify({
    type: "event_msg",
    timestamp: opts.ts,
    payload: {
      type: "token_count",
      info: { last_token_usage: opts.last ?? null, total_token_usage: opts.total },
    },
  })
}

const usage = (input: number, cached: number, output: number, total?: number) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  reasoning_output_tokens: 0,
  cache_creation_input_tokens: 0,
  total_tokens: total ?? input + output,
})

test("cumulative token_count events become deltas; cached input is subtracted", async () => {
  const home = makeCodexHome()
  writeRollout(home, `rollout-2026-08-07T09-00-00-${UUID}.jsonl`, [
    meta(),
    // turn 1: input 100 (of which 40 cached), output 10
    tokenCount({ ts: "2026-08-07T09:01:00Z", last: usage(100, 40, 10), total: usage(100, 40, 10) }),
    // turn 2: adds input 50 (of which 20 cached), output 5
    tokenCount({ ts: "2026-08-07T09:02:00Z", last: usage(50, 20, 5), total: usage(150, 60, 15) }),
  ])
  const records = await collectCodex({ deviceId: "d", codexHome: home })
  assert.equal(records.length, 1)
  const r = records[0]
  assert.equal(r.tool, "codex")
  assert.equal(r.project, "proj-x")
  assert.equal(r.model, "gpt-5.4")
  // input excludes cached: (100-40) + (50-20) = 90
  assert.equal(r.input_tokens, 90)
  assert.equal(r.cached_input_tokens, 60)
  assert.equal(r.output_tokens, 15)
  assert.equal(r.total_tokens, 165)
  assert.equal(r.conversation_count, 2)
})

test("repeated cumulative snapshot (rate-limit poll) adds nothing", async () => {
  const home = makeCodexHome()
  const snap = tokenCount({ ts: "2026-08-07T09:01:00Z", last: usage(100, 0, 10), total: usage(100, 0, 10) })
  const poll = tokenCount({ ts: "2026-08-07T09:03:00Z", last: null, total: usage(100, 0, 10) })
  writeRollout(home, `rollout-2026-08-07T09-00-00-${UUID}.jsonl`, [meta(), snap, poll])
  const records = await collectCodex({ deviceId: "d", codexHome: home })
  assert.equal(records[0].input_tokens, 100)
  assert.equal(records[0].conversation_count, 1)
})

test("same session in sessions/ and archived_sessions/ counts once", async () => {
  const home = makeCodexHome()
  const lines = [meta(), tokenCount({ ts: "2026-08-07T09:01:00Z", last: usage(10, 0, 1), total: usage(10, 0, 1) })]
  writeRollout(home, `rollout-2026-08-07T09-00-00-${UUID}.jsonl`, lines)
  writeRollout(home, `rollout-2026-08-07T09-00-00-${UUID}.jsonl`, lines, "archived_sessions/2026/08/07")
  const records = await collectCodex({ deviceId: "d", codexHome: home })
  assert.equal(records.reduce((s, r) => s + r.input_tokens, 0), 10)
})

test("forked rollout's dense replay prefix is skipped, live turns kept", async () => {
  const home = makeCodexHome()
  writeRollout(home, `rollout-2026-08-07T09-00-00-${UUID2}.jsonl`, [
    meta({ forked_from_id: UUID }),
    // replay burst: ms-apart rows (first one is counted — bounded residual, per upstream)
    tokenCount({ ts: "2026-08-07T09:00:00.100Z", last: usage(10, 0, 1), total: usage(10, 0, 1) }),
    tokenCount({ ts: "2026-08-07T09:00:00.105Z", last: usage(20, 0, 2), total: usage(30, 0, 3) }),
    tokenCount({ ts: "2026-08-07T09:00:00.110Z", last: usage(30, 0, 3), total: usage(60, 0, 6) }),
    // genuine live turn, seconds later
    tokenCount({ ts: "2026-08-07T09:00:15Z", last: usage(40, 0, 4), total: usage(100, 0, 10) }),
  ])
  const records = await collectCodex({ deviceId: "d", codexHome: home })
  const inputSum = records.reduce((s, r) => s + r.input_tokens, 0)
  // first replay row (10) + live turn (40); middle burst rows skipped
  assert.equal(inputSum, 50)
})

test("normalizeCodexUsage subtracts cached from input and recomputes total", () => {
  const n = normalizeCodexUsage({
    input_tokens: 100,
    cached_input_tokens: 60,
    cache_creation_input_tokens: 0,
    output_tokens: 7,
    reasoning_output_tokens: 5,
    total_tokens: 999,
  })
  assert.equal(n.input_tokens, 40)
  assert.equal(n.total_tokens, 40 + 60 + 0 + 7)
})

test("codexSessionIdFromPath extracts the trailing uuid", () => {
  assert.equal(codexSessionIdFromPath(`/x/rollout-2026-08-07T09-00-00-${UUID}.jsonl`), UUID)
  assert.equal(codexSessionIdFromPath("/x/other.jsonl"), null)
})
