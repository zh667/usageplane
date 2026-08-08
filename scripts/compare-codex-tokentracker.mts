// Codex parity acceptance (v0.2 pending item). Run ON THE MACHINE WITH CODEX
// LOGS (Windows):  npx tsx scripts/compare-codex-tokentracker.mts
//
// Reference = the machine's own TokenTracker production ledger
// (~/.tokentracker/tracker/queue.jsonl): codex rows, latest entry per
// (source, model, hour_start) — exactly how TT's readers consume it. This
// avoids guessing TT's internal API and compares against what TT actually
// displays. The five RAW token columns must match exactly, global and per
// model. total_tokens is derived, and TT's historical ledger contains stored
// totals that disagree with its own splits (drift from older TT versions) —
// so totals are recomputed from splits on both sides with the shared formula
// (input + cached + cache_creation + output; reasoning folds into output)
// instead of trusting TT's stored column. Conversation counts may differ
// (TT's codex conv semantics fold differently).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { collectCodex } from "../src/collectors/codex.js"

const TOKEN_COLS = [
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "reasoning_output_tokens",
] as const

const derivedTotal = (s: Sums): number =>
  s.input_tokens + s.cached_input_tokens + s.cache_creation_input_tokens + s.output_tokens

type Sums = Record<(typeof TOKEN_COLS)[number], number>
const zero = (): Sums => Object.fromEntries(TOKEN_COLS.map((c) => [c, 0])) as Sums

// --- TokenTracker ledger: latest row per (model, hour_start) wins ---
const queuePath = path.join(os.homedir(), ".tokentracker", "tracker", "queue.jsonl")
if (!fs.existsSync(queuePath)) {
  console.error(`TokenTracker queue not found at ${queuePath} — is TT installed and synced on this machine?`)
  process.exit(2)
}
const latest = new Map<string, Record<string, number>>()
for (const line of fs.readFileSync(queuePath, "utf8").split("\n")) {
  if (!line.trim()) continue
  let e: { source?: string; model?: string; hour_start?: string }
  try {
    e = JSON.parse(line)
  } catch {
    continue
  }
  if (e.source !== "codex") continue
  latest.set(`${e.model}|${e.hour_start}`, e as unknown as Record<string, number>)
}

const ttTotals = zero()
const ttPerModel = new Map<string, Sums>()
let ttStoredTotal = 0
for (const [key, e] of latest) {
  const model = key.split("|")[0]
  const m = ttPerModel.get(model) ?? zero()
  ttPerModel.set(model, m)
  ttStoredTotal += Number(e.total_tokens ?? 0)
  for (const c of TOKEN_COLS) {
    const v = Number(e[c] ?? 0)
    ttTotals[c] += v
    m[c] += v
  }
}

// --- our collector over the same local logs ---
const records = await collectCodex({ deviceId: "acceptance" })
const upTotals = zero()
const upPerModel = new Map<string, Sums>()
let upStoredTotal = 0
for (const r of records) {
  const m = upPerModel.get(r.model) ?? zero()
  upPerModel.set(r.model, m)
  upStoredTotal += r.total_tokens
  for (const c of TOKEN_COLS) {
    upTotals[c] += r[c]
    m[c] += r[c]
  }
}

console.log(`TT codex buckets: ${latest.size}, our buckets: ${records.length}\n`)
let failed = false
console.log("column                          TokenTracker      UsagePlane      diff")
for (const c of TOKEN_COLS) {
  const diff = upTotals[c] - ttTotals[c]
  if (diff !== 0) failed = true
  console.log(`${c.padEnd(30)} ${String(ttTotals[c]).padStart(13)} ${String(upTotals[c]).padStart(15)} ${String(diff).padStart(9)}`)
}
// Derived totals: recomputed from splits with the shared formula on both sides.
const ttDerived = derivedTotal(ttTotals)
const totalDiff = upStoredTotal - ttDerived
if (totalDiff !== 0) failed = true
console.log(`${"total_tokens (derived)".padEnd(30)} ${String(ttDerived).padStart(13)} ${String(upStoredTotal).padStart(15)} ${String(totalDiff).padStart(9)}`)
if (ttStoredTotal !== ttDerived) {
  console.log(
    `\nnote: TT's STORED total_tokens (${ttStoredTotal}) differs from its own splits by ${ttStoredTotal - ttDerived}` +
      ` — historical drift inside TT's ledger, not a parity signal; ignored.`,
  )
}
for (const model of [...new Set([...ttPerModel.keys(), ...upPerModel.keys()])].sort()) {
  const t = ttPerModel.get(model) ?? zero()
  const u = upPerModel.get(model) ?? zero()
  for (const c of TOKEN_COLS) {
    if (t[c] !== u[c]) {
      failed = true
      console.log(`MODEL MISMATCH ${model}.${c}: TT=${t[c]} UP=${u[c]}`)
    }
  }
}
console.log(failed ? "\n❌ MISMATCH" : "\n✅ PASS — raw token columns exact (global + per model); totals consistent by formula")
process.exitCode = failed ? 1 : 0
