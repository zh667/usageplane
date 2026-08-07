// Cost estimation — ported from TokenTracker src/lib/pricing/index.js (MIT):
// curated table lookup (exact → alias → fuzzy substring) and computeRowCost.
// Iron law: cost derives ONLY from the split token columns, never from
// total_tokens; estimated cost is a list-price equivalent and must never be
// added to relay-reported spend.

import { PRICING_DATA } from "./pricing-data.js"

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

export function getModelPricing(model: string): ModelPricing {
  const key = (model || "").toLowerCase().trim()
  if (!key) return ZERO
  const exact = toPricing(EXACT[key])
  if (exact) return exact
  const alias = ALIAS[key]
  if (alias) {
    const aliased = toPricing(EXACT[alias])
    if (aliased) return aliased
  }
  for (const f of FUZZY) {
    if (key.includes(f.match)) {
      const ref = toPricing(EXACT[f.ref])
      if (ref) return ref
    }
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

/** USD estimate for one row. Codex folds reasoning into output — don't double-charge. */
export function computeRowCost(row: CostRow): number {
  const pricing = getModelPricing(row.model)
  const reasoningIncludedInOutput = row.tool === "codex" || row.tool === "every-code"
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
