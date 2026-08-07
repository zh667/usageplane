// M2 acceptance harness: run TokenTracker's original Claude parser and our
// ported collector over the same real ~/.claude logs and diff the results.
// Usage: npx tsx scripts/compare-claude-tokentracker.mts
// Requires the upstream clone at ~/projects/reference/TokenTracker.
//
// Pass criteria:
//  - all token columns exact-match globally AND per model
//  - conversation_count exact-matches globally only. Per-model attribution
//    deliberately diverges: user messages carry no model, TokenTracker guesses
//    the hour's dominant model, we keep them under "unknown" (no guessing —
//    see docs/ROADMAP.md decision log 2026-08-07).
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { collectClaudeCode } from "../src/collectors/claude-code.js"

const require = createRequire(import.meta.url)
const rollout = require(
  path.join(os.homedir(), "projects/reference/TokenTracker/src/lib/rollout.js"),
)

const TOKEN_COLS = [
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "reasoning_output_tokens",
  "total_tokens",
] as const
const COLS = [...TOKEN_COLS, "conversation_count"] as const

type Sums = Record<(typeof COLS)[number], number>
const zero = (): Sums => Object.fromEntries(COLS.map((c) => [c, 0])) as Sums

function addInto(target: Sums, row: Partial<Sums>, perModel: Map<string, Sums>, model: string) {
  const m = perModel.get(model) ?? zero()
  perModel.set(model, m)
  for (const c of COLS) {
    const v = Number(row[c] ?? 0)
    target[c] += v
    m[c] += v
  }
}

// --- TokenTracker original ---
const projectsDir = path.join(os.homedir(), ".claude", "projects")
const files: string[] = await rollout.listClaudeProjectFiles(projectsDir)
const queuePath = path.join(os.tmpdir(), `usageplane-tt-queue-${process.pid}.jsonl`)
fs.rmSync(queuePath, { force: true })

const res = await rollout.parseClaudeIncremental({
  projectFiles: files,
  cursors: {},
  queuePath,
  source: "claude",
})

const ttTotals = zero()
const ttPerModel = new Map<string, Sums>()
for (const line of fs.readFileSync(queuePath, "utf8").split("\n")) {
  if (!line.trim()) continue
  const e = JSON.parse(line)
  addInto(ttTotals, e, ttPerModel, String(e.model ?? "unknown"))
}
fs.rmSync(queuePath, { force: true })

// --- our port ---
const records = await collectClaudeCode({ deviceId: "acceptance" })
const upTotals = zero()
const upPerModel = new Map<string, Sums>()
for (const r of records) addInto(upTotals, r, upPerModel, r.model)

// --- compare ---
console.log(`files: ${files.length}, TokenTracker events: ${res.eventsAggregated}, our buckets: ${records.length}\n`)
let failed = false
console.log("column                          TokenTracker      UsagePlane      diff")
for (const c of COLS) {
  const diff = upTotals[c] - ttTotals[c]
  if (diff !== 0) failed = true
  console.log(`${c.padEnd(30)} ${String(ttTotals[c]).padStart(13)} ${String(upTotals[c]).padStart(15)} ${String(diff).padStart(9)}`)
}

const models = new Set([...ttPerModel.keys(), ...upPerModel.keys()])
for (const model of [...models].sort()) {
  const t = ttPerModel.get(model) ?? zero()
  const u = upPerModel.get(model) ?? zero()
  for (const c of TOKEN_COLS) {
    if (t[c] !== u[c]) {
      failed = true
      console.log(`MODEL MISMATCH ${model}.${c}: TT=${t[c]} UP=${u[c]}`)
    }
  }
}

console.log(failed ? "\n❌ MISMATCH" : "\n✅ PASS — token columns exact (global + per model), conversations exact globally")
process.exitCode = failed ? 1 : 0
