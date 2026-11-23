// DeepSeek Harness (DSH) usage — read from TokenLedger's SQLite rollups.
//
// Source: the sibling project zh667/TokenLedger, which tails DeepSeek Harness
// session logs and materializes per-(session, day, site, provider, model)
// rollups. DSH does NOT write token counts into its own session files
// (verified: all ~/.dsh/sessions/*.zstd hold a header line only), so
// TokenLedger is the only machine-readable usage source on a DSH machine.
// We read it read-only and never touch its checkpoints.
//
// Contract notes (verified against a live v4 database, 2026-09):
//  - Table session_rollups: sessionId, day, site, provider, model,
//    inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
//    reasoningTokens, requests. `day` is a LOCAL calendar date (YYYY-MM-DD);
//    TokenLedger stores no hour or timestamp, so there is NO sub-day signal.
//  - `sessions` maps sessionId -> project (an absolute cwd).
//  - schemaVersion is in `meta`; abort loudly rather than mis-read a future
//    schema we have not verified.
//
// Granularity decision (user-confirmed): one bucket per (project, model, day)
// anchored at 00:00 UTC of that date. Fabricating an intra-day distribution
// would invent data the source does not have; the daily total stays exact and
// the date is preserved. Downstream hour-of-day views therefore show DeepSeek
// usage concentrated at midnight — a known, accepted consequence.
//
// Column mapping — TokenLedger's naming is already split the way our schema
// wants (cache read vs write are separate), so this is a 1:1 mapping with NO
// subtraction. Do NOT apply the Codex cached-input rule here: that rule exists
// because Codex's input_tokens INCLUDES cache reads, whereas DeepSeek-style
// accounting reports cache_read separately and excludes it from input.
//
// source_kind: rows whose site is a real relay/anthropic-style deployment are
// still reported by the provider field; we only assert `direct_api` when the
// provider is DeepSeek's own endpoint, and default to `unknown` otherwise
// (convention: never guess attribution).

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import Database from "better-sqlite3"
import type { SourceKind, UsageRecord } from "../core/types.js"

/** Highest TokenLedger schemaVersion whose columns this collector has verified. */
const SUPPORTED_SCHEMA_VERSION = 4

export interface DeepSeekCollectorOptions {
  deviceId: string
  /** DSH home, default $DSH_HOME or ~/.dsh */
  dshHome?: string
}

/** Resolve the DSH data dir: DSH_HOME wins, else ~/.dsh. */
export function resolveDshHome(explicit?: string): string {
  if (explicit) return explicit
  return process.env.DSH_HOME?.trim() || path.join(os.homedir(), ".dsh")
}

/**
 * Candidate TokenLedger databases, richest first. `tokenledger-web.sqlite` is
 * what the DSH web UI writes; `tokenledger.sqlite` is the CLI's store and may
 * be empty. We read every existing file and let the upsert merge them.
 */
export function listLedgerPaths(dshHome: string): string[] {
  return ["tokenledger-web.sqlite", "tokenledger.sqlite"]
    .map((f) => path.join(dshHome, f))
    .filter((p) => fs.existsSync(p))
}

interface RollupRow {
  sessionId: string
  day: string
  site: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  requests: number
  project?: string | null
}

/** Parse TokenLedger rollups into daily usage buckets. Missing source = []. */
export async function collectDeepSeek(opts: DeepSeekCollectorOptions): Promise<UsageRecord[]> {
  const dshHome = resolveDshHome(opts.dshHome)
  const ledgers = listLedgerPaths(dshHome)
  if (ledgers.length === 0) return []

  // project|model|hour_start -> accumulated bucket. Multiple sessions and
  // multiple ledgers can contribute to the same day, so we merge here.
  const buckets = new Map<string, UsageRecord>()

  for (const ledger of ledgers) {
    for (const row of readRollups(ledger)) {
      const hourStart = dayToUtcBucketStart(row.day)
      if (!hourStart) continue
      const project = projectName(row.project)
      const model = typeof row.model === "string" && row.model.trim() ? row.model.trim() : "unknown"
      const key = `${project}|${model}|${hourStart}`

      let rec = buckets.get(key)
      if (!rec) {
        rec = {
          device_id: opts.deviceId,
          tool: "deepseek",
          project,
          source_kind: sourceKindFor(row),
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

      const input = toNonNegativeInt(row.inputTokens)
      const output = toNonNegativeInt(row.outputTokens)
      const cacheRead = toNonNegativeInt(row.cacheReadTokens)
      const cacheWrite = toNonNegativeInt(row.cacheWriteTokens)
      const reasoning = toNonNegativeInt(row.reasoningTokens)

      rec.input_tokens += input
      rec.output_tokens += output
      rec.cached_input_tokens += cacheRead
      rec.cache_creation_input_tokens += cacheWrite
      rec.reasoning_output_tokens += reasoning
      // total = sum of the split columns (reasoning folds into output for
      // cost, matching the Codex convention: it is already inside output).
      rec.total_tokens = rec.input_tokens + rec.output_tokens + rec.cached_input_tokens + rec.cache_creation_input_tokens
      // `requests` is the closest analogue to a conversation/request count.
      rec.conversation_count += toNonNegativeInt(row.requests)
    }
  }

  return [...buckets.values()]
}

/**
 * Read one TokenLedger database read-only. A missing file or an unverified
 * schema yields no rows rather than a partially-misread result.
 */
function readRollups(ledgerPath: string): RollupRow[] {
  let db: Database.Database | null = null
  try {
    db = new Database(ledgerPath, { readonly: true, fileMustExist: true })
    const version = readSchemaVersion(db)
    if (version === null) return []
    if (version > SUPPORTED_SCHEMA_VERSION) {
      // A newer writer changed the columns we depend on — stop rather than
      // silently produce wrong numbers.
      return []
    }
    return db
      .prepare(
        `SELECT r.sessionId, r.day, r.site, r.provider, r.model,
                r.inputTokens, r.outputTokens, r.cacheReadTokens,
                r.cacheWriteTokens, r.reasoningTokens, r.requests,
                s.project AS project
           FROM session_rollups r
           LEFT JOIN sessions s ON s.sessionId = r.sessionId`,
      )
      .all() as RollupRow[]
  } catch {
    // Unreadable/locked/absent: treat as "no data this run" (idempotent sync).
    return []
  } finally {
    try {
      db?.close()
    } catch {
      /* already closed */
    }
  }
}

function readSchemaVersion(db: Database.Database): number | null {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as
      | { value?: unknown }
      | undefined
    const n = Number(row?.value)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/**
 * TokenLedger's provider/site vocabulary -> our source_kind.
 * Only DeepSeek's own endpoint is a known direct API; anything else stays
 * "unknown" because a relay alias cannot be resolved from these fields alone.
 */
export function sourceKindFor(row: { provider?: unknown; site?: unknown }): SourceKind {
  const provider = typeof row.provider === "string" ? row.provider.toLowerCase() : ""
  if (provider.includes("deepseek") && (provider.includes("official") || provider === "deepseek")) {
    return "direct_api"
  }
  return "unknown"
}

/** Absolute cwd -> project name, matching the Claude/Codex collectors. */
export function projectName(project: string | null | undefined): string {
  if (typeof project !== "string" || !project.trim()) return ""
  // path.win32.basename splits on both "\\" and "/", so a Windows cwd stored in
  // the ledger yields the same project name whichever OS reads it.
  return path.win32.basename(project.trim())
}

/** A YYYY-MM-DD local calendar date -> 00:00 UTC of that date (ISO), or null. */
export function dayToUtcBucketStart(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof day === "string" ? day.trim() : "")
  if (!m) return null
  const [, y, mo, d] = m
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0))
  if (!Number.isFinite(dt.getTime())) return null
  // Reject overflowed dates (e.g. 2026-02-31 rolling into March).
  if (dt.getUTCMonth() !== Number(mo) - 1 || dt.getUTCDate() !== Number(d)) return null
  return dt.toISOString()
}

function toNonNegativeInt(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}
