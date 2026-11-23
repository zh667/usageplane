import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import {
  collectDeepSeek,
  dayToUtcBucketStart,
  listLedgerPaths,
  projectName,
  resolveDshHome,
  sourceKindFor,
} from "../src/collectors/deepseek.js"

interface RollupSeed {
  sessionId: string
  day: string
  site?: string
  provider?: string
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  requests?: number
}

/** Build a TokenLedger-shaped database with the real v4 schema. */
function makeLedger(
  rows: RollupSeed[],
  projects: Record<string, string> = {},
  opts: { schemaVersion?: number; file?: string } = {},
): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-ds-"))
  const file = path.join(home, opts.file ?? "tokenledger-web.sqlite")
  const db = new Database(file)
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE session_rollups (
      sessionId TEXT NOT NULL, day TEXT NOT NULL, site TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL,
      inputTokens INTEGER NOT NULL DEFAULT 0, outputTokens INTEGER NOT NULL DEFAULT 0,
      cacheReadTokens INTEGER NOT NULL DEFAULT 0, cacheWriteTokens INTEGER NOT NULL DEFAULT 0,
      reasoningTokens INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (sessionId, day, site, provider, model)
    ) WITHOUT ROWID;
    CREATE TABLE sessions (sessionId TEXT PRIMARY KEY, project TEXT NOT NULL DEFAULT '') WITHOUT ROWID;
  `)
  db.prepare("INSERT INTO meta (key, value) VALUES ('schemaVersion', ?)").run(
    String(opts.schemaVersion ?? 4),
  )
  const ins = db.prepare(`
    INSERT INTO session_rollups
      (sessionId, day, site, provider, model, inputTokens, outputTokens,
       cacheReadTokens, cacheWriteTokens, reasoningTokens, requests)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `)
  for (const r of rows) {
    ins.run(
      r.sessionId,
      r.day,
      r.site ?? "direct",
      r.provider ?? "deepseek-official",
      r.model,
      r.inputTokens ?? 0,
      r.outputTokens ?? 0,
      r.cacheReadTokens ?? 0,
      r.cacheWriteTokens ?? 0,
      r.reasoningTokens ?? 0,
      r.requests ?? 0,
    )
  }
  const insSession = db.prepare("INSERT INTO sessions (sessionId, project) VALUES (?, ?)")
  for (const [id, project] of Object.entries(projects)) insSession.run(id, project)
  db.close()
  return home
}

test("rollups map 1:1 onto token columns — cache read is NOT subtracted", async () => {
  // The Codex cached-input rule must not leak in here: DeepSeek-style
  // accounting reports cache_read outside input_tokens already.
  const home = makeLedger(
    [
      {
        sessionId: "s1",
        day: "2026-09-13",
        model: "deepseek-flash",
        inputTokens: 87677,
        outputTokens: 125376,
        cacheReadTokens: 8977280,
        cacheWriteTokens: 0,
        reasoningTokens: 60207,
        requests: 81,
      },
    ],
    { s1: "/home/dev/proj-x" },
  )
  const records = await collectDeepSeek({ deviceId: "d", dshHome: home })
  assert.equal(records.length, 1)
  const r = records[0]
  assert.equal(r.tool, "deepseek")
  assert.equal(r.device_id, "d")
  assert.equal(r.project, "proj-x")
  assert.equal(r.model, "deepseek-flash")
  assert.equal(r.input_tokens, 87677)
  assert.equal(r.output_tokens, 125376)
  assert.equal(r.cached_input_tokens, 8977280)
  assert.equal(r.cache_creation_input_tokens, 0)
  assert.equal(r.reasoning_output_tokens, 60207)
  assert.equal(r.conversation_count, 81)
  // total = split columns, reasoning NOT double counted.
  assert.equal(r.total_tokens, 87677 + 125376 + 8977280 + 0)
})

test("day anchors at 00:00 UTC and rows merge per (project, model, day)", async () => {
  const home = makeLedger(
    [
      { sessionId: "s1", day: "2026-09-13", model: "deepseek-flash", inputTokens: 100, outputTokens: 10, requests: 1 },
      { sessionId: "s2", day: "2026-09-13", model: "deepseek-flash", inputTokens: 200, outputTokens: 20, requests: 2 },
    ],
    { s1: "/a/proj-x", s2: "/b/proj-x" },
  )
  const records = await collectDeepSeek({ deviceId: "d", dshHome: home })
  assert.equal(records.length, 1)
  const r = records[0]
  assert.equal(r.hour_start, "2026-09-13T00:00:00.000Z")
  assert.equal(r.input_tokens, 300)
  assert.equal(r.output_tokens, 30)
  assert.equal(r.conversation_count, 3)
})

test("different models and projects stay separate buckets", async () => {
  const home = makeLedger(
    [
      { sessionId: "s1", day: "2026-09-13", model: "deepseek-flash", inputTokens: 1 },
      { sessionId: "s1", day: "2026-09-13", model: "deepseek-v4-pro", inputTokens: 2 },
      { sessionId: "s2", day: "2026-09-13", model: "deepseek-flash", inputTokens: 3 },
    ],
    { s1: "/x/proj-a", s2: "/x/proj-b" },
  )
  const records = await collectDeepSeek({ deviceId: "d", dshHome: home })
  assert.equal(records.length, 3)
})

test("unrouted provider is unknown; deepseek-official is direct_api", async () => {
  const home = makeLedger([
    { sessionId: "s1", day: "2026-09-13", model: "deepseek-flash", provider: "deepseek-official", inputTokens: 1 },
    { sessionId: "s2", day: "2026-09-13", model: "claude-opus-4-8", provider: "ooioo", site: "unrouted", inputTokens: 2 },
  ])
  const records = await collectDeepSeek({ deviceId: "d", dshHome: home })
  const byModel = new Map(records.map((r) => [r.model, r]))
  assert.equal(byModel.get("deepseek-flash")?.source_kind, "direct_api")
  assert.equal(byModel.get("claude-opus-4-8")?.source_kind, "unknown")
})

test("a session row missing from `sessions` yields an empty project, not a guess", async () => {
  const home = makeLedger([{ sessionId: "orphan", day: "2026-09-13", model: "deepseek-flash", inputTokens: 5 }])
  const records = await collectDeepSeek({ deviceId: "d", dshHome: home })
  assert.equal(records.length, 1)
  assert.equal(records[0].project, "")
})

test("missing ledger directory yields no records instead of throwing", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-ds-empty-"))
  assert.deepEqual(listLedgerPaths(empty), [])
  const records = await collectDeepSeek({ deviceId: "d", dshHome: empty })
  assert.deepEqual(records, [])
})

test("an unverified future schemaVersion yields no rows instead of misreading", async () => {
  const home = makeLedger(
    [{ sessionId: "s1", day: "2026-09-13", model: "deepseek-flash", inputTokens: 9 }],
    {},
    { schemaVersion: 99 },
  )
  const records = await collectDeepSeek({ deviceId: "d", dshHome: home })
  assert.deepEqual(records, [])
})

test("negative or malformed counts clamp to zero", async () => {
  const home = makeLedger([
    { sessionId: "s1", day: "2026-09-13", model: "deepseek-flash", inputTokens: -5, outputTokens: -1 },
  ])
  const records = await collectDeepSeek({ deviceId: "d", dshHome: home })
  assert.equal(records.length, 1)
  assert.equal(records[0].input_tokens, 0)
  assert.equal(records[0].total_tokens, 0)
})

test("both ledger files are read and merged", async () => {
  const home = makeLedger(
    [{ sessionId: "s1", day: "2026-09-13", model: "deepseek-flash", inputTokens: 100 }],
    { s1: "/x/proj-x" },
  )
  // Second ledger in the same home.
  const cli = new Database(path.join(home, "tokenledger.sqlite"))
  cli.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE session_rollups (
      sessionId TEXT NOT NULL, day TEXT NOT NULL, site TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL,
      inputTokens INTEGER NOT NULL DEFAULT 0, outputTokens INTEGER NOT NULL DEFAULT 0,
      cacheReadTokens INTEGER NOT NULL DEFAULT 0, cacheWriteTokens INTEGER NOT NULL DEFAULT 0,
      reasoningTokens INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (sessionId, day, site, provider, model)
    ) WITHOUT ROWID;
    CREATE TABLE sessions (sessionId TEXT PRIMARY KEY, project TEXT NOT NULL DEFAULT '') WITHOUT ROWID;
  `)
  cli.prepare("INSERT INTO meta (key,value) VALUES ('schemaVersion','4')").run()
  cli
    .prepare(
      `INSERT INTO session_rollups (sessionId,day,site,provider,model,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,reasoningTokens,requests)
       VALUES ('s2','2026-09-13','direct','deepseek-official','deepseek-flash',50,0,0,0,0,0)`,
    )
    .run()
  cli.prepare("INSERT INTO sessions (sessionId,project) VALUES ('s2','/x/proj-x')").run()
  cli.close()

  assert.equal(listLedgerPaths(home).length, 2)
  const records = await collectDeepSeek({ deviceId: "d", dshHome: home })
  assert.equal(records.length, 1)
  assert.equal(records[0].input_tokens, 150)
})

test("dayToUtcBucketStart rejects malformed and overflowed dates", () => {
  assert.equal(dayToUtcBucketStart("2026-09-13"), "2026-09-13T00:00:00.000Z")
  assert.equal(dayToUtcBucketStart("2026-02-31"), null)
  assert.equal(dayToUtcBucketStart("2026-13-01"), null)
  assert.equal(dayToUtcBucketStart("not-a-date"), null)
  assert.equal(dayToUtcBucketStart(""), null)
})

test("resolveDshHome prefers explicit, then DSH_HOME, then ~/.dsh", () => {
  assert.equal(resolveDshHome("/explicit"), "/explicit")
  const prev = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = "/from-env"
    assert.equal(resolveDshHome(), "/from-env")
    delete process.env.DSH_HOME
    assert.equal(resolveDshHome(), path.join(os.homedir(), ".dsh"))
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
  }
})

test("projectName takes the basename and tolerates missing values", () => {
  assert.equal(projectName("E:\\Obsidian Document\\Document1"), "Document1")
  assert.equal(projectName("/home/dev/proj"), "proj")
  assert.equal(projectName(""), "")
  assert.equal(projectName(null), "")
  assert.equal(projectName(undefined), "")
})

test("sourceKindFor only asserts direct_api for DeepSeek's own endpoint", () => {
  assert.equal(sourceKindFor({ provider: "deepseek-official" }), "direct_api")
  assert.equal(sourceKindFor({ provider: "deepseek" }), "direct_api")
  assert.equal(sourceKindFor({ provider: "api99" }), "unknown")
  assert.equal(sourceKindFor({ provider: "ooioo" }), "unknown")
  assert.equal(sourceKindFor({}), "unknown")
})
