---
name: port-collector
description: Port a usage collector from TokenTracker into UsagePlane (src/collectors/). Use whenever adding support for a new AI coding tool's usage logs — Codex, Cursor, Gemini, OpenCode, or any tool TokenTracker already parses — or when the user says "移植采集器"、"加一个 XX 的采集器"、"port the XX collector". Also consult it when fixing token-count discrepancies in an existing collector, because the acceptance procedure here is how discrepancies get proven or ruled out.
---

# Porting a usage collector from TokenTracker

TokenTracker (`~/projects/reference/TokenTracker`, MIT) already parses 29 tools'
logs and has paid for every parsing mistake once. Porting its parser beats
rewriting one — but a blind copy also fails, because UsagePlane's storage model
(SQLite, idempotent last-write-wins upserts per bucket) removes the need for
most of upstream's incremental-cursor machinery. This skill is the distilled
procedure from the Claude Code port (M2), which reached exact parity: every
token column equal, global and per model, over 70 real log files.

## Procedure

### 1. Read the upstream parser before writing anything

- Locate the tool's functions in `src/lib/rollout.js` (16k lines — navigate
  with `grep -n "^async function\|^function"`, read only the relevant ranges).
  Some tools have a dedicated file (e.g. `codex-rollout-parser.js`).
- Read the tool's entries in TokenTracker's `CLAUDE.md` "Lessons learned →
  Parser correctness" section. Every line there is a shipped bug.

### 2. Verify token field semantics FIRST — the highest-risk step

Never assume `input_tokens` means non-cached input. Known traps:

- **Codex / every-code: `input` INCLUDES cached tokens.** Copying it 1:1
  inflates cost 6–7×. Subtract cache reads into our `input_tokens` column.
- Claude: `input_tokens` already excludes cache reads/writes — maps 1:1.
- `contextTokensUsed`-style fields are usually **snapshots, not cumulative**.

Our normalized columns (from `src/core/types.ts`, cost never derives from
`total_tokens`): `input_tokens` (non-cached only), `cached_input_tokens`
(reads), `cache_creation_input_tokens` (writes), `reasoning_output_tokens`,
`total_tokens` (sum of all columns).

### 3. Decide the deliberate simplifications, and write them in the file header

Standard divergences from upstream (justified once, reuse the justification):

- **Full re-parse per sync, no cursor/offset state** — our upsert is
  last-write-wins per bucket key, so re-parsing is idempotent and cross-file
  dedup needs no persistence.
- **No WSL/UNC dual-path dedup** (Linux/macOS first).
- **No attribution guessing.** Upstream folds conversation counts into the
  hour's "dominant model"; user messages carry no model, so we keep them under
  model `"unknown"`. Token columns still match upstream exactly.
- Project attribution = basename of session cwd.

Each divergence and each ported source goes in the header comment:
`// Ported from TokenTracker src/lib/<file> (MIT) — <functions>`.

### 4. Port into `src/collectors/<tool>.ts`

- ESM + strict TS (upstream is CommonJS — convert).
- Preserve upstream's dedup semantics exactly (e.g. Claude's
  `msgId[:reqId]` key that must NOT require `reqId` — sub-agent rows have
  none and fail open, over-counting 1.6–3.7×).
- Aggregate into half-hour UTC buckets (`toUtcHalfHourStart` pattern) keyed
  `project|model|bucket_start`; emit `UsageRecord[]` with
  `source_kind: "unknown"`.
- Wire into `src/commands/sync.ts` and mention the collector id in
  `starterConfigYaml`.

### 5. Unit tests with synthetic fixtures (`test/<tool>.test.ts`)

Cover at minimum: correct bucket/column mapping; dedup within and across
files; zero-usage rows skipped; malformed JSON lines skipped; rows without
timestamps skipped; the tool's specific cache-semantics trap (prove the
subtraction); conversation counting rules if applicable.

### 6. Acceptance — parity against the original parser on real logs

Copy the pattern of `scripts/compare-claude-tokentracker.mts`: run upstream's
parser (via `createRequire` on the reference clone) and our collector over the
same real logs, diff **all token columns globally AND per model** (exact zero),
and conversation counts globally only. If real logs for the tool live on
another device, note that and run acceptance when the data is reachable
(e.g. Windows logs via the sshfs mount) — synthetic tests alone do not close
the milestone.

### 7. Verification before completion (each independent — typecheck ≠ build)

```
npm run typecheck && npm test        # full counts, not tail-truncated
npm run build && node bin/usageplane.js sync   # the npm-user path
node bin/usageplane.js sync          # run TWICE — second run must not change counts
npx tsx scripts/compare-<tool>-tokentracker.mts
```

### 8. Close out

Update `docs/ROADMAP.md` (status + acceptance evidence + any new decision-log
entries), check the staged diff for leaked credentials/domains
(`git diff --cached | grep -ci "<token fragments>"`), commit with provenance
in the message, push.
