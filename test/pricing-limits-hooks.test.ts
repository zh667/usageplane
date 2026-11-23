import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { computeRowCost, getModelPricing } from "../src/core/pricing.js"
import { parseClaudeUsageBody } from "../src/core/limits.js"
import { runHooks } from "../src/commands/hooks.js"

test("pricing: fable-5 rates apply per split column, never total_tokens", () => {
  const p = getModelPricing("claude-fable-5")
  assert.equal(p.input, 10)
  assert.equal(p.output, 50)
  const cost = computeRowCost({
    model: "claude-fable-5",
    input_tokens: 1_000_000,
    output_tokens: 0,
    cached_input_tokens: 1_000_000,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
  })
  assert.equal(cost, 10 + 1) // $10 input + $1 cache read
})

test("pricing: codex reasoning folds into output (no double charge); unknown model = 0", () => {
  const withReasoning = computeRowCost({
    tool: "codex",
    model: "gpt-5.6-sol",
    input_tokens: 0,
    output_tokens: 1000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 999_999,
  })
  const withoutReasoning = computeRowCost({
    tool: "codex",
    model: "gpt-5.6-sol",
    input_tokens: 0,
    output_tokens: 1000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
  })
  assert.equal(withReasoning, withoutReasoning)
  assert.equal(computeRowCost({ model: "totally-unknown-model", input_tokens: 1e6, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0 }), 0)
})

test("pricing: bare deepseek-flash (TokenLedger SKU) resolves to the v4-flash rates", () => {
  // TokenLedger stores DSH's fast tier as "deepseek-flash"; without the alias
  // its 1B+ tokens would silently price at $0.
  const bare = getModelPricing("deepseek-flash")
  const canonical = getModelPricing("deepseek-v4-flash")
  assert.deepEqual(bare, canonical)
  assert.equal(bare.input, 0.14)
  assert.equal(bare.output, 0.28)
  assert.notEqual(bare.input, 0)
})

test("pricing: deepseek reasoning folds into output (no double charge)", () => {
  const withReasoning = computeRowCost({
    tool: "deepseek",
    model: "deepseek-flash",
    input_tokens: 0,
    output_tokens: 1000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 999_999,
  })
  const withoutReasoning = computeRowCost({
    tool: "deepseek",
    model: "deepseek-flash",
    input_tokens: 0,
    output_tokens: 1000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
  })
  assert.equal(withReasoning, withoutReasoning)
  // Sanity: 1000 output tokens at $0.28/MTok, and reasoning must add nothing.
  assert.equal(withReasoning, 1000 * 0.28 / 1_000_000)
})

test("pricing: tools that report reasoning separately still get charged for it", () => {
  // Claude-style accounting reports reasoning outside output_tokens.
  const cost = computeRowCost({
    tool: "claude-code",
    model: "deepseek-flash",
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 1_000_000,
  })
  assert.equal(cost, 1_000_000 * 0.28 / 1_000_000)
})

test("limits: parses 5h/7d windows and scoped weekly entries", () => {  const windows = parseClaudeUsageBody({
    five_hour: { utilization: 46, resets_at: "2026-08-08T10:00:00Z" },
    seven_day: { utilization: 12, resets_at: "2026-08-13T00:00:00Z" },
    limits: [
      { kind: "weekly_scoped", percent: 20, resets_at: "2026-08-13T00:00:00Z", scope: { model: { display_name: "Fable" } } },
      { kind: "other", percent: 99 },
    ],
  })
  assert.deepEqual(windows.map((w) => `${w.label}:${w.utilization}`), ["5h:46", "7d:12", "Fable:20"])
})

test("limits: codex windows classified by seconds, not slot position", async () => {
  const { parseCodexUsageBody } = await import("../src/core/limits.js")
  // Free-tier shape: weekly window arrives in the PRIMARY slot.
  const windows = parseCodexUsageBody(
    {
      rate_limit: {
        primary_window: { used_percent: 41.6, limit_window_seconds: 604800, resets_in_seconds: 86400 },
        secondary_window: { used_percent: 12, limit_window_seconds: 18000 },
      },
    },
    1_000_000,
  )
  assert.deepEqual(windows.map((w) => `${w.label}:${w.utilization}`), ["7d:42", "5h:12"])
  assert.equal(windows[0].resets_at, new Date(1_000_000 + 86400 * 1000).toISOString())
})

test("limits: codex monthly window (2628000s) labels 30d; reset_after_seconds and numeric reset_at accepted", async () => {
  const { parseCodexUsageBody } = await import("../src/core/limits.js")
  // Real Windows wham response shape (2026-08-08): monthly window, countdown
  // in reset_after_seconds, absolute epoch in numeric reset_at.
  const windows = parseCodexUsageBody(
    {
      rate_limit: {
        primary_window: { used_percent: 16, limit_window_seconds: 2628000, reset_after_seconds: 3600 },
        secondary_window: { used_percent: 5, limit_window_seconds: 18000, reset_at: 1_754_600_000 },
      },
    },
    1_000_000,
  )
  assert.deepEqual(windows.map((w) => `${w.label}:${w.utilization}`), ["30d:16", "5h:5"])
  assert.equal(windows[0].resets_at, new Date(1_000_000 + 3600 * 1000).toISOString())
  assert.equal(windows[1].resets_at, new Date(1_754_600_000 * 1000).toISOString())
})

test("hooks: codex notify installs into config.toml, respects foreign settings", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-codexhook-"))
  const toml = path.join(home, ".codex", "config.toml")
  fs.mkdirSync(path.dirname(toml), { recursive: true })
  fs.writeFileSync(toml, 'model = "gpt-5.4"\n')

  runHooks("install", home)
  runHooks("install", home)
  const raw = fs.readFileSync(toml, "utf8")
  assert.equal(raw.split("\n").filter((l) => l.startsWith("notify")).length, 1, "idempotent")
  assert.ok(raw.includes("usageplane") && raw.includes('model = "gpt-5.4"'))

  runHooks("uninstall", home)
  const after = fs.readFileSync(toml, "utf8")
  assert.ok(!after.includes("notify"), "our line removed")
  assert.ok(after.includes('model = "gpt-5.4"'), "foreign content preserved")

  // A foreign notify is chained (both tools run), never dropped — and
  // uninstall hands the slot back to the original owner verbatim.
  // Basic-string quoting with backslashes is the real TokenTracker-on-Windows shape.
  fs.writeFileSync(toml, 'notify = ["E:\\\\tt\\\\node.exe", "C:\\\\Users\\\\x\\\\notify.cjs"]\n')
  runHooks("install", home)
  const chained = fs.readFileSync(toml, "utf8")
  assert.ok(chained.includes("notify-chain") && chained.includes("--then"), "chain installed")
  assert.ok(chained.includes("node.exe") && chained.includes("notify.cjs"), "foreign command preserved in chain")
  runHooks("install", home)
  assert.equal(fs.readFileSync(toml, "utf8"), chained, "chaining is idempotent")

  runHooks("uninstall", home)
  const restored = fs.readFileSync(toml, "utf8")
  assert.ok(!restored.includes("usageplane"), "our part removed")
  assert.ok(/notify = \['E:\\tt\\node\.exe', 'C:\\Users\\x\\notify\.cjs'\]/.test(restored), "foreign notify restored with unescaped paths")
})

test("hooks: parseTomlNotifyArray handles both TOML quote styles", async () => {
  const { parseTomlNotifyArray } = await import("../src/commands/hooks.js")
  assert.deepEqual(
    parseTomlNotifyArray('notify = ["E:\\\\tt\\\\node.exe", \'C:\\Users\\x\\n.cjs\']'),
    ["E:\\tt\\node.exe", "C:\\Users\\x\\n.cjs"],
  )
})

test("hooks: install is idempotent, uninstall preserves foreign hooks", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-hooks-"))
  const file = path.join(home, ".claude", "settings.json")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "other-tool run" }] }] } }))

  runHooks("install", home)
  runHooks("install", home)
  const after = JSON.parse(fs.readFileSync(file, "utf8"))
  assert.equal(after.hooks.Stop.length, 2, "one foreign + one ours, no duplicates")
  assert.ok(JSON.stringify(after.hooks.Stop[1]).includes("usageplane"))

  runHooks("uninstall", home)
  const cleaned = JSON.parse(fs.readFileSync(file, "utf8"))
  assert.equal(cleaned.hooks.Stop.length, 1)
  assert.ok(JSON.stringify(cleaned.hooks.Stop[0]).includes("other-tool"))
})

test("pricing: current Claude 5.x ids resolve to their own list prices (not an older tier)", () => {
  // Opus 5.5 used to fall through to the claude-opus-5 fuzzy rule ($5/$25).
  assert.deepEqual(getModelPricing("claude-opus-5-5"), { input: 4, output: 20, cache_read: 0.2, cache_write: 5 })
  assert.equal(getModelPricing("claude-fable-5-2").input, 8)
  assert.equal(getModelPricing("claude-fable-5-1").cache_read, 0.25)
  assert.equal(getModelPricing("claude-haiku-5-5").output, 0.5)
})

test("pricing: bundled LiteLLM seed prices models the curated table never carries", () => {
  // Dated Claude ids, older GPT ids and Gemini all come from the seed.
  assert.equal(getModelPricing("claude-haiku-4-5-20251001").input, 1)
  assert.equal(getModelPricing("claude-opus-4-6").output, 25)
  assert.equal(getModelPricing("gpt-5.4").input, 2.5)
  assert.deepEqual(getModelPricing("gemini-2.5-pro"), { input: 1.25, output: 10, cache_read: 0.125, cache_write: 0 })
  // provider-prefixed ids resolve via the LiteLLM lookup chain
  assert.equal(getModelPricing("models/gemini-2.5-pro").input, 1.25)
})

test("pricing: curated Gemini entries win over LiteLLM substring fallbacks", () => {
  // Without the curated entry, reverse-substring would price flash-lite as flash ($1.50/$9).
  assert.equal(getModelPricing("gemini-3.5-flash-lite").input, 0.3)
  assert.equal(getModelPricing("gemini-4-neon").output, 15)
  assert.equal(getModelPricing("gemini-3.8-flash").cache_read, 0.075)
})

test("pricing: GPT-6 family and Codex effort suffixes", () => {
  assert.deepEqual(getModelPricing("gpt-6-astra"), { input: 10, output: 50, cache_read: 1, cache_write: 10 })
  assert.equal(getModelPricing("gpt-6.1-sol").cache_read, 0.1)
  assert.equal(getModelPricing("gpt-6-sol").cache_read, 0.2)
  assert.deepEqual(getModelPricing("gpt-6-astrahigh"), getModelPricing("gpt-6-astra"))
  assert.deepEqual(getModelPricing("gpt-5.6-solhigh"), getModelPricing("gpt-5.6-sol"))
})

test("pricing: placeholder model names never pick up a price by substring", () => {
  for (const m of ["unknown", "<synthetic>", "", "totally-unknown-model"]) {
    assert.deepEqual(getModelPricing(m), { input: 0, output: 0, cache_read: 0, cache_write: 0 }, m)
  }
})

test("pricing: claude-code display-style ids normalize for lookup only", () => {
  assert.deepEqual(getModelPricing("claude-opus-4.8", "claude-code"), getModelPricing("claude-opus-4-8"))
  assert.deepEqual(getModelPricing("anthropic/claude-4.6-opus", "claude-code"), getModelPricing("claude-opus-4-6"))
})
