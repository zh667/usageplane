// Antigravity (Google's agentic IDE) usage collector.
//
// Ported from TokenTracker src/lib/rollout.js (MIT) — resolveAntigravityBrainDirs,
// listAntigravitySessionFiles, resolveAntigravityDbPath,
// readAntigravityConversationDb, extractAntigravityGenInfo,
// findAntigravityProtoFields, normalizeAntigravityTranscriptModel,
// parseAntigravityModelSelection, readAntigravityDefaultModel, and the
// PLANNER_RESPONSE billing branch of parseAntigravityFile (upstream 5c9f575b).
//
// Data contract (verified 2026-11-23 on a live Windows install, 750 turns):
//  - <GEMINI_HOME>/<variant>/brain/<conversation>/.system_generated/logs/transcript.jsonl
//    is one JSON event per line. PLANNER_RESPONSE events are model calls and
//    carry `step_index` + `created_at` (the bucket timestamp).
//  - <GEMINI_HOME>/<variant>/conversations/<conversation>.db (SQLite, WAL) has
//    table gen_metadata: one protobuf blob per model call. Field 1 → inner;
//    inner.20 is a {1:key,2:value} list holding "last_step_index"; the
//    planner it bills has step_index = last_step_index + 1. inner.4 is usage:
//      4.1 system/tool prefix tokens   4.2 prompt tokens   4.5 cache read
//      4.3 total output (= 4.9 text + 4.10 reasoning)
//    inner.19 = model name ("gemini-4-carbon").
//  - Newer transcripts ALSO carry input_tokens / cache_read_tokens /
//    output_tokens on PLANNER_RESPONSE. Cross-checked against the db on all
//    750 matched turns: input_tokens == 4.2 only (the 4.1 system prefix is
//    missing — 1427 tokens per call on that install), cache_read_tokens == 4.5,
//    output_tokens == 4.3 (text + reasoning). The db is therefore the primary
//    source, as upstream does; transcript fields are the fallback.
//
// Column mapping (db): input = 4.1 + 4.2 (non-cached), cached_input = 4.5,
// output = 4.9 text (or 4.3 − 4.10 when 4.9 is absent), reasoning = 4.10.
// Reasoning is NOT inside output here, so "antigravity" must stay out of
// pricing.ts REASONING_INCLUDED_IN_OUTPUT (reasoning bills at the output rate).
//
// Deliberate divergences from upstream (same rationale as the other collectors):
//  - Full re-parse per sync; no cursors/baselines. Upserts are idempotent.
//  - No text-length token ESTIMATE when a turn has neither db usage nor
//    transcript usage fields. Upstream falls back to chars/4 (CJK = 1); we
//    skip the turn instead of mixing estimates into measured columns. On the
//    verified install this skipped 2 of 752 turns.
//  - Older conversations without a transcript.jsonl (Antigravity stored those
//    only as conversations/<id>.pb protobuf) are not read — upstream does not
//    read them either.
//  - No WSL/UNC dual-path discovery and no project attribution (transcripts
//    carry no cwd; upstream resolves projects via its git-remote machinery).
//  - Model attribution: db model per call → transcript `model` field →
//    last "Model Selection" change → variant settings.json → "antigravity-unknown".

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import type { UsageRecord } from "../core/types.js"

export interface AntigravityCollectorOptions {
  deviceId: string
  /** Gemini home, default $GEMINI_HOME or ~/.gemini */
  geminiHome?: string
}

/** Variant roots under the Gemini home, in upstream order. */
const VARIANTS = ["antigravity", "antigravity-ide", "antigravity-cli"]

export function resolveGeminiHome(explicit?: string): string {
  if (explicit) return explicit
  return process.env.GEMINI_HOME?.trim() || path.join(os.homedir(), ".gemini")
}

/** Every <variant>/brain/<id>/.system_generated/logs/transcript.jsonl, sorted. */
export function listAntigravityTranscripts(geminiHome: string): string[] {
  const out: string[] = []
  for (const variant of VARIANTS) {
    const brain = path.join(geminiHome, variant, "brain")
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(brain, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      // Only the canonical name: the install also keeps byte-identical
      // transcript_*.jsonl siblings, which would double count.
      const p = path.join(brain, e.name, ".system_generated", "logs", "transcript.jsonl")
      try {
        if (fs.statSync(p).isFile()) out.push(p)
      } catch {
        /* no transcript for this conversation */
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/** transcript path → <variant>/conversations/<id>.db, or null if not shaped like one. */
export function resolveAntigravityDbPath(transcriptPath: string): string | null {
  const m = transcriptPath.match(/^(.*)[/\\]brain[/\\]([^/\\]+)[/\\]\.system_generated[/\\]logs[/\\]transcript.*\.jsonl$/)
  if (!m) return null
  return path.join(m[1], "conversations", `${m[2]}.db`)
}

// ---------------------------------------------------------------------------
// Minimal protobuf wire decoder (upstream findAntigravityProtoFields).

type ProtoVal = number | Buffer
interface ProtoField {
  num: number
  val: ProtoVal
}

function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0
  let mul = 1
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) throw new Error("truncated varint")
    const b = buf[pos++]
    result += (b & 0x7f) * mul
    if (b < 0x80) return [result, pos]
    mul *= 128
  }
  throw new Error("varint too long")
}

export function protoFields(buf: Buffer): ProtoField[] {
  const out: ProtoField[] = []
  let pos = 0
  while (pos < buf.length) {
    let key: number
    ;[key, pos] = readVarint(buf, pos)
    const num = Math.floor(key / 8)
    const wt = key % 8
    if (wt === 0) {
      let v: number
      ;[v, pos] = readVarint(buf, pos)
      out.push({ num, val: v })
    } else if (wt === 2) {
      let n: number
      ;[n, pos] = readVarint(buf, pos)
      if (pos + n > buf.length) throw new Error("truncated field")
      out.push({ num, val: buf.subarray(pos, pos + n) })
      pos += n
    } else if (wt === 1) {
      pos += 8
    } else if (wt === 5) {
      pos += 4
    } else {
      throw new Error(`unsupported wire type ${wt}`)
    }
  }
  return out
}

const field = (fs: ProtoField[], n: number) => fs.find((f) => f.num === n)?.val
const asInt = (v: ProtoVal | undefined) => (typeof v === "number" && Number.isSafeInteger(v) ? v : undefined)
const asBuf = (v: ProtoVal | undefined) => (Buffer.isBuffer(v) ? v : undefined)

export interface GenInfo {
  model: string | null
  lastStepIndex: number | null
  hasUsage: boolean
  uncachedInput: number
  cachedInput: number
  textOutput: number
  reasoningOutput: number
  outputTokens: number
}

/** Decode one gen_metadata blob. null on any decode failure. */
export function extractAntigravityGenInfo(blob: Buffer): GenInfo | null {
  try {
    const f1 = asBuf(field(protoFields(blob), 1))
    if (!f1) return null
    const inner = protoFields(f1)
    const f19 = asBuf(field(inner, 19))
    const model = f19 ? f19.toString("utf8").trim() || null : null

    let lastStepIndex: number | null = null
    for (const f of inner) {
      const v = asBuf(f.val)
      if (f.num !== 20 || !v) continue
      const kv = protoFields(v)
      const k = asBuf(field(kv, 1))
      const val = asBuf(field(kv, 2))
      if (k && k.toString("utf8") === "last_step_index" && val) {
        const raw = val.toString("utf8").trim()
        if (/^\d+$/.test(raw)) lastStepIndex = Number(raw)
      }
    }

    const info: GenInfo = {
      model,
      lastStepIndex,
      hasUsage: false,
      uncachedInput: 0,
      cachedInput: 0,
      textOutput: 0,
      reasoningOutput: 0,
      outputTokens: 0,
    }
    const f4 = asBuf(field(inner, 4))
    if (f4) {
      const u = protoFields(f4)
      const vals = [1, 2, 3, 5, 9, 10].map((n) => asInt(field(u, n)))
      if (vals.some((v) => v !== undefined)) {
        const [sys, prompt, out, cached, text, reason] = vals.map((v) => v ?? 0)
        info.hasUsage = true
        info.uncachedInput = sys + prompt
        info.cachedInput = cached
        info.outputTokens = out
        info.textOutput = text
        info.reasoningOutput = reason
      }
    }
    return info
  } catch {
    return null
  }
}

/**
 * step_index → usage for one conversation. Opens read-only in place (WAL
 * readers coexist with Antigravity's writer); if that fails (locked/odd
 * filesystem) reads a private copy of db + -wal + -shm. null = unreadable.
 */
export function readAntigravityConversationDb(dbPath: string): Map<number, GenInfo> | null {
  if (!fs.existsSync(dbPath)) return null
  const readFrom = (p: string): Map<number, GenInfo> => {
    const db = new Database(p, { readonly: true, fileMustExist: true })
    try {
      const rows = db.prepare("SELECT data FROM gen_metadata ORDER BY idx").all() as { data: unknown }[]
      const map = new Map<number, GenInfo>()
      for (const r of rows) {
        if (!Buffer.isBuffer(r.data)) continue
        const info = extractAntigravityGenInfo(r.data)
        if (info && info.lastStepIndex !== null && info.hasUsage) map.set(info.lastStepIndex + 1, info)
      }
      return map
    } finally {
      db.close()
    }
  }
  try {
    return readFrom(dbPath)
  } catch {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-ag-"))
    try {
      for (const ext of ["", "-wal", "-shm"]) {
        if (fs.existsSync(dbPath + ext)) fs.copyFileSync(dbPath + ext, path.join(tmp, "c.db" + ext))
      }
      return readFrom(path.join(tmp, "c.db"))
    } catch {
      return null
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
}

/** "Gemini 4 Carbon (High)" / "gemini-4-carbon-high" → "gemini-4-carbon". */
export function normalizeAntigravityModel(name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return null
  let slug = name
    .trim()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(thinking|xhigh|high|medium|low|fast)\b/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
  if (!slug) return null
  for (const marker of ["gemini", "claude", "gpt"]) {
    const idx = slug.indexOf(marker)
    if (idx >= 0) {
      slug = slug.slice(idx)
      break
    }
  }
  return /^(gemini|claude|gpt)-/.test(slug) ? slug : `antigravity-${slug}`
}

function modelFromSelection(content: unknown): string | null {
  if (typeof content !== "string") return null
  const m = content.match(/changed setting `Model Selection` from .*? to ([^`\n]+?)(?:\s*\([^)]*\))?\.(?:\s+|$)/i)
  return m ? normalizeAntigravityModel(m[1]) : null
}

/** <variant>/settings.json "model", five directories above the transcript. */
function defaultModelFor(transcriptPath: string): string | null {
  let dir = transcriptPath
  for (let i = 0; i < 5; i++) dir = path.dirname(dir)
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"))
    return normalizeAntigravityModel(s?.model)
  } catch {
    return null
  }
}

export function toUtcHalfHourStart(ts: unknown): string | null {
  if (typeof ts !== "string" && typeof ts !== "number") return null
  const d = new Date(ts)
  if (!Number.isFinite(d.getTime())) return null
  d.setUTCMinutes(d.getUTCMinutes() < 30 ? 0 : 30, 0, 0)
  return d.toISOString()
}

const nn = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export async function collectAntigravity(opts: AntigravityCollectorOptions): Promise<UsageRecord[]> {
  const home = resolveGeminiHome(opts.geminiHome)
  const buckets = new Map<string, UsageRecord>()

  for (const transcript of listAntigravityTranscripts(home)) {
    let raw: string
    try {
      raw = fs.readFileSync(transcript, "utf8")
    } catch {
      continue
    }
    const dbPath = resolveAntigravityDbPath(transcript)
    const steps = dbPath ? readAntigravityConversationDb(dbPath) : null
    let currentModel = defaultModelFor(transcript)

    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(line)
      } catch {
        continue // partial trailing line while Antigravity is writing
      }
      if (!ev || typeof ev !== "object") continue
      if (ev.type === "USER_INPUT" || ev.type === "USER_SETTINGS_CHANGE") {
        currentModel = modelFromSelection(ev.content) ?? currentModel
        continue
      }
      if (ev.type !== "PLANNER_RESPONSE") continue
      const hourStart = toUtcHalfHourStart(ev.created_at)
      if (!hourStart) continue

      const step = typeof ev.step_index === "number" ? steps?.get(ev.step_index) : undefined
      let input = 0
      let cached = 0
      let output = 0
      let reasoning = 0
      if (step) {
        input = step.uncachedInput
        cached = step.cachedInput
        reasoning = step.reasoningOutput
        output = step.textOutput > 0 ? step.textOutput : Math.max(0, step.outputTokens - reasoning)
      } else if ("input_tokens" in ev || "output_tokens" in ev) {
        // Transcript fallback: output_tokens already includes reasoning and the
        // system prefix is absent, so this under-counts input slightly.
        input = nn(ev.input_tokens)
        cached = nn(ev.cache_read_tokens)
        output = nn(ev.output_tokens)
      } else {
        continue // no measured usage for this turn; never estimate
      }
      if (input + cached + output + reasoning === 0) continue

      const model =
        normalizeAntigravityModel(step?.model) ??
        normalizeAntigravityModel(ev.model) ??
        currentModel ??
        "antigravity-unknown"
      const key = `${model}|${hourStart}`
      let rec = buckets.get(key)
      if (!rec) {
        rec = {
          device_id: opts.deviceId,
          tool: "antigravity",
          project: "",
          source_kind: "unknown",
          model,
          hour_start: hourStart,
          input_tokens: 0,
          output_tokens: 0,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 0,
          conversation_count: 0,
        }
        buckets.set(key, rec)
      }
      rec.input_tokens += input
      rec.cached_input_tokens += cached
      rec.output_tokens += output
      rec.reasoning_output_tokens += reasoning
      rec.total_tokens += input + cached + output + reasoning
      rec.conversation_count += 1 // upstream counts one per billed planner call
    }
  }
  return [...buckets.values()]
}
