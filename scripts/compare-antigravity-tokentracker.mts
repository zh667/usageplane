// Antigravity parity acceptance. Run ON THE MACHINE WITH ANTIGRAVITY DATA:
//   npx tsx scripts/compare-antigravity-tokentracker.mts <path-to-TokenTracker-clone>
//
// Runs TokenTracker's own parser (rollout.js listAntigravityTranscripts +
// parseAntigravityIncremental, fresh cursors, queue in a temp dir) and our
// collector over the same live files, then diffs the five raw token columns
// globally and per model. Expected, documented divergence: upstream bills a
// chars/4 ESTIMATE for turns without db usage; we use the transcript's own
// token fields (or skip). Those turns are counted and printed so any residual
// diff is explained rather than waved away. Read-only on Antigravity's data.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import {
  collectAntigravity,
  listAntigravityTranscripts,
  readAntigravityConversationDb,
  resolveAntigravityDbPath,
  resolveGeminiHome,
} from "../src/collectors/antigravity.js"

const ttRoot = process.argv[2]
if (!ttRoot || !fs.existsSync(path.join(ttRoot, "src", "lib", "rollout.js"))) {
  console.error("usage: npx tsx scripts/compare-antigravity-tokentracker.mts <TokenTracker clone>")
  process.exit(2)
}
const require = createRequire(import.meta.url)
const tt = require(path.join(ttRoot, "src", "lib", "rollout.js"))

const COLS = ["input_tokens", "output_tokens", "cached_input_tokens", "cache_creation_input_tokens", "reasoning_output_tokens"] as const
type Sums = Record<(typeof COLS)[number], number>
const zero = (): Sums => Object.fromEntries(COLS.map((c) => [c, 0])) as Sums
const add = (m: Map<string, Sums>, model: string, row: Record<string, unknown>) => {
  const s = m.get(model) ?? zero()
  m.set(model, s)
  for (const c of COLS) s[c] += Number(row[c] ?? 0)
}

const home = resolveGeminiHome()

// --- upstream ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "up-ag-parity-"))
const queuePath = path.join(tmp, "queue.jsonl")
const ttFiles: string[] = await tt.listAntigravityTranscripts(home)
await tt.parseAntigravityIncremental({ sessionFiles: ttFiles, cursors: {}, queuePath, source: "antigravity" })
const latest = new Map<string, Record<string, unknown>>()
if (fs.existsSync(queuePath)) {
  for (const line of fs.readFileSync(queuePath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue
    const e = JSON.parse(line)
    latest.set(`${e.model}|${e.hour_start}`, e)
  }
}
const upstream = new Map<string, Sums>()
for (const [k, e] of latest) add(upstream, k.split("|")[0], e)
fs.rmSync(tmp, { recursive: true, force: true })

// --- ours ---
const ours = new Map<string, Sums>()
for (const r of await collectAntigravity({ deviceId: "acceptance" })) add(ours, r.model, r as unknown as Record<string, unknown>)

// --- turns without db usage (where the documented divergence lives) ---
let planners = 0
let withoutDb = 0
for (const t of listAntigravityTranscripts(home)) {
  const db = resolveAntigravityDbPath(t)
  const steps = db ? readAntigravityConversationDb(db) : null
  for (const line of fs.readFileSync(t, "utf8").split(/\r?\n/)) {
    try {
      const ev = JSON.parse(line)
      if (ev?.type !== "PLANNER_RESPONSE" || !ev.created_at) continue
      planners++
      if (!steps?.get(ev.step_index)) withoutDb++
    } catch {
      /* partial line */
    }
  }
}

console.log(`transcripts: upstream ${ttFiles.length}, ours ${listAntigravityTranscripts(home).length}`)
console.log(`planner turns: ${planners}, without db usage: ${withoutDb}`)
const models = [...new Set([...upstream.keys(), ...ours.keys()])].sort()
const total = (m: Map<string, Sums>) => {
  const s = zero()
  for (const v of m.values()) for (const c of COLS) s[c] += v[c]
  return s
}
let exact = true
for (const [label, u, o] of [["TOTAL", total(upstream), total(ours)] as const, ...models.map((m) => [m, upstream.get(m) ?? zero(), ours.get(m) ?? zero()] as const)]) {
  const diffs = COLS.filter((c) => u[c] !== o[c]).map((c) => `${c} upstream=${u[c]} ours=${o[c]} diff=${o[c] - u[c]}`)
  if (diffs.length) exact = false
  console.log(`${label}: ${diffs.length ? diffs.join("; ") : "all columns equal " + JSON.stringify(o)}`)
}
console.log(exact ? "PARITY: exact" : "PARITY: differences above (check they are only the no-db turns)")
