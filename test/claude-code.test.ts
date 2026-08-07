import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  claudeMessageDedupKey,
  collectClaudeCode,
  normalizeClaudeUsage,
  toUtcHalfHourStart,
} from "../src/collectors/claude-code.js"

function makeClaudeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-claude-"))
  fs.mkdirSync(path.join(home, "projects", "-home-x-my-proj"), { recursive: true })
  return home
}

function usageLine(opts: {
  msgId?: string
  reqId?: string
  model?: string
  ts?: string
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: opts.ts ?? "2026-08-07T09:10:00Z",
    requestId: opts.reqId,
    message: {
      id: opts.msgId ?? "msg_1",
      model: opts.model ?? "claude-sonnet-5",
      usage: {
        input_tokens: opts.input ?? 10,
        output_tokens: opts.output ?? 5,
        cache_read_input_tokens: opts.cacheRead ?? 100,
        cache_creation_input_tokens: opts.cacheWrite ?? 20,
      },
    },
  })
}

function userLine(uuid: string, ts = "2026-08-07T09:05:00Z", content: unknown = [{ type: "text", text: "hi" }]): string {
  return JSON.stringify({ type: "user", uuid, timestamp: ts, cwd: "/home/x/my-proj", message: { content } })
}

function writeSession(home: string, name: string, lines: string[]): void {
  fs.writeFileSync(path.join(home, "projects", "-home-x-my-proj", name), lines.join("\n") + "\n")
}

test("parses usage rows into half-hour buckets with project from cwd", async () => {
  const home = makeClaudeHome()
  writeSession(home, "s1.jsonl", [
    userLine("u1"),
    usageLine({ msgId: "m1", reqId: "r1" }),
    usageLine({ msgId: "m2", reqId: "r2", ts: "2026-08-07T09:40:00Z" }),
  ])
  const records = await collectClaudeCode({ deviceId: "dev1", claudeHome: home })

  const usageRecs = records.filter((r) => r.model === "claude-sonnet-5")
  assert.equal(usageRecs.length, 2, "two half-hour buckets")
  assert.deepEqual(
    usageRecs.map((r) => r.hour_start).sort(),
    ["2026-08-07T09:00:00.000Z", "2026-08-07T09:30:00.000Z"],
  )
  for (const r of usageRecs) {
    assert.equal(r.project, "my-proj")
    assert.equal(r.tool, "claude-code")
    assert.equal(r.source_kind, "unknown")
    assert.equal(r.input_tokens, 10)
    assert.equal(r.cached_input_tokens, 100)
    assert.equal(r.cache_creation_input_tokens, 20)
    assert.equal(r.total_tokens, 135)
  }
  const convRec = records.find((r) => r.model === "unknown")
  assert.equal(convRec?.conversation_count, 1)
})

test("duplicate message (same msgId+requestId) across files counts once", async () => {
  const home = makeClaudeHome()
  writeSession(home, "s1.jsonl", [usageLine({ msgId: "m1", reqId: "r1" })])
  writeSession(home, "s2.jsonl", [usageLine({ msgId: "m1", reqId: "r1" })])
  const records = await collectClaudeCode({ deviceId: "dev1", claudeHome: home })
  const total = records.reduce((s, r) => s + r.input_tokens, 0)
  assert.equal(total, 10, "second copy must be deduped")
})

test("rows without requestId still dedup by message id (sub-agent case)", async () => {
  const home = makeClaudeHome()
  writeSession(home, "s1.jsonl", [usageLine({ msgId: "m1", reqId: undefined }), usageLine({ msgId: "m1", reqId: undefined })])
  const records = await collectClaudeCode({ deviceId: "dev1", claudeHome: home })
  assert.equal(records.reduce((s, r) => s + r.input_tokens, 0), 10)
})

test("tool_result user messages and subagent files do not count conversations", async () => {
  const home = makeClaudeHome()
  writeSession(home, "s1.jsonl", [userLine("u1", "2026-08-07T09:05:00Z", [{ type: "tool_result", content: "ok" }])])
  fs.mkdirSync(path.join(home, "projects", "-home-x-my-proj", "subagents"), { recursive: true })
  fs.writeFileSync(
    path.join(home, "projects", "-home-x-my-proj", "subagents", "sub.jsonl"),
    userLine("u2") + "\n",
  )
  const records = await collectClaudeCode({ deviceId: "dev1", claudeHome: home })
  assert.equal(records.reduce((s, r) => s + r.conversation_count, 0), 0)
})

test("zero usage, malformed lines, and missing timestamps are skipped", async () => {
  const home = makeClaudeHome()
  writeSession(home, "s1.jsonl", [
    "not json {{{",
    JSON.stringify({ message: { id: "m0", usage: { input_tokens: 0, output_tokens: 0 } }, timestamp: "2026-08-07T09:00:00Z" }),
    JSON.stringify({ message: { id: "m1", usage: { input_tokens: 5, output_tokens: 1 } } }),
  ])
  const records = await collectClaudeCode({ deviceId: "dev1", claudeHome: home })
  assert.equal(records.length, 0)
})

test("claudeMessageDedupKey follows upstream shape", () => {
  assert.equal(claudeMessageDedupKey({ message: { id: "m" }, requestId: "r" }), "m:r")
  assert.equal(claudeMessageDedupKey({ message: { id: "m" } }), "m")
  assert.equal(claudeMessageDedupKey({ requestId: "r" }), null)
})

test("normalizeClaudeUsage maps cache fields and sums total", () => {
  const u = normalizeClaudeUsage({
    input_tokens: 1,
    output_tokens: 2,
    cache_read_input_tokens: 3,
    cache_creation_input_tokens: 4,
  })
  assert.deepEqual(u, {
    input_tokens: 1,
    cached_input_tokens: 3,
    cache_creation_input_tokens: 4,
    output_tokens: 2,
    reasoning_output_tokens: 0,
    total_tokens: 10,
  })
})

test("toUtcHalfHourStart buckets to :00 / :30 and rejects garbage", () => {
  assert.equal(toUtcHalfHourStart("2026-08-07T09:29:59Z"), "2026-08-07T09:00:00.000Z")
  assert.equal(toUtcHalfHourStart("2026-08-07T09:30:00Z"), "2026-08-07T09:30:00.000Z")
  assert.equal(toUtcHalfHourStart("not a date"), null)
})
