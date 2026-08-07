// Ported from TokenTracker src/lib/rollout.js (MIT) — parseClaudeFile,
// claudeMessageDedupKey, normalizeClaudeUsage, toUtcHalfHourStart,
// resolveClaudeFileCwd, conversation counting.
// Deliberate simplifications vs upstream:
//  - Full re-parse per sync instead of cursor/offset incremental state: our
//    SQLite upsert is last-write-wins per bucket, so re-parsing is idempotent
//    and the cross-file message-hash dedup needs no persistence.
//  - No WSL/UNC dual-path file dedup (Linux/macOS first).
//  - Project attribution = basename of the session's cwd (upstream resolves
//    git repo roots; refine when project views need it).
//  - Conversations stay under model "unknown": user messages carry no model
//    field. Upstream folds them into the hour's dominant model at enqueue
//    time — that's a guess, and our convention is to never guess attribution.
//    Token columns still match upstream exactly (scripts/compare-claude-tokentracker.mts).

import fssync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import readline from "node:readline"
import type { UsageRecord } from "../core/types.js"

const DEFAULT_MODEL = "unknown"
const CWD_SCAN_MAX_BYTES = 256 * 1024

export interface ClaudeCollectorOptions {
  deviceId: string
  /** Claude Code home, default ~/.claude */
  claudeHome?: string
}

interface Totals {
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  cache_creation_input_tokens: number
  reasoning_output_tokens: number
  total_tokens: number
  conversation_count: number
}

/** Parse all Claude Code session logs into hourly-bucket usage records. */
export async function collectClaudeCode(opts: ClaudeCollectorOptions): Promise<UsageRecord[]> {
  const home = opts.claudeHome ?? path.join(os.homedir(), ".claude")
  const files = await listClaudeSessionFiles(path.join(home, "projects"))

  // Buckets keyed by project|model|bucket_start. Message hashes are shared
  // across files so a subagent transcript created after the main session
  // cannot double count (upstream: cursors.claudeHashes).
  const buckets = new Map<string, { project: string; model: string; hour_start: string; totals: Totals }>()
  const seenMessageHashes = new Set<string>()

  for (const filePath of files) {
    const cwd = await resolveClaudeFileCwd(filePath)
    const project = cwd ? path.basename(cwd) : ""
    await parseClaudeFile({ filePath, project, buckets, seenMessageHashes })
  }

  const records: UsageRecord[] = []
  for (const b of buckets.values()) {
    records.push({
      device_id: opts.deviceId,
      tool: "claude-code",
      project: b.project,
      source_kind: "unknown",
      model: b.model,
      hour_start: b.hour_start,
      ...b.totals,
    })
  }
  return records
}

/** Recursively list *.jsonl under ~/.claude/projects, sorted for determinism. */
export async function listClaudeSessionFiles(projectsDir: string): Promise<string[]> {
  const out: string[] = []
  await walk(projectsDir, out)
  out.sort((a, b) => a.localeCompare(b))
  return out
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full)
  }
}

async function parseClaudeFile({
  filePath,
  project,
  buckets,
  seenMessageHashes,
}: {
  filePath: string
  project: string
  buckets: Map<string, { project: string; model: string; hour_start: string; totals: Totals }>
  seenMessageHashes: Set<string>
}): Promise<void> {
  const stream = fssync.createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  // Separator-agnostic so a future Windows port doesn't misclassify
  // subagent transcripts as main sessions (upstream #307).
  const isMainSession = !/[\\/]subagents[\\/]/.test(filePath)

  for await (const line of rl) {
    if (!line) continue

    // Count user-typed messages as conversations (main sessions only).
    // tool_result messages are auto-generated, not typed — only count
    // messages with a "text" block. Dedup by line uuid: user lines have
    // no message.id, so the uuid is their identity.
    if (isMainSession && line.includes('"type":"user"')) {
      const userObj = tryParse(line)
      if (userObj?.type === "user") {
        const content = (userObj as { message?: { content?: unknown } }).message?.content
        const hasText =
          typeof content === "string" ||
          (Array.isArray(content) && content.some((b) => (b as { type?: string })?.type === "text"))
        if (hasText) {
          const uuid = (userObj as { uuid?: unknown }).uuid
          const userKey = typeof uuid === "string" && uuid ? `u:${uuid}` : null
          if (!userKey || !seenMessageHashes.has(userKey)) {
            if (userKey) seenMessageHashes.add(userKey)
            const ts = (userObj as { timestamp?: unknown }).timestamp
            const bucketStart = typeof ts === "string" ? toUtcHalfHourStart(ts) : null
            if (bucketStart) {
              getBucket(buckets, project, DEFAULT_MODEL, bucketStart).totals.conversation_count += 1
            }
          }
        }
      }
    }

    if (!line.includes('"usage"')) continue
    const obj = tryParse(line)
    if (!obj) continue

    const usage = (obj as { message?: { usage?: unknown } }).message?.usage ?? (obj as { usage?: unknown }).usage
    if (!usage || typeof usage !== "object") continue

    // Dedup: message.id (+ requestId when present). A bare msgId-only check
    // must NOT require requestId — sub-agent rows have none and would fail
    // open, over-counting 1.6–3.7× (upstream lesson).
    const dedupHash = claudeMessageDedupKey(obj)
    if (dedupHash && seenMessageHashes.has(dedupHash)) continue

    const rawModel =
      (obj as { message?: { model?: unknown } }).message?.model ?? (obj as { model?: unknown }).model
    const model = normalizeModelInput(rawModel) ?? DEFAULT_MODEL
    const ts = (obj as { timestamp?: unknown }).timestamp
    if (typeof ts !== "string") continue

    const delta = normalizeClaudeUsage(usage as Record<string, unknown>)
    if (isAllZeroUsage(delta)) continue

    if (dedupHash) seenMessageHashes.add(dedupHash)

    const bucketStart = toUtcHalfHourStart(ts)
    if (!bucketStart) continue

    const totals = getBucket(buckets, project, model, bucketStart).totals
    totals.input_tokens += delta.input_tokens
    totals.output_tokens += delta.output_tokens
    totals.cached_input_tokens += delta.cached_input_tokens
    totals.cache_creation_input_tokens += delta.cache_creation_input_tokens
    totals.reasoning_output_tokens += delta.reasoning_output_tokens
    totals.total_tokens += delta.total_tokens
  }

  rl.close()
  stream.close?.()
}

function getBucket(
  buckets: Map<string, { project: string; model: string; hour_start: string; totals: Totals }>,
  project: string,
  model: string,
  hourStart: string,
) {
  const key = `${project}|${model}|${hourStart}`
  let b = buckets.get(key)
  if (!b) {
    b = {
      project,
      model,
      hour_start: hourStart,
      totals: {
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
        conversation_count: 0,
      },
    }
    buckets.set(key, b)
  }
  return b
}

export function claudeMessageDedupKey(obj: unknown): string | null {
  const o = obj as { message?: { id?: unknown }; requestId?: unknown }
  const msgId = typeof o?.message?.id === "string" && o.message.id ? o.message.id : null
  if (!msgId) return null
  const reqId = typeof o?.requestId === "string" && o.requestId ? o.requestId : null
  return reqId ? `${msgId}:${reqId}` : msgId
}

/**
 * Claude usage rows report input_tokens EXCLUDING cache reads/writes —
 * safe to map 1:1 onto our columns (unlike Codex, whose input includes cache).
 */
export function normalizeClaudeUsage(u: Record<string, unknown>) {
  const inputTokens = toNonNegativeInt(u.input_tokens)
  const outputTokens = toNonNegativeInt(u.output_tokens)
  const cacheCreation = toNonNegativeInt(u.cache_creation_input_tokens)
  const cacheRead = toNonNegativeInt(u.cache_read_input_tokens)
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreation,
    output_tokens: outputTokens,
    reasoning_output_tokens: 0,
    total_tokens: inputTokens + outputTokens + cacheCreation + cacheRead,
  }
}

function isAllZeroUsage(u: ReturnType<typeof normalizeClaudeUsage>): boolean {
  return (
    u.input_tokens === 0 &&
    u.output_tokens === 0 &&
    u.cached_input_tokens === 0 &&
    u.cache_creation_input_tokens === 0 &&
    u.reasoning_output_tokens === 0 &&
    u.total_tokens === 0
  )
}

/** UTC half-hour bucket start as ISO string, or null for unparseable input. */
export function toUtcHalfHourStart(ts: string): string | null {
  const dt = new Date(ts)
  if (!Number.isFinite(dt.getTime())) return null
  const halfMinute = dt.getUTCMinutes() >= 30 ? 30 : 0
  return new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), dt.getUTCHours(), halfMinute, 0, 0),
  ).toISOString()
}

/** A session file's launch cwd is fixed for its lifetime; scan the head only. */
export async function resolveClaudeFileCwd(filePath: string): Promise<string | null> {
  const stream = fssync.createReadStream(filePath, {
    encoding: "utf8",
    start: 0,
    end: CWD_SCAN_MAX_BYTES,
  })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (!line || !line.includes('"cwd"')) continue
      const obj = tryParse(line)
      const cwd = (obj as { cwd?: unknown })?.cwd
      if (typeof cwd === "string" && cwd.trim()) return cwd.trim()
    }
  } finally {
    rl.close()
    stream.close?.()
  }
  return null
}

function normalizeModelInput(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toNonNegativeInt(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function tryParse(line: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(line)
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
