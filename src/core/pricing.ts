// Cost estimation — ported from TokenTracker src/lib/pricing/index.js (MIT):
// curated table + bundled LiteLLM snapshot lookup, and computeRowCost.
// Iron law: cost derives ONLY from the split token columns, never from
// total_tokens; estimated cost is a list-price equivalent and must never be
// added to relay-reported spend.

import { PRICING_DATA } from "./pricing-data.js"
import { LITELLM_SEED } from "./litellm-seed.js"

export interface ModelPricing {
  input: number
  output: number
  cache_read: number
  cache_write: number
}

const ZERO: ModelPricing = { input: 0, output: 0, cache_read: 0, cache_write: 0 }

interface PriceEntry {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
}

function toPricing(entry: PriceEntry | undefined): ModelPricing | null {
  if (!entry) return null
  return {
    input: entry.input ?? 0,
    output: entry.output ?? 0,
    cache_read: entry.cache_read ?? 0,
    cache_write: entry.cache_write ?? 0,
  }
}

const EXACT = PRICING_DATA.exact as Record<string, PriceEntry>
const ALIAS = PRICING_DATA.alias as Record<string, string>
const FUZZY = PRICING_DATA.fuzzy as unknown as { match: string; ref: string }[]
const LITELLM = LITELLM_SEED as Record<string, PriceEntry>

// Lookup order ported from TokenTracker src/lib/pricing/matcher.js
// lookupPricing (MIT). Curated entries always win; the bundled LiteLLM
// snapshot covers mainstream models (Gemini, older Claude/GPT ids) the curated
// table never carries. UsagePlane ships only the bundled seed — no 24h network
// refresh — so prices change only when the seed is re-ported.
//   1. curated exact (case-insensitive, also the digit-dash -> dot form)
//   2. LiteLLM exact (same two forms)
//   3. curated alias
//   4. curated fuzzy substring
//   5. LiteLLM reasoning-suffix strip (gpt-x-high -> gpt-x)
//   5b. LiteLLM provider-prefix strip (bare id -> "<provider>/<id>", smallest key)
//   6. LiteLLM reverse substring (longest key the model contains)
//   7. miss -> zero pricing

const SUFFIX_STRIP_PATTERNS = [
  /-xhigh-fast$/,
  /-high-fast$/,
  /-medium-fast$/,
  /-low-fast$/,
  /-xhigh$/,
  /-high$/,
  /-medium$/,
  /-low$/,
  /-fast$/,
]

function stripReasoningSuffix(model: string): string {
  for (const re of SUFFIX_STRIP_PATTERNS) {
    if (re.test(model)) return model.replace(re, "")
  }
  return model
}

/** `glm-5-1` -> `glm-5.1`; "" when nothing changes. */
function dotRestored(model: string): string {
  const restored = model.replace(/(\d+)-(\d+)/g, "$1.$2")
  return restored === model ? "" : restored
}

function lowerIndex(table: Record<string, PriceEntry>): Map<string, PriceEntry> {
  const m = new Map<string, PriceEntry>()
  for (const [k, v] of Object.entries(table)) {
    const lk = k.toLowerCase()
    if (!m.has(lk)) m.set(lk, v)
  }
  return m
}

const EXACT_LC = lowerIndex(EXACT)
const LITELLM_LC = lowerIndex(LITELLM)
const LITELLM_KEYS_BY_LENGTH = [...LITELLM_LC.keys()].sort((a, b) => b.length - a.length)
const EXACT_KEYS_BY_LENGTH = [...EXACT_LC.keys()].sort((a, b) => b.length - a.length)

/**
 * Claude Code / relays sometimes report `claude-opus-4.8`, `Claude Opus 4.8`
 * or a provider path (`anthropic/claude-4.6-opus`). Normalize for lookup only;
 * the stored model name is untouched. Ported from TokenTracker
 * normalizeClaudeModel (MIT).
 */
function normalizeClaudeModel(model: string): string {
  const base = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model
  const m = base
    .trim()
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
  if (/^claude-(sonnet|opus|haiku|fable)-\d+\.\d+/.test(m)) {
    return m.replace(/^(claude-(?:sonnet|opus|haiku|fable)-\d+)\.(\d+)/, "$1-$2")
  }
  if (/^(sonnet|opus|haiku)-\d+[.-]\d+/.test(m)) {
    return m
      .replace(/^(sonnet|opus|haiku)-/, "claude-$1-")
      .replace(/^(claude-(?:sonnet|opus|haiku)-\d+)\.(\d+)/, "$1-$2")
  }
  if (/^claude-(?:[4-9]|\d{2,})[.-]\d+-(?:sonnet|opus|haiku)/.test(m)) {
    return m.replace(/^claude-(\d+)[.-](\d+)-(sonnet|opus|haiku)/, "claude-$3-$1-$2")
  }
  return m
}

const SOURCE_NORMALIZERS: Record<string, (m: string) => string> = {
  "claude-code": normalizeClaudeModel,
}

export function getModelPricing(model: string, tool?: string): ModelPricing {
  if (typeof model !== "string" || !model.trim()) return ZERO
  const normalize = tool ? SOURCE_NORMALIZERS[tool] : undefined
  const lower = (normalize ? normalize(model.trim()) : model.trim()).toLowerCase()
  const dot = dotRestored(lower)

  // 1. curated exact
  let hit = EXACT_LC.get(lower) ?? (dot ? EXACT_LC.get(dot) : undefined)
  if (!hit && dot) {
    // Upstream also accepts a curated key CONTAINED in the dot form.
    const contained = EXACT_KEYS_BY_LENGTH.find((k) => dot.includes(k))
    if (contained) hit = EXACT_LC.get(contained)
  }
  if (hit) return toPricing(hit) ?? ZERO

  // 2. LiteLLM exact
  hit = LITELLM_LC.get(lower) ?? (dot ? LITELLM_LC.get(dot) : undefined)
  if (hit) return toPricing(hit) ?? ZERO

  // 3. curated alias
  const alias = ALIAS[lower]
  if (alias && EXACT[alias]) return toPricing(EXACT[alias]) ?? ZERO

  // 4. curated fuzzy substring
  for (const f of FUZZY) {
    const needle = f.match.toLowerCase()
    if (!EXACT[f.ref]) continue
    if (lower.includes(needle) || (dot && dot.includes(needle))) return toPricing(EXACT[f.ref]) ?? ZERO
  }

  // 5. LiteLLM reasoning-suffix strip
  const stripped = stripReasoningSuffix(lower)
  if (stripped !== lower && LITELLM_LC.has(stripped)) return toPricing(LITELLM_LC.get(stripped)) ?? ZERO

  // 5b. LiteLLM provider-prefix strip (deterministic: smallest matching key)
  const suffix = "/" + lower
  let best: string | null = null
  for (const key of LITELLM_LC.keys()) {
    if (key.length > suffix.length && key.endsWith(suffix) && (best === null || key < best)) best = key
  }
  if (best) return toPricing(LITELLM_LC.get(best)) ?? ZERO

  // 6. LiteLLM reverse substring (longest key first)
  for (const key of LITELLM_KEYS_BY_LENGTH) {
    if (lower.includes(key) || (dot && dot.includes(key))) return toPricing(LITELLM_LC.get(key)) ?? ZERO
  }
  return ZERO
}

export interface CostRow {
  tool?: string
  model: string
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  cache_creation_input_tokens: number
  reasoning_output_tokens: number
}

/**
 * Tools whose `reasoning_output_tokens` is ALREADY a subset of
 * `output_tokens` — charging it again would double-bill those tokens.
 *
 * Codex/EveryCode: token_count output includes reasoning.
 * deepseek: DeepSeek's API reports `reasoning_tokens` inside
 *   `completion_tokens_details`, i.e. as part of completion (output).
 *   Verified empirically on DSH/TokenLedger rows: reasoning never exceeds
 *   output and averages ~43% of it, consistent with a subset. Our own
 *   daily collector also folds reasoning into total_tokens for the same
 *   reason (see collectors/deepseek.ts).
 *
 * Claude-style tools are NOT listed: there reasoning is reported separately
 * and is not included in output_tokens.
 */
const REASONING_INCLUDED_IN_OUTPUT = new Set(["codex", "every-code", "deepseek"])

/** USD estimate for one row. Never double-charge reasoning already inside output. */
export function computeRowCost(row: CostRow): number {
  const pricing = getModelPricing(row.model, row.tool)
  const reasoningIncludedInOutput = REASONING_INCLUDED_IN_OUTPUT.has(row.tool ?? "")
  const reasoningCost = reasoningIncludedInOutput ? 0 : (row.reasoning_output_tokens || 0) * pricing.output
  return (
    ((row.input_tokens || 0) * pricing.input +
      (row.output_tokens || 0) * pricing.output +
      (row.cached_input_tokens || 0) * pricing.cache_read +
      (row.cache_creation_input_tokens || 0) * pricing.cache_write +
      reasoningCost) /
    1_000_000
  )
}
