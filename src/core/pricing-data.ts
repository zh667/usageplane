// Ported verbatim from TokenTracker src/lib/pricing/curated-overrides.json (MIT).
// Units: USD per million tokens. Update by re-running the port from upstream.
// eslint-disable-next-line
export const PRICING_DATA = {
  "_meta": {
    "note": "Curated price overrides. Always wins over LiteLLM. Two reasons to live here: (1) self-defined alias names that LiteLLM will never carry (kiro-*, hy3-*, composer-*, kimi-for-coding, free-tier OpenRouter routes); (2) prices we want to pin even if LiteLLM has the model (e.g. cache_write fields LiteLLM often omits). Units: USD per million tokens. Edit this file to override pricing without redeploying.",
    "units": "usd_per_million_tokens",
    "deepseek_v4_pro_pricing_note": "The 2026-05-31 promotional-expiry warning is obsolete: api-docs.deepseek.com/quick_start/pricing verified on 2026-06-10 still lists input $0.435/M, output $0.87/M, cache_read $0.003625/M as the official v4-pro rates (the discount became the list price). Do NOT 'restore' the old 4x rates; re-verify against the official page before any change."
  },
  "exact": {
    "gpt-6.2-sol": {
      "input": 2,
      "output": 10,
      "cache_read": 0.1,
      "cache_write": 2,
      "note": "GPT-6.2 family. developers.openai.com/api/docs/pricing standard tier, short context (<=272K input), fetched 2026-11-23. OpenAI bills no cache-write surcharge, so cache_write = input. Long context (>272K input) is 2x input/cached and 1.5x output and is NOT modeled. Codex may append reasoning effort (e.g. gpt-6.2-solhigh), caught by fuzzy."
    },
    "gpt-6.2-astra": {
      "input": 8,
      "output": 40,
      "cache_read": 0.4,
      "cache_write": 8,
      "note": "GPT-6.2 family. developers.openai.com/api/docs/pricing standard tier, short context (<=272K input), fetched 2026-11-23. OpenAI bills no cache-write surcharge, so cache_write = input. Long context (>272K input) is 2x input/cached and 1.5x output and is NOT modeled. Codex may append reasoning effort (e.g. gpt-6.2-astrahigh), caught by fuzzy."
    },
    "gemini-4-carbon": {
      "input": 2,
      "output": 10,
      "cache_read": 0.1,
      "cache_write": 2,
      "note": "gemini-4-carbon. aistudio.google.com/docs/pricing paid tier Standard, text input, fetched 2026-11-23. Context-caching price -> cache_read; cache creation bills at the input rate (storage per hour is NOT modeled), so cache_write = input. Price through 2026-11-30; from 2026-12-01 it is $4/$20, cache $0.20 \u2014 update this entry then."
    },
    "gemini-4-argon": {
      "input": 2,
      "output": 10,
      "cache_read": 0.1,
      "cache_write": 2,
      "note": "gemini-4-argon. aistudio.google.com/docs/pricing paid tier Standard, text input, fetched 2026-11-23. Context-caching price -> cache_read; cache creation bills at the input rate (storage per hour is NOT modeled), so cache_write = input. Price through 2026-11-30; from 2026-12-01 it is $4/$20, cache $0.20 \u2014 update this entry then."
    },
    "gemini-4-neon": {
      "input": 3,
      "output": 15,
      "cache_read": 0.15,
      "cache_write": 3,
      "note": "gemini-4-neon. aistudio.google.com/docs/pricing paid tier Standard, text input, fetched 2026-11-23. Context-caching price -> cache_read; cache creation bills at the input rate (storage per hour is NOT modeled), so cache_write = input."
    },
    "gemini-4-hydrogen": {
      "input": 1.5,
      "output": 7.5,
      "cache_read": 0.075,
      "cache_write": 1.5,
      "note": "gemini-4-hydrogen. aistudio.google.com/docs/pricing paid tier Standard, text input, fetched 2026-11-23. Context-caching price -> cache_read; cache creation bills at the input rate (storage per hour is NOT modeled), so cache_write = input."
    },
    "gemini-3.8-flash": {
      "input": 0.75,
      "output": 3.75,
      "cache_read": 0.075,
      "cache_write": 0.75,
      "note": "gemini-3.8-flash. aistudio.google.com/docs/pricing paid tier Standard, text input, fetched 2026-11-23. Context-caching price -> cache_read; cache creation bills at the input rate (storage per hour is NOT modeled), so cache_write = input. Price through 2026-12-31; from 2027-01-01 it is $1.50/$7.50, cache $0.15 \u2014 update this entry then."
    },
    "gemini-3.6-flash": {
      "input": 0.75,
      "output": 3.75,
      "cache_read": 0.075,
      "cache_write": 0.75,
      "note": "gemini-3.6-flash. aistudio.google.com/docs/pricing paid tier Standard, text input, fetched 2026-11-23. Context-caching price -> cache_read; cache creation bills at the input rate (storage per hour is NOT modeled), so cache_write = input. Price through 2026-12-31; from 2027-01-01 it is $1.50/$7.50, cache $0.15 \u2014 update this entry then."
    },
    "gemini-3.5-flash-lite": {
      "input": 0.3,
      "output": 2.5,
      "cache_read": 0.03,
      "cache_write": 0.3,
      "note": "gemini-3.5-flash-lite. aistudio.google.com/docs/pricing paid tier Standard, text input, fetched 2026-11-23. Context-caching price -> cache_read; cache creation bills at the input rate (storage per hour is NOT modeled), so cache_write = input. Curated so it does not fall through to the LiteLLM gemini-3.5-flash key by substring (that would price it at $1.50/$9)."
    },
    "claude-fable-5-2": {
      "input": 8,
      "output": 40,
      "cache_read": 0.2,
      "cache_write": 10,
      "note": "Fable 5.2: $8/$40, cache read $0.20 (0.025x), 5-min cache write $10. Anthropic list price per shared/models.md of the claude-api skill (cached 2026-11-03), re-checked 2026-11-23."
    },
    "claude-fable-5-1": {
      "input": 10,
      "output": 50,
      "cache_read": 0.25,
      "cache_write": 12.5,
      "note": "Fable 5.1: $10/$50, cache read $0.25 (0.025x, a quarter of Fable 5's), 5-min cache write $12.50. Anthropic list price per shared/models.md of the claude-api skill (cached 2026-11-03), re-checked 2026-11-23."
    },
    "claude-opus-5-5": {
      "input": 4,
      "output": 20,
      "cache_read": 0.2,
      "cache_write": 5,
      "note": "Opus 5.5: $4/$20, cache read $0.20 (0.05x), 5-min cache write $5. Previously fell through to the claude-opus-5 fuzzy rule and was over-priced at $5/$25. Anthropic list price per shared/models.md of the claude-api skill (cached 2026-11-03), re-checked 2026-11-23."
    },
    "claude-sonnet-5-5": {
      "input": 2,
      "output": 10,
      "cache_read": 0.1,
      "cache_write": 2.5,
      "note": "Sonnet 5.5: $2/$10, cache read $0.10 (0.05x), 5-min cache write $2.50. Anthropic list price per shared/models.md of the claude-api skill (cached 2026-11-03), re-checked 2026-11-23."
    },
    "claude-haiku-5-5": {
      "input": 0.1,
      "output": 0.5,
      "cache_read": 0.01,
      "cache_write": 0.125,
      "note": "Haiku 5.5: $0.10/$0.50 for prompts up to 100K tokens ($0.50/$2.50 beyond, NOT modeled). cache_read 0.1x, cache_write 1.25x. Anthropic list price per shared/models.md of the claude-api skill (cached 2026-11-03), re-checked 2026-11-23."
    },
    "gpt-6-astra": {
      "input": 10,
      "output": 50,
      "cache_read": 1,
      "cache_write": 10,
      "note": "GPT-6 family. developers.openai.com/api/docs/pricing standard tier, short context (<=272K input), fetched 2026-11-23. OpenAI bills no cache-write surcharge, so cache_write = input. Long context (>272K input) is 2x input/cached and 1.5x output and is NOT modeled. Codex may append reasoning effort (e.g. gpt-6-astrahigh), caught by fuzzy."
    },
    "gpt-6-sol": {
      "input": 2,
      "output": 10,
      "cache_read": 0.2,
      "cache_write": 2,
      "note": "GPT-6 family. developers.openai.com/api/docs/pricing standard tier, short context (<=272K input), fetched 2026-11-23. OpenAI bills no cache-write surcharge, so cache_write = input. Long context (>272K input) is 2x input/cached and 1.5x output and is NOT modeled. Codex may append reasoning effort (e.g. gpt-6-solhigh), caught by fuzzy."
    },
    "gpt-6.1-sol": {
      "input": 2,
      "output": 10,
      "cache_read": 0.1,
      "cache_write": 2,
      "note": "GPT-6 family. developers.openai.com/api/docs/pricing standard tier, short context (<=272K input), fetched 2026-11-23. OpenAI bills no cache-write surcharge, so cache_write = input. Long context (>272K input) is 2x input/cached and 1.5x output and is NOT modeled. Codex may append reasoning effort (e.g. gpt-6.1-solhigh), caught by fuzzy."
    },
    "gpt-6.1-terra": {
      "input": 1,
      "output": 5,
      "cache_read": 0.05,
      "cache_write": 1,
      "note": "GPT-6 family. developers.openai.com/api/docs/pricing standard tier, short context (<=272K input), fetched 2026-11-23. OpenAI bills no cache-write surcharge, so cache_write = input. Long context (>272K input) is 2x input/cached and 1.5x output and is NOT modeled. Codex may append reasoning effort (e.g. gpt-6.1-terrahigh), caught by fuzzy."
    },
    "gpt-6-luna": {
      "input": 0.1,
      "output": 0.5,
      "cache_read": 0.01,
      "cache_write": 0.1,
      "note": "GPT-6 family. developers.openai.com/api/docs/pricing standard tier, short context (<=272K input), fetched 2026-11-23. OpenAI bills no cache-write surcharge, so cache_write = input. Long context (>272K input) is 2x input/cached and 1.5x output and is NOT modeled. Codex may append reasoning effort (e.g. gpt-6-lunahigh), caught by fuzzy."
    },
    "claude-fable-5": {
      "input": 10,
      "output": 50,
      "cache_read": 1,
      "cache_write": 12.5,
      "note": "Fable 5 — Anthropic's top tier above Opus. Not yet in LiteLLM. $10/$50 per MTok; cache_read 0.1x, cache_write 1.25x. Remove once LiteLLM carries it."
    },
    "claude-opus-5": {
      "input": 5,
      "output": 25,
      "cache_read": 0.5,
      "cache_write": 6.25,
      "note": "Opus 5 (public 2026-07). Standard Opus tier, unchanged from 4.6/4.7/4.8: $5/$25 per MTok, cache_read 0.1x, cache_write 1.25x. Not yet in LiteLLM. Fast mode is billed at $10/$50 — see claude-opus-5-fast. Remove once LiteLLM carries it."
    },
    "claude-opus-5-fast": {
      "input": 10,
      "output": 50,
      "cache_read": 1,
      "cache_write": 12.5,
      "note": "Opus 5 fast mode (speed=\"fast\", beta fast-mode-2026-02-01) is priced at $10/$50 per MTok — 2x standard Opus. Kept separate so a -fast model id is not silently priced at the standard tier. See claude-opus-5."
    },
    "claude-opus-4-8": {
      "input": 5,
      "output": 25,
      "cache_read": 0.5,
      "cache_write": 6.25,
      "note": "Opus 4.8 not yet in LiteLLM. Pin to the standard Opus tier (same as 4.6/4.7); remove once LiteLLM carries it."
    },
    "claude-sonnet-5": {
      "input": 3,
      "output": 15,
      "cache_read": 0.3,
      "cache_write": 3.75,
      "note": "Sonnet 5. LiteLLM added this model on ~2026-06-30 with matching rates, but pin explicitly so pricing is correct immediately rather than depending on the 24h local pricing-cache refresh cycle."
    },
    "claude-haiku-4-5": {
      "input": 1,
      "output": 5,
      "cache_read": 0.1,
      "cache_write": 1.25,
      "note": "Canonical undated alias emitted by Cursor. Pin to the same rates as claude-haiku-4-5-20251001 so local cost does not depend on which dated LiteLLM aliases are present in the current cache."
    },
    "gpt-5.6-sol": {
      "input": 4,
      "output": 20,
      "cache_read": 0.4,
      "cache_write": 4,
      "note": "GPT-5.6 Sol. developers.openai.com/api/docs/pricing standard tier, short context (<=272K input), fetched 2026-11-23. OpenAI bills no cache-write surcharge, so cache_write = input. Long context (>272K input) is 2x input/cached and 1.5x output and is NOT modeled. Was $5/$30 at launch (2026-07-09, per the TokenTracker port); the current list price is $4/$20 and estimates use the current price. Codex emits reasoning-effort variants like gpt-5.6-solhigh, caught by fuzzy."
    },
    "gpt-5.6-terra": {
      "input": 2,
      "output": 12,
      "cache_read": 0.2,
      "cache_write": 2.5,
      "note": "GPT-5.6 balanced default tier. Official short-context rates: $2/$12 per MTok (not the earlier $2.5/$15 snapshot). See gpt-5.6-sol."
    },
    "gpt-5.6-luna": {
      "input": 0.2,
      "output": 1.2,
      "cache_read": 0.02,
      "cache_write": 0.25,
      "note": "GPT-5.6 lightweight tier. Official short-context rates: $0.20/$1.20 per MTok (previous curated values $1/$6 overcounted 5x). See gpt-5.6-sol."
    },
    "kiro-agent": {
      "input": 3,
      "output": 15,
      "cache_read": 0.3,
      "cache_write": 3.75
    },
    "kiro-cli-agent": {
      "input": 3,
      "output": 15,
      "cache_read": 0.3,
      "cache_write": 3.75
    },
    "hy3-preview-agent": {
      "input": 0.167,
      "output": 0.556,
      "cache_read": 0.056,
      "cache_write": 0.167,
      "note": "Tencent Hunyuan Hy3 preview (CodeBuddy/WorkBuddy backend). Official TokenHub rate: 1.2 / 0.4 (cache hit) / 4.0 RMB per MTok in/read/out, converted at ~7.2 RMB/USD. DeepSeek-style cache: no write surcharge, so cache_write = input."
    },
    "hy3-preview": {
      "input": 0.167,
      "output": 0.556,
      "cache_read": 0.056,
      "cache_write": 0.167,
      "note": "See hy3-preview-agent."
    },
    "composer-1": {
      "input": 1.25,
      "output": 10,
      "cache_read": 0.125
    },
    "composer-1.5": {
      "input": 3.5,
      "output": 17.5,
      "cache_read": 0.35
    },
    "composer-2": {
      "input": 0.5,
      "output": 2.5,
      "cache_read": 0.2
    },
    "composer-2-fast": {
      "input": 1.5,
      "output": 7.5,
      "cache_read": 0.15
    },
    "MiniMax-M2.7": {
      "input": 0.3,
      "output": 1.2,
      "cache_read": 0.06,
      "cache_write": 0.375
    },
    "MiniMax-M2.7-highspeed": {
      "input": 0.6,
      "output": 2.4,
      "cache_read": 0.06,
      "cache_write": 0.375
    },
    "minimax-m3": {
      "input": 0.3,
      "output": 1.2,
      "cache_read": 0.06,
      "cache_write": 0
    },
    "deepseek-v4-flash": {
      "input": 0.14,
      "output": 0.28,
      "cache_read": 0.0028,
      "cache_write": 0.14,
      "note": "DeepSeek's fast tier. TokenLedger (DSH) stores this SKU under the bare name \"deepseek-flash\", which the alias table maps here — the bare name is the same tier, NOT an unpriced model. cache_write = input follows DeepSeek's no-write-surcharge cache model."
    },
    "deepseek-v4-pro": {
      "input": 0.435,
      "output": 0.87,
      "cache_read": 0.003625,
      "cache_write": 0.435
    },
    "deepseek-chat": {
      "input": 0.14,
      "output": 0.28,
      "cache_read": 0.0028,
      "cache_write": 0.14
    },
    "grok-build": {
      "input": 1.25,
      "output": 2.5,
      "cache_read": 0.2,
      "note": "Grok Build TUI fallback estimate for sessions without turn_completed.usage. Preferred path is turn_completed usage with per-model modelUsage splits."
    },
    "cursor-grok-4.5": {
      "input": 2,
      "output": 6,
      "cache_read": 0.5,
      "cache_write": 0,
      "note": "Cursor Grok 4.5 base rate. Cursor Models & Pricing: $2/M input, $0.50/M cached input, $6/M output; no cache-write rate is published."
    },
    "cursor-grok-4.5-fast": {
      "input": 4,
      "output": 18,
      "cache_read": 1,
      "cache_write": 0,
      "note": "Cursor Grok 4.5 Fast rate. Cursor publishes $4/M input and $18/M output; the Cursor usage breakdown reports $1/M cached input. Kept separate from the cheaper base SKU."
    },
    "grok-4-0709": {
      "input": 3,
      "output": 15,
      "cache_read": 0.75
    },
    "grok-4": {
      "input": 3,
      "output": 15,
      "cache_read": 0.75
    },
    "grok-4-latest": {
      "input": 3,
      "output": 15,
      "cache_read": 0.75
    },
    "grok-4-fast": {
      "input": 0.2,
      "output": 0.5,
      "cache_read": 0.05
    },
    "grok-4-fast-reasoning": {
      "input": 0.2,
      "output": 0.5,
      "cache_read": 0.05
    },
    "grok-4-fast-non-reasoning": {
      "input": 0.2,
      "output": 0.5,
      "cache_read": 0.05
    },
    "grok-4-1-fast-non-reasoning": {
      "input": 0.2,
      "output": 0.5,
      "cache_read": 0.05
    },
    "deepseek-reasoner": {
      "input": 0.14,
      "output": 0.28,
      "cache_read": 0.0028,
      "cache_write": 0.14
    },
    "kimi-for-coding": {
      "input": 0.6,
      "output": 2,
      "cache_read": 0.15
    },
    "kimi-k2.5": {
      "input": 0.6,
      "output": 2,
      "cache_read": 0.15
    },
    "kimi-k2.5-free": {
      "input": 0,
      "output": 0,
      "cache_read": 0
    },
    "kimi-k2.6": {
      "input": 0.95,
      "output": 4,
      "cache_read": 0.16
    },
    "kimi-k2.7-code": {
      "input": 0.95,
      "output": 4,
      "cache_read": 0.19
    },
    "kimi-k3": {
      "input": 3,
      "output": 15,
      "cache_read": 0.3,
      "note": "Kimi K3 (released 2026-07-16). Reported API rates: $3/M input, $15/M output, $0.30/M cached input (0.1x). Not yet in LiteLLM; remove once it carries k3. Kimi Code records the alias as bare \"k3\" (kimi-code/k3), hence the separate exact key below."
    },
    "k3": {
      "input": 3,
      "output": 15,
      "cache_read": 0.3,
      "note": "Bare alias emitted by Kimi Code (modelAlias \"kimi-code/k3\" -> \"k3\"). Same rates as kimi-k3."
    },
    "glm-5.2": {
      "input": 1.4,
      "output": 4.4,
      "cache_read": 0.26
    },
    "glm-5.1": {
      "input": 1.4,
      "output": 4.4,
      "cache_read": 0.26
    },
    "glm-5": {
      "input": 1,
      "output": 3.2,
      "cache_read": 0.2
    },
    "glm-5-turbo": {
      "input": 1.2,
      "output": 4,
      "cache_read": 0.24
    },
    "glm-4.7": {
      "input": 0.6,
      "output": 2.2,
      "cache_read": 0.11
    },
    "glm-4.7-flashx": {
      "input": 0.07,
      "output": 0.4,
      "cache_read": 0.01
    },
    "glm-4.7-flash": {
      "input": 0,
      "output": 0,
      "cache_read": 0
    },
    "glm-4.6": {
      "input": 0.6,
      "output": 2.2,
      "cache_read": 0.11
    },
    "glm-4.5": {
      "input": 0.6,
      "output": 2.2,
      "cache_read": 0.11
    },
    "glm-4.5-x": {
      "input": 2.2,
      "output": 8.9,
      "cache_read": 0.45
    },
    "glm-4.5-air": {
      "input": 0.2,
      "output": 1.1,
      "cache_read": 0.03
    },
    "glm-4.5-airx": {
      "input": 1.1,
      "output": 4.5,
      "cache_read": 0.22
    },
    "glm-4.5-flash": {
      "input": 0,
      "output": 0,
      "cache_read": 0
    },
    "glm-4.7-free": {
      "input": 0,
      "output": 0,
      "cache_read": 0
    },
    "nemotron-3-super-free": {
      "input": 0,
      "output": 0,
      "cache_read": 0
    },
    "mimo-v2-pro-free": {
      "input": 0,
      "output": 0,
      "cache_read": 0
    },
    "minimax-m2.1-free": {
      "input": 0,
      "output": 0,
      "cache_read": 0
    },
    "MiniMax-M2.1": {
      "input": 0.5,
      "output": 3,
      "cache_read": 0.05
    },
    "antigravity-gpt-oss-120b": {
      "input": 2.5,
      "output": 10,
      "cache_read": 0,
      "note": "Antigravity bridge alias. Approximate with GPT-4o-class pricing until Google exposes route-specific billing metadata."
    },
    "sakana/fugu-ultra": {
      "input": 5,
      "output": 30,
      "cache_read": 0.5,
      "cache_write": 5,
      "note": "Sakana Fugu Ultra — multi-agent orchestration via an OpenAI-compatible API (sakana.ai PAYG + OpenRouter), used through Codex/Cursor/Cline/ZCode etc. OpenRouter rates: $5/$30 per MTok in/out, cache_read $0.5/M; no published cache-write surcharge, so cache_write = input. Subscriptions ($20/$100/$200) bill against this token-equivalent rate."
    },
    "longcat-2.0": {
      "input": 0.278,
      "output": 1.111,
      "cache_read": 0.00556,
      "cache_write": 0.278,
      "note": "Meituan LongCat-2.0, seen via ZCode custom-provider routing (issue #276). Official longcat.chat/platform launch-promo rate: RMB 2 / 0.04 (cache hit) / 8 per MTok in/read/out, converted at ~7.2 RMB/USD. Standard list price is RMB 5/0.10/20 (2.5x) once the promo ends — re-verify against longcat.chat/platform/docs/zh/Pricing/LongCat-2.0.html before assuming either is permanent. DeepSeek-style cache: no write surcharge, so cache_write = input."
    },
    "step-3.7-flash": {
      "input": 0.2,
      "output": 1.15,
      "cache_read": 0.04,
      "cache_write": 0.2,
      "note": "StepFun Step 3.7 Flash (issue #283). Official platform.stepfun.ai pricing: $0.20 / $0.04 (cache hit) / $1.15 per MTok in/read/out. No published cache-write surcharge, so cache_write = input."
    },
    "step-3.5-flash": {
      "input": 0.1,
      "output": 0.3,
      "cache_read": 0.02,
      "cache_write": 0.1,
      "note": "StepFun Step 3.5 Flash incl. dated snapshots like step-3.5-flash-2603 (issue #283). Official platform.stepfun.ai pricing: $0.10 / $0.02 (cache hit) / $0.30 per MTok in/read/out. No published cache-write surcharge, so cache_write = input."
    },
    "grok-4.5-build": {
      "input": 2,
      "output": 6,
      "cache_read": 0.5,
      "cache_write": 0,
      "note": "Grok Build paid SKU (grok-4.5-build from turn_completed.modelUsage). Rates aligned with xAI/Cursor Grok 4.5 until a dedicated Build price list is published."
    },
    "grok-build-free": {
      "input": 0,
      "output": 0,
      "cache_read": 0,
      "cache_write": 0,
      "note": "Grok Build free tier (canonical model id). $0 marginal cost. Prefer this over grok-4.5-build-free so pricing lookup cannot fuzzy-match paid grok-4.5."
    },
    "grok-4.5-build-free": {
      "input": 0,
      "output": 0,
      "cache_read": 0,
      "cache_write": 0,
      "note": "Alias for free Build SKU as labeled in Grok updates.jsonl modelUsage. Canonical storage id is grok-build-free."
    }
  },
  "alias": {
    "auto": "composer-1",
    "deepseek-flash": "deepseek-v4-flash"
  },
  "fuzzy": [
    {
      "match": "gpt-6.2-sol",
      "ref": "gpt-6.2-sol"
    },
    {
      "match": "gpt-6.2-astra",
      "ref": "gpt-6.2-astra"
    },
    {
      "match": "gemini-4-carbon",
      "ref": "gemini-4-carbon"
    },
    {
      "match": "gemini-4-argon",
      "ref": "gemini-4-argon"
    },
    {
      "match": "gemini-4-neon",
      "ref": "gemini-4-neon"
    },
    {
      "match": "gemini-4-hydrogen",
      "ref": "gemini-4-hydrogen"
    },
    {
      "match": "gemini-3.8-flash",
      "ref": "gemini-3.8-flash"
    },
    {
      "match": "gemini-3.6-flash",
      "ref": "gemini-3.6-flash"
    },
    {
      "match": "gemini-3.5-flash-lite",
      "ref": "gemini-3.5-flash-lite"
    },
    {
      "match": "claude-fable-5-2",
      "ref": "claude-fable-5-2"
    },
    {
      "match": "claude-fable-5-1",
      "ref": "claude-fable-5-1"
    },
    {
      "match": "claude-opus-5-5",
      "ref": "claude-opus-5-5"
    },
    {
      "match": "claude-sonnet-5-5",
      "ref": "claude-sonnet-5-5"
    },
    {
      "match": "claude-haiku-5-5",
      "ref": "claude-haiku-5-5"
    },
    {
      "match": "gpt-6.1-sol",
      "ref": "gpt-6.1-sol"
    },
    {
      "match": "gpt-6.1-terra",
      "ref": "gpt-6.1-terra"
    },
    {
      "match": "gpt-6-astra",
      "ref": "gpt-6-astra"
    },
    {
      "match": "gpt-6-sol",
      "ref": "gpt-6-sol"
    },
    {
      "match": "gpt-6-luna",
      "ref": "gpt-6-luna"
    },
    {
      "match": "gpt-5.6-sol",
      "ref": "gpt-5.6-sol"
    },
    {
      "match": "gpt-5.6-terra",
      "ref": "gpt-5.6-terra"
    },
    {
      "match": "gpt-5.6-luna",
      "ref": "gpt-5.6-luna"
    },
    {
      "match": "gpt-5.6",
      "ref": "gpt-5.6-terra"
    },
    {
      "match": "kiro",
      "ref": "kiro-cli-agent"
    },
    {
      "match": "hy3",
      "ref": "hy3-preview-agent"
    },
    {
      "match": "composer",
      "ref": "composer-1"
    },
    {
      "match": "claude-opus-5-fast",
      "ref": "claude-opus-5-fast"
    },
    {
      "match": "claude-opus-5",
      "ref": "claude-opus-5"
    },
    {
      "match": "claude-opus-4-8",
      "ref": "claude-opus-4-8"
    },
    {
      "match": "minimax-m3",
      "ref": "minimax-m3"
    },
    {
      "match": "minimax-m2.7-highspeed",
      "ref": "MiniMax-M2.7-highspeed"
    },
    {
      "match": "minimax-m2.7",
      "ref": "MiniMax-M2.7"
    },
    {
      "match": "deepseek-v4-flash",
      "ref": "deepseek-v4-flash"
    },
    {
      "match": "deepseek-v4-pro",
      "ref": "deepseek-v4-pro"
    },
    {
      "match": "kimi-k2.7-code",
      "ref": "kimi-k2.7-code"
    },
    {
      "match": "kimi-k3",
      "ref": "kimi-k3"
    },
    {
      "match": "kimi-k2.6",
      "ref": "kimi-k2.6"
    },
    {
      "match": "kimi",
      "ref": "kimi-k2.5"
    },
    {
      "match": "glm-4.5-airx",
      "ref": "glm-4.5-airx"
    },
    {
      "match": "glm-4.5-air",
      "ref": "glm-4.5-air"
    },
    {
      "match": "glm-4.5-x",
      "ref": "glm-4.5-x"
    },
    {
      "match": "glm-4.5-flash",
      "ref": "glm-4.5-flash"
    },
    {
      "match": "glm-4.5",
      "ref": "glm-4.5"
    },
    {
      "match": "glm-4.7-flashx",
      "ref": "glm-4.7-flashx"
    },
    {
      "match": "glm-4.7-flash",
      "ref": "glm-4.7-flash"
    },
    {
      "match": "glm-4.7",
      "ref": "glm-4.7"
    },
    {
      "match": "glm-4.6",
      "ref": "glm-4.6"
    },
    {
      "match": "glm-5-turbo",
      "ref": "glm-5-turbo"
    },
    {
      "match": "glm-5.2",
      "ref": "glm-5.2"
    },
    {
      "match": "glm-5.1",
      "ref": "glm-5.1"
    },
    {
      "match": "glm-5",
      "ref": "glm-5"
    },
    {
      "match": "fugu",
      "ref": "sakana/fugu-ultra"
    },
    {
      "match": "longcat",
      "ref": "longcat-2.0"
    },
    {
      "match": "step-3.7-flash",
      "ref": "step-3.7-flash"
    },
    {
      "match": "step-3.5-flash",
      "ref": "step-3.5-flash"
    },
    {
      "match": "stepfun",
      "ref": "step-3.7-flash"
    }
  ]
} as const
