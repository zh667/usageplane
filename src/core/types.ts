// Unified record schema — the load-bearing contract of UsagePlane.
// Token column semantics are inherited from TokenTracker (see CLAUDE.md):
// cost must never be derived from total_tokens, only from the split columns.

/** How a usage record reached the provider. Never guess: default to "unknown". */
export type SourceKind = "official_subscription" | "direct_api" | "relay" | "unknown"

/** Tools we collect usage from. Extend as collectors are added. */
export type ToolId = "claude-code" | "codex" | (string & {})

/**
 * One half-hour usage bucket for (device, tool, project, model) —
 * bucket granularity follows TokenTracker so results stay comparable.
 * Aggregated — never contains prompts, messages, or conversation bodies.
 */
export interface UsageRecord {
  /** Stable device name from config, e.g. "vps-tokyo". */
  device_id: string
  tool: ToolId
  /** Project directory name or logical project id; "" when unknown. */
  project: string
  source_kind: SourceKind
  /** Set only for source_kind "relay" after the user explicitly binds it. */
  relay_id?: string | null
  account_id?: string | null
  /** Irreversible fingerprint of the credential — never the key itself. */
  credential_id?: string | null
  model: string
  /** UTC ISO timestamp of the half-hour bucket start, e.g. "2026-08-07T09:30:00.000Z". */
  hour_start: string

  /** Non-cached input only (no cache reads/writes). */
  input_tokens: number
  output_tokens: number
  /** Cache reads. */
  cached_input_tokens: number
  /** Cache writes. */
  cache_creation_input_tokens: number
  reasoning_output_tokens: number
  /** Sum of all token columns. Display only — never a cost basis. */
  total_tokens: number
  conversation_count: number

  /**
   * Cost estimated from list prices. May be a mere equivalent for
   * subscription usage. NEVER add this to reported_cost in any view.
   */
  estimated_cost?: number | null
  /** Actual charge reported by a relay site, when available. */
  reported_cost?: number | null
}

/** Primary key of a usage bucket. */
export type UsageRecordKey = Pick<
  UsageRecord,
  "device_id" | "tool" | "project" | "model" | "hour_start"
>

export const SOURCE_KINDS: readonly SourceKind[] = [
  "official_subscription",
  "direct_api",
  "relay",
  "unknown",
]

/** Zero-fill optional token fields and validate invariants. Throws on negative counts. */
export function normalizeUsageRecord(r: UsageRecord): UsageRecord {
  const rec: UsageRecord = {
    relay_id: null,
    account_id: null,
    credential_id: null,
    estimated_cost: null,
    reported_cost: null,
    ...r,
  }
  const tokenFields = [
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
    "cache_creation_input_tokens",
    "reasoning_output_tokens",
    "total_tokens",
    "conversation_count",
  ] as const
  for (const f of tokenFields) {
    const v = rec[f]
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`UsageRecord.${f} must be a non-negative number, got ${v}`)
    }
  }
  if (!SOURCE_KINDS.includes(rec.source_kind)) {
    throw new Error(`Invalid source_kind: ${rec.source_kind}`)
  }
  return rec
}
