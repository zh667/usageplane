import fs from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { normalizeUsageRecord, type UsageRecord } from "./types.js"

// Migrations run in order; sqlite user_version tracks the last applied index + 1.
// Append only — never edit a shipped migration.
const MIGRATIONS: string[] = [
  `CREATE TABLE usage_records (
    device_id                   TEXT NOT NULL,
    tool                        TEXT NOT NULL,
    project                     TEXT NOT NULL DEFAULT '',
    source_kind                 TEXT NOT NULL DEFAULT 'unknown',
    relay_id                    TEXT,
    account_id                  TEXT,
    credential_id               TEXT,
    model                       TEXT NOT NULL,
    hour_start                  TEXT NOT NULL,
    input_tokens                INTEGER NOT NULL DEFAULT 0,
    output_tokens               INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens         INTEGER NOT NULL DEFAULT 0,
    cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_output_tokens     INTEGER NOT NULL DEFAULT 0,
    total_tokens                INTEGER NOT NULL DEFAULT 0,
    conversation_count          INTEGER NOT NULL DEFAULT 0,
    estimated_cost              REAL,
    reported_cost               REAL,
    updated_at                  TEXT NOT NULL,
    PRIMARY KEY (device_id, tool, project, model, hour_start)
  );
  CREATE INDEX idx_usage_hour ON usage_records (hour_start);
  CREATE INDEX idx_usage_tool ON usage_records (tool, hour_start);`,
]

export interface ToolTotals {
  tool: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  conversation_count: number
}

export class Store {
  private db: Database.Database

  constructor(dbFile: string) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true })
    this.db = new Database(dbFile)
    this.db.pragma("journal_mode = WAL")
    this.migrate()
  }

  private migrate(): void {
    let version = this.db.pragma("user_version", { simple: true }) as number
    while (version < MIGRATIONS.length) {
      const apply = this.db.transaction(() => {
        this.db.exec(MIGRATIONS[version])
        this.db.pragma(`user_version = ${version + 1}`)
      })
      apply()
      version++
    }
  }

  /**
   * Insert or replace hourly buckets. Re-syncing a bucket overwrites its values
   * (collectors recompute whole buckets; last write wins per key).
   */
  upsertUsage(records: UsageRecord[]): number {
    const stmt = this.db.prepare(`
      INSERT INTO usage_records (
        device_id, tool, project, source_kind, relay_id, account_id, credential_id,
        model, hour_start,
        input_tokens, output_tokens, cached_input_tokens,
        cache_creation_input_tokens, reasoning_output_tokens, total_tokens,
        conversation_count, estimated_cost, reported_cost, updated_at
      ) VALUES (
        @device_id, @tool, @project, @source_kind, @relay_id, @account_id, @credential_id,
        @model, @hour_start,
        @input_tokens, @output_tokens, @cached_input_tokens,
        @cache_creation_input_tokens, @reasoning_output_tokens, @total_tokens,
        @conversation_count, @estimated_cost, @reported_cost, @updated_at
      )
      ON CONFLICT (device_id, tool, project, model, hour_start) DO UPDATE SET
        source_kind = excluded.source_kind,
        relay_id = excluded.relay_id,
        account_id = excluded.account_id,
        credential_id = excluded.credential_id,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cached_input_tokens = excluded.cached_input_tokens,
        cache_creation_input_tokens = excluded.cache_creation_input_tokens,
        reasoning_output_tokens = excluded.reasoning_output_tokens,
        total_tokens = excluded.total_tokens,
        conversation_count = excluded.conversation_count,
        estimated_cost = excluded.estimated_cost,
        reported_cost = excluded.reported_cost,
        updated_at = excluded.updated_at
    `)
    const updatedAt = new Date().toISOString()
    const run = this.db.transaction((recs: UsageRecord[]) => {
      let n = 0
      for (const r of recs) {
        stmt.run({ ...normalizeUsageRecord(r), updated_at: updatedAt })
        n++
      }
      return n
    })
    return run(records)
  }

  /** Per-tool token totals, for `usageplane status`. */
  totalsByTool(): ToolTotals[] {
    return this.db
      .prepare(`
        SELECT tool,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(total_tokens) AS total_tokens,
               SUM(conversation_count) AS conversation_count
        FROM usage_records GROUP BY tool ORDER BY total_tokens DESC
      `)
      .all() as ToolTotals[]
  }

  countRecords(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM usage_records").get() as { n: number }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
