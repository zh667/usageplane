import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import {
  collectAntigravity,
  extractAntigravityGenInfo,
  listAntigravityTranscripts,
  normalizeAntigravityModel,
  resolveAntigravityDbPath,
  toUtcHalfHourStart,
} from "../src/collectors/antigravity.js"
import { computeRowCost } from "../src/core/pricing.js"

// --- tiny protobuf encoder matching the gen_metadata layout -----------------
function varint(n: number): Buffer {
  const out: number[] = []
  while (n >= 0x80) {
    out.push((n % 128) | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return Buffer.from(out)
}
const vField = (num: number, v: number) => Buffer.concat([varint(num * 8), varint(v)])
const lField = (num: number, b: Buffer | string) => {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, "utf8")
  return Buffer.concat([varint(num * 8 + 2), varint(buf.length), buf])
}
interface Usage {
  sys?: number
  prompt?: number
  out?: number
  cached?: number
  text?: number
  reason?: number
}
function genBlob(lastStep: number, model: string, u: Usage): Buffer {
  const usage = Buffer.concat(
    (
      [
        [1, u.sys],
        [2, u.prompt],
        [3, u.out],
        [5, u.cached],
        [9, u.text],
        [10, u.reason],
      ] as [number, number | undefined][]
    )
      .filter(([, v]) => v !== undefined)
      .map(([n, v]) => vField(n, v as number)),
  )
  const kv = Buffer.concat([lField(1, "last_step_index"), lField(2, String(lastStep))])
  const inner = Buffer.concat([lField(4, usage), lField(19, model), lField(20, kv)])
  return lField(1, inner)
}

interface Fixture {
  home: string
  addConversation(id: string, events: unknown[], gen?: Buffer[], opts?: { variant?: string }): string
}
function makeHome(): Fixture {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-ag-test-"))
  return {
    home,
    addConversation(id, events, gen, opts = {}) {
      const variant = path.join(home, opts.variant ?? "antigravity")
      const logs = path.join(variant, "brain", id, ".system_generated", "logs")
      fs.mkdirSync(logs, { recursive: true })
      const lines = events.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n") + "\n"
      const transcript = path.join(logs, "transcript.jsonl")
      fs.writeFileSync(transcript, lines)
      if (gen) {
        fs.mkdirSync(path.join(variant, "conversations"), { recursive: true })
        const db = new Database(path.join(variant, "conversations", `${id}.db`))
        db.exec("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB)")
        const ins = db.prepare("INSERT INTO gen_metadata (idx, data) VALUES (?, ?)")
        gen.forEach((b, i) => ins.run(i, b))
        db.close()
      }
      return transcript
    },
  }
}

const planner = (step: number, at: string, extra: Record<string, unknown> = {}) => ({
  step_index: step,
  type: "PLANNER_RESPONSE",
  source: "MODEL",
  status: "DONE",
  created_at: at,
  ...extra,
})

test("db usage is primary: input = system prefix + prompt, output = text, reasoning separate", async () => {
  const fx = makeHome()
  fx.addConversation(
    "conv-a",
    [
      { step_index: 0, type: "USER_INPUT", created_at: "2026-11-22T10:01:00Z", content: "hi" },
      // transcript fields deliberately differ to prove the db wins
      planner(1, "2026-11-22T10:05:00Z", { input_tokens: 999, cache_read_tokens: 999, output_tokens: 999, model: "gemini-4-carbon-high" }),
      planner(3, "2026-11-22T10:40:00Z"),
    ],
    [
      genBlob(0, "gemini-4-carbon", { sys: 1427, prompt: 14346, cached: 0, out: 2392, text: 1639, reason: 753 }),
      genBlob(2, "gemini-4-carbon", { sys: 1427, prompt: 6933, cached: 14347, out: 1215, text: 252, reason: 963 }),
    ],
  )
  const recs = await collectAntigravity({ deviceId: "dev", geminiHome: fx.home })
  assert.equal(recs.length, 2)
  const first = recs.find((r) => r.hour_start === "2026-11-22T10:00:00.000Z")!
  assert.equal(first.model, "gemini-4-carbon")
  assert.equal(first.tool, "antigravity")
  assert.equal(first.source_kind, "unknown")
  assert.equal(first.input_tokens, 1427 + 14346)
  assert.equal(first.cached_input_tokens, 0)
  assert.equal(first.output_tokens, 1639)
  assert.equal(first.reasoning_output_tokens, 753)
  assert.equal(first.total_tokens, 1427 + 14346 + 1639 + 753)
  assert.equal(first.conversation_count, 1)
  const second = recs.find((r) => r.hour_start === "2026-11-22T10:30:00.000Z")!
  assert.equal(second.cached_input_tokens, 14347)
})

test("output falls back to total − reasoning when the text field is absent", async () => {
  const fx = makeHome()
  fx.addConversation("c", [planner(5, "2026-11-22T11:00:00Z")], [genBlob(4, "gemini-4-neon", { prompt: 10, out: 100, reason: 40 })])
  const [r] = await collectAntigravity({ deviceId: "d", geminiHome: fx.home })
  assert.equal(r.output_tokens, 60)
  assert.equal(r.reasoning_output_tokens, 40)
})

test("transcript token fields are the fallback when the db has no row for a turn", async () => {
  const fx = makeHome()
  fx.addConversation(
    "c",
    [planner(1, "2026-11-22T12:00:00Z", { input_tokens: 500, cache_read_tokens: 2000, output_tokens: 70, model: "gemini-4-carbon-high" })],
    [], // db exists but empty
  )
  const [r] = await collectAntigravity({ deviceId: "d", geminiHome: fx.home })
  assert.equal(r.input_tokens, 500)
  assert.equal(r.cached_input_tokens, 2000)
  assert.equal(r.output_tokens, 70)
  assert.equal(r.reasoning_output_tokens, 0)
  assert.equal(r.model, "gemini-4-carbon")
})

test("turns with no measured usage are skipped, never estimated from text", async () => {
  const fx = makeHome()
  fx.addConversation("c", [
    planner(1, "2026-11-22T12:00:00Z", { content: "a long answer ".repeat(500), thinking: "x".repeat(4000) }),
    planner(2, "2026-11-22T12:01:00Z", { input_tokens: 0, cache_read_tokens: 0, output_tokens: 0 }),
  ])
  assert.deepEqual(await collectAntigravity({ deviceId: "d", geminiHome: fx.home }), [])
})

test("malformed lines, non-planner events and missing timestamps are ignored", async () => {
  const fx = makeHome()
  fx.addConversation("c", [
    "{not json",
    { step_index: 0, type: "GENERIC", created_at: "2026-11-22T12:00:00Z", input_tokens: 5 },
    planner(1, "", { input_tokens: 5, output_tokens: 5 }),
    planner(2, "2026-11-22T12:00:00Z", { input_tokens: 5, output_tokens: 5 }),
    '{"type":"PLANNER_RESPONSE","created_at":"2026-11-22T12:', // partial trailing write
  ])
  const recs = await collectAntigravity({ deviceId: "d", geminiHome: fx.home })
  assert.equal(recs.length, 1)
  assert.equal(recs[0].input_tokens, 5)
})

test("only transcript.jsonl is read — identical transcript_*.jsonl siblings do not double count", async () => {
  const fx = makeHome()
  const t = fx.addConversation("c", [planner(1, "2026-11-22T12:00:00Z", { input_tokens: 5, output_tokens: 5 })])
  fs.copyFileSync(t, path.join(path.dirname(t), "transcript_full.jsonl"))
  assert.equal(listAntigravityTranscripts(fx.home).length, 1)
  const [r] = await collectAntigravity({ deviceId: "d", geminiHome: fx.home })
  assert.equal(r.input_tokens, 5)
})

test("all three variant roots are scanned and buckets merge per (model, half hour)", async () => {
  const fx = makeHome()
  fx.addConversation("a", [planner(1, "2026-11-22T12:10:00Z", { input_tokens: 1, output_tokens: 1, model: "gemini-4-carbon" })])
  fx.addConversation("b", [planner(1, "2026-11-22T12:20:00Z", { input_tokens: 2, output_tokens: 2, model: "gemini-4-carbon" })], undefined, { variant: "antigravity-ide" })
  fx.addConversation("c", [planner(1, "2026-11-22T12:25:00Z", { input_tokens: 4, output_tokens: 4, model: "gemini-4-carbon" })], undefined, { variant: "antigravity-cli" })
  const recs = await collectAntigravity({ deviceId: "d", geminiHome: fx.home })
  assert.equal(recs.length, 1)
  assert.equal(recs[0].input_tokens, 7)
  assert.equal(recs[0].conversation_count, 3)
})

test("model attribution falls back to Model Selection changes, then settings.json", async () => {
  const fx = makeHome()
  fs.mkdirSync(path.join(fx.home, "antigravity"), { recursive: true })
  fs.writeFileSync(path.join(fx.home, "antigravity", "settings.json"), JSON.stringify({ model: "Gemini 4 Argon" }))
  fx.addConversation("c", [
    planner(1, "2026-11-22T12:00:00Z", { input_tokens: 1, output_tokens: 1 }),
    { step_index: 2, type: "USER_SETTINGS_CHANGE", created_at: "2026-11-22T12:01:00Z", content: "User changed setting `Model Selection` from Gemini 4 Argon to Gemini 4 Neon (High)." },
    planner(3, "2026-11-22T12:02:00Z", { input_tokens: 1, output_tokens: 1 }),
  ])
  const models = (await collectAntigravity({ deviceId: "d", geminiHome: fx.home })).map((r) => r.model).sort()
  assert.deepEqual(models, ["gemini-4-argon", "gemini-4-neon"])
})

test("reasoning bills at the output rate (antigravity output excludes reasoning)", () => {
  const cost = computeRowCost({
    tool: "antigravity",
    model: "gemini-4-carbon",
    input_tokens: 0,
    output_tokens: 1_000_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 1_000_000,
  })
  assert.equal(cost, 20) // 2M output-rate tokens at $10/MTok
})

test("helpers: model normalization, db path, half-hour buckets, corrupt blobs", () => {
  assert.equal(normalizeAntigravityModel("gemini-4-carbon-high"), "gemini-4-carbon")
  assert.equal(normalizeAntigravityModel("Gemini 4 Neon (High)"), "gemini-4-neon")
  assert.equal(normalizeAntigravityModel("Claude Opus 4.8 (Thinking)"), "claude-opus-4.8")
  assert.equal(normalizeAntigravityModel("mystery"), "antigravity-mystery")
  assert.equal(normalizeAntigravityModel(""), null)
  assert.equal(
    resolveAntigravityDbPath(path.join("/h", "antigravity", "brain", "id1", ".system_generated", "logs", "transcript.jsonl")),
    path.join("/h", "antigravity", "conversations", "id1.db"),
  )
  assert.equal(resolveAntigravityDbPath("/elsewhere/transcript.jsonl"), null)
  assert.equal(toUtcHalfHourStart("2026-11-22T10:59:59Z"), "2026-11-22T10:30:00.000Z")
  assert.equal(toUtcHalfHourStart("garbage"), null)
  assert.equal(extractAntigravityGenInfo(Buffer.from([0x0a, 0xff])), null)
})

test("pricing: Antigravity's dotted Claude ids and gpt-oss route to real entries", async () => {
  const { getModelPricing } = await import("../src/core/pricing.js")
  assert.deepEqual(getModelPricing("claude-opus-4.8", "antigravity"), getModelPricing("claude-opus-4-8"))
  assert.notEqual(getModelPricing("claude-opus-4.8", "antigravity").input, 0)
  assert.deepEqual(getModelPricing("gpt-oss-120b", "antigravity"), getModelPricing("antigravity-gpt-oss-120b"))
})
