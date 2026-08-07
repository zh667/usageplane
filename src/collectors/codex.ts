// Ported from TokenTracker (MIT):
//   src/lib/rollout.js — parseRolloutFile event loop, forked-replay guards,
//     codexSessionIdFromPath, cross-rewrite event dedup (issue #187)
//   src/lib/codex-rollout-parser.js — normalizeUsage (cached-input subtraction),
//     extractTokenCount
// Deliberate simplifications vs upstream (same rationale as claude-code.ts):
//  - Full re-parse per sync; no cursor/offset/baseline persistence. The delta
//    state machine runs fresh per file, and cross-file event dedup uses an
//    in-run Set keyed sessionId:timestamp — covers session files that were
//    atomically rewritten or moved to archived_sessions/.
//  - readline line parsing instead of byte-exact physicalJsonlRecords (no
//    resume offsets to commit; a partial trailing line fails JSON.parse and
//    is skipped this run, picked up complete next run).
//  - Project attribution = basename of the event-time cwd.
//
// THE token trap (upstream lesson, cost 6-7× inflation when missed):
// Codex `input_tokens` INCLUDES cached tokens — normalizeCodexUsage subtracts
// cached_input_tokens out so our schema's non-cached input stays honest.

import fssync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import readline from "node:readline"
import type { UsageRecord } from "../core/types.js"
import { consumeUsageDelta, createUsageDeltaState, type Usage } from "./codex-token-usage.js"

const DEFAULT_MODEL = "unknown"
const CODEX_FORK_REPLAY_GAP_MS = 500

export interface CodexCollectorOptions {
  deviceId: string
  /** Codex home, default ~/.codex */
  codexHome?: string
}

interface Bucket {
  project: string
  model: string
  hour_start: string
  totals: Usage & { conversation_count: number }
}

/** Parse all Codex rollout logs into half-hour-bucket usage records. */
export async function collectCodex(opts: CodexCollectorOptions): Promise<UsageRecord[]> {
  const home = opts.codexHome ?? path.join(os.homedir(), ".codex")
  const files = [
    ...(await listRolloutFiles(path.join(home, "sessions"))),
    ...(await listRolloutFiles(path.join(home, "archived_sessions"))),
  ].sort((a, b) => a.localeCompare(b))

  const buckets = new Map<string, Bucket>()
  // Same session can exist twice (rewritten inode, sessions/ → archived_sessions/
  // move); key sessionId:timestamp is stable across both (upstream issue #187).
  const seenEvents = new Set<string>()

  for (const filePath of files) {
    await parseRolloutFile({ filePath, buckets, seenEvents })
  }

  const records: UsageRecord[] = []
  for (const b of buckets.values()) {
    records.push({
      device_id: opts.deviceId,
      tool: "codex",
      project: b.project,
      source_kind: "unknown",
      model: b.model,
      hour_start: b.hour_start,
      input_tokens: b.totals.input_tokens,
      output_tokens: b.totals.output_tokens,
      cached_input_tokens: b.totals.cached_input_tokens,
      cache_creation_input_tokens: b.totals.cache_creation_input_tokens,
      reasoning_output_tokens: b.totals.reasoning_output_tokens,
      total_tokens: b.totals.total_tokens,
      conversation_count: b.totals.conversation_count,
    })
  }
  return records
}

/** Recursively list rollout-*.jsonl (sessions are nested year/month/day). */
export async function listRolloutFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  await walk(dir, out)
  return out
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) out.push(full)
  }
}

export function codexSessionIdFromPath(filePath: string): string | null {
  const m = filePath.match(
    /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/,
  )
  return m ? m[1] : null
}

function rolloutDateFromPath(filePath: string): string | null {
  const m = path.basename(filePath).match(/^rollout-(\d{4}-\d{2}-\d{2})T/)
  return m ? m[1] : null
}

async function parseRolloutFile({
  filePath,
  buckets,
  seenEvents,
}: {
  filePath: string
  buckets: Map<string, Bucket>
  seenEvents: Set<string>
}): Promise<void> {
  const stream = fssync.createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  const sessionId = codexSessionIdFromPath(filePath)
  const rolloutDate = rolloutDateFromPath(filePath)
  const deltaState = createUsageDeltaState()
  let model: string = DEFAULT_MODEL
  let project = ""
  let currentDate: string | null = null
  let isForkedRollout = false
  // Forked rollouts replay the parent's whole token history in one flush at
  // the head of the file; rows are ms-apart while genuine turns are seconds
  // apart. Skip the leading dense run, latch off at the first ≥500ms gap.
  let replayPrefixActive = true
  let prevForkedTokenMs: number | null = null

  for await (const line of rl) {
    if (!line) continue
    const maybeTokenCount = line.includes('"token_count"')
    const maybeContext =
      !maybeTokenCount &&
      (line.includes('"turn_context"') || line.includes('"session_meta"'))
    if (!maybeTokenCount && !maybeContext) continue

    let obj: Record<string, unknown>
    try {
      const v: unknown = JSON.parse(line)
      if (!v || typeof v !== "object") continue
      obj = v as Record<string, unknown>
    } catch {
      continue
    }

    if ((obj.type === "turn_context" || obj.type === "session_meta") && obj.payload && typeof obj.payload === "object") {
      const payload = obj.payload as Record<string, unknown>
      if (obj.type === "session_meta" && typeof payload.forked_from_id === "string") {
        isForkedRollout = payload.forked_from_id.trim().length > 0
      }
      if (obj.type === "turn_context" && typeof payload.current_date === "string") {
        currentDate = payload.current_date.slice(0, 10)
      }
      if (typeof payload.model === "string" && payload.model.trim()) {
        model = payload.model.trim()
      }
      if (typeof payload.cwd === "string" && payload.cwd.trim()) {
        project = path.basename(payload.cwd.trim())
      }
      continue
    }

    const token = extractTokenCount(obj)
    if (!token || !token.info) continue
    const tokenTimestamp = token.timestamp
    if (!tokenTimestamp) continue

    const info = token.info as Record<string, unknown>
    const rawDelta = consumeUsageDelta(deltaState, info.last_token_usage, info.total_token_usage)
    const delta = rawDelta ? normalizeCodexUsage(rawDelta) : null
    if (!delta || isAllZero(delta)) continue

    // Forked-replay burst detection (upstream issue #169): fail open on
    // unparseable timestamps or backwards clock steps.
    let forkedReplaySkip = false
    if (isForkedRollout && replayPrefixActive) {
      const tokenMs = Date.parse(tokenTimestamp)
      if (!Number.isFinite(tokenMs) || (prevForkedTokenMs !== null && tokenMs < prevForkedTokenMs)) {
        replayPrefixActive = false
      } else {
        if (prevForkedTokenMs !== null && tokenMs - prevForkedTokenMs >= CODEX_FORK_REPLAY_GAP_MS) {
          replayPrefixActive = false
        }
        forkedReplaySkip =
          replayPrefixActive &&
          prevForkedTokenMs !== null &&
          tokenMs - prevForkedTokenMs < CODEX_FORK_REPLAY_GAP_MS
        prevForkedTokenMs = tokenMs
      }
    }
    // Cross-day fork replays: rows dated before the rollout file's own date.
    if (forkedReplaySkip || (isForkedRollout && rolloutDate && currentDate && currentDate < rolloutDate)) {
      continue
    }

    const bucketStart = toUtcHalfHourStart(tokenTimestamp)
    if (!bucketStart) continue

    const dedupKey = `${sessionId || filePath}:${tokenTimestamp}`
    if (seenEvents.has(dedupKey)) continue
    seenEvents.add(dedupKey)

    const totals = getBucket(buckets, project, model, bucketStart).totals
    totals.input_tokens += delta.input_tokens
    totals.output_tokens += delta.output_tokens
    totals.cached_input_tokens += delta.cached_input_tokens
    totals.cache_creation_input_tokens += delta.cache_creation_input_tokens
    totals.reasoning_output_tokens += delta.reasoning_output_tokens
    totals.total_tokens += delta.total_tokens
    totals.conversation_count += 1
  }

  rl.close()
  stream.close?.()
}

function extractTokenCount(obj: Record<string, unknown>): { info: unknown; timestamp: string | null } | null {
  if (obj.type !== "event_msg") return null
  const payload = obj.payload as Record<string, unknown> | undefined
  if (!payload) return null
  const timestamp = typeof obj.timestamp === "string" ? obj.timestamp : null
  if (payload.type === "token_count") return { info: payload.info ?? null, timestamp }
  const msg = payload.msg as Record<string, unknown> | undefined
  if (msg && msg.type === "token_count") return { info: msg.info ?? null, timestamp }
  return null
}

/**
 * Codex reports `input_tokens` INCLUSIVE of cached tokens; subtract cache
 * reads so our non-cached input column stays honest, and recompute total
 * as the sum of the split columns (reasoning folds into output for cost,
 * so total excludes it — matching upstream's codex normalizeUsage).
 */
export function normalizeCodexUsage(u: Usage): Usage {
  const out: Usage = { ...u }
  out.input_tokens = Math.max(0, out.input_tokens - out.cached_input_tokens)
  out.total_tokens =
    out.input_tokens + out.cached_input_tokens + out.cache_creation_input_tokens + out.output_tokens
  return out
}

function isAllZero(u: Usage): boolean {
  return (
    u.input_tokens === 0 &&
    u.output_tokens === 0 &&
    u.cached_input_tokens === 0 &&
    u.cache_creation_input_tokens === 0 &&
    u.reasoning_output_tokens === 0 &&
    u.total_tokens === 0
  )
}

function toUtcHalfHourStart(ts: string): string | null {
  const dt = new Date(ts)
  if (!Number.isFinite(dt.getTime())) return null
  const halfMinute = dt.getUTCMinutes() >= 30 ? 30 : 0
  return new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), dt.getUTCHours(), halfMinute, 0, 0),
  ).toISOString()
}

function getBucket(buckets: Map<string, Bucket>, project: string, model: string, hourStart: string): Bucket {
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
