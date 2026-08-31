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
  // Session METADATA (titles are agent-authored; message bodies never stored).
  // Synced between the user's own devices via the self-hosted hub.
  `CREATE TABLE session_records (
    device_id      TEXT NOT NULL,
    tool           TEXT NOT NULL,
    id             TEXT NOT NULL,
    title          TEXT NOT NULL DEFAULT '',
    project        TEXT NOT NULL DEFAULT '',
    model          TEXT NOT NULL DEFAULT '',
    started_at     TEXT,
    ended_at       TEXT,
    duration_ms    INTEGER NOT NULL DEFAULT 0,
    total_tokens   INTEGER NOT NULL DEFAULT 0,
    turns          INTEGER NOT NULL DEFAULT 0,
    edits          INTEGER NOT NULL DEFAULT 0,
    resume_command TEXT NOT NULL DEFAULT '',
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (device_id, tool, id)
  );`,
  // Generic per-device metadata synced via the hub (skills inventory, limit
  // snapshots, …). kind+key identify the item, payload is JSON.
  `CREATE TABLE device_state (
    device_id  TEXT NOT NULL,
    kind       TEXT NOT NULL,
    key        TEXT NOT NULL,
    payload    TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (device_id, kind, key)
  );`,
]

export interface DeviceStateRow {
  device_id: string
  kind: string
  key: string
  payload: string
  updated_at?: string
}

/** State kinds a device fully re-computes each sync. Push declares them so the
 *  hub can replace whole groups — even ones that became empty. */
export const MANAGED_STATE_KINDS = ["skill", "limit"] as const

export interface SessionRow {
  device_id: string
  tool: string
  id: string
  title: string
  project: string
  model: string
  started_at: string | null
  ended_at: string | null
  duration_ms: number
  total_tokens: number
  turns: number
  edits: number
  resume_command: string
}

export interface ToolTotals {
  tool: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  conversation_count: number
}

export interface ModelTotals extends ToolTotals {
  model: string
}

export interface ProjectTotals extends ToolTotals {
  project: string
}

export interface DayTotals extends ToolTotals {
  /** UTC date, YYYY-MM-DD. */
  day: string
}

export interface DeviceTotals extends ToolTotals {
  device_id: string
}

export interface FullTotals {
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  cache_creation_input_tokens: number
  reasoning_output_tokens: number
  total_tokens: number
  conversation_count: number
}

export interface FullDayTotals extends FullTotals {
  day: string
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

  /** Per-model totals. Conversations sit under model "unknown" by design (see collector docs). */
  totalsByModel(): ModelTotals[] {
    return this.db
      .prepare(`
        SELECT tool, model,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(total_tokens) AS total_tokens,
               SUM(conversation_count) AS conversation_count
        FROM usage_records GROUP BY tool, model ORDER BY total_tokens DESC
      `)
      .all() as ModelTotals[]
  }

  totalsByProject(): ProjectTotals[] {
    return this.db
      .prepare(`
        SELECT tool, project,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(total_tokens) AS total_tokens,
               SUM(conversation_count) AS conversation_count
        FROM usage_records GROUP BY tool, project ORDER BY total_tokens DESC
      `)
      .all() as ProjectTotals[]
  }

  /** Daily totals for the most recent `days` UTC days that have data. */
  totalsByDay(days = 14): DayTotals[] {
    return this.db
      .prepare(`
        SELECT tool, substr(hour_start, 1, 10) AS day,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(total_tokens) AS total_tokens,
               SUM(conversation_count) AS conversation_count
        FROM usage_records
        GROUP BY tool, day ORDER BY day DESC LIMIT ?
      `)
      .all(days) as DayTotals[]
  }

  /**
   * WHERE clause shared by every range query. `device` narrows to one device
   * ("" = every device) — the dashboard's device filter, mirroring
   * TokenTracker's DashboardPage deviceId scope.
   */
  private rangeWhere(
    since: string | null,
    until?: string | null,
    device?: string | null,
  ): { where: string; params: string[] } {
    const clauses: string[] = []
    const params: string[] = []
    if (since) {
      clauses.push("hour_start >= ?")
      params.push(since)
    }
    if (until) {
      clauses.push("hour_start < ?")
      params.push(until)
    }
    if (device) {
      clauses.push("device_id = ?")
      params.push(device)
    }
    return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params }
  }

  /**
   * Aggregates for a time range (hour_start >= since, and < until when given;
   * null since = all time). Shapes match the dashboard's usage page needs.
   * `device` scopes every aggregate to one device; the device *list* itself
   * comes from `deviceModelTotals`, which stays unscoped so the filter can be
   * switched or cleared from the card.
   */
  rangeSummary(since: string | null, until?: string | null, device?: string | null): {
    totals: FullTotals
    tools: (ToolTotals & { cached_input_tokens: number })[]
    models: (ModelTotals & FullTotals)[]
    days: FullDayTotals[]
    /** Grouped at (project, tool, model) so per-project cost can be priced
     *  per model and then folded — cost is never computable from totals. */
    project_models: ({ project: string; tool: string; model: string } & FullTotals)[]
  } {
    const { where, params } = this.rangeWhere(since, until, device)
    const cols = `
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(cached_input_tokens) AS cached_input_tokens,
      SUM(cache_creation_input_tokens) AS cache_creation_input_tokens,
      SUM(reasoning_output_tokens) AS reasoning_output_tokens,
      SUM(total_tokens) AS total_tokens,
      SUM(conversation_count) AS conversation_count`
    const totals = this.db
      .prepare(`SELECT ${cols} FROM usage_records ${where}`)
      .get(...params) as FullTotals
    for (const k of Object.keys(totals) as (keyof FullTotals)[]) totals[k] = totals[k] ?? 0
    return {
      totals,
      tools: this.db
        .prepare(`SELECT tool, ${cols} FROM usage_records ${where} GROUP BY tool ORDER BY 7 DESC`)
        .all(...params) as (ToolTotals & { cached_input_tokens: number })[],
      models: this.db
        .prepare(`SELECT tool, model, ${cols} FROM usage_records ${where} GROUP BY tool, model ORDER BY 8 DESC`)
        .all(...params) as (ModelTotals & FullTotals)[],
      days: this.db
        .prepare(
          `SELECT substr(hour_start, 1, 10) AS day, ${cols} FROM usage_records ${where} GROUP BY day ORDER BY day DESC LIMIT 31`,
        )
        .all(...params) as FullDayTotals[],
      project_models: this.db
        .prepare(`SELECT project, tool, model, ${cols} FROM usage_records ${where} GROUP BY project, tool, model`)
        .all(...params) as ({ project: string; tool: string; model: string } & FullTotals)[],
    }
  }

  /**
   * Range totals grouped at (device, tool, model) so per-device cost can be
   * priced per model and then folded — cost is never computable from totals.
   * Deliberately NOT device-filtered: the card lists every device that has
   * usage in the range, including the ones the filter is hiding elsewhere.
   */
  deviceModelTotals(
    since: string | null,
    until?: string | null,
  ): ({ device_id: string; tool: string; model: string } & FullTotals)[] {
    const { where, params } = this.rangeWhere(since, until)
    return this.db
      .prepare(`
        SELECT device_id, tool, model,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(cached_input_tokens) AS cached_input_tokens,
               SUM(cache_creation_input_tokens) AS cache_creation_input_tokens,
               SUM(reasoning_output_tokens) AS reasoning_output_tokens,
               SUM(total_tokens) AS total_tokens,
               SUM(conversation_count) AS conversation_count
        FROM usage_records ${where} GROUP BY device_id, tool, model
      `)
      .all(...params) as ({ device_id: string; tool: string; model: string } & FullTotals)[]
  }

  /** Per-day grand totals for the heatmap (last ~54 weeks), optionally one device. */
  heatmapDays(device?: string | null): { day: string; total_tokens: number }[] {
    const { where, params } = this.rangeWhere(null, null, device)
    return this.db
      .prepare(`
        SELECT substr(hour_start, 1, 10) AS day, SUM(total_tokens) AS total_tokens
        FROM usage_records ${where} GROUP BY day ORDER BY day DESC LIMIT 378
      `)
      .all(...params) as { day: string; total_tokens: number }[]
  }

  /** First recorded bucket start and count of distinct active days. */
  activitySpan(device?: string | null): { started: string | null; active_days: number } {
    const { where, params } = this.rangeWhere(null, null, device)
    return this.db
      .prepare(`
        SELECT MIN(hour_start) AS started,
               COUNT(DISTINCT substr(hour_start, 1, 10)) AS active_days
        FROM usage_records ${where}
      `)
      .get(...params) as { started: string | null; active_days: number }
  }

  /** Per-device totals — the cross-device home view. */
  totalsByDevice(): DeviceTotals[] {
    return this.db
      .prepare(`
        SELECT device_id, tool,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(total_tokens) AS total_tokens,
               SUM(conversation_count) AS conversation_count
        FROM usage_records GROUP BY device_id, tool ORDER BY total_tokens DESC
      `)
      .all() as DeviceTotals[]
  }

  /** Every record, for pushing to an aggregation hub. */
  allRecords(): UsageRecord[] {
    return this.db.prepare("SELECT * FROM usage_records").all() as UsageRecord[]
  }

  /** Insert or replace session metadata rows (last write wins per key). */
  upsertSessionRows(rows: SessionRow[]): number {
    const stmt = this.db.prepare(`
      INSERT INTO session_records (
        device_id, tool, id, title, project, model, started_at, ended_at,
        duration_ms, total_tokens, turns, edits, resume_command, updated_at
      ) VALUES (
        @device_id, @tool, @id, @title, @project, @model, @started_at, @ended_at,
        @duration_ms, @total_tokens, @turns, @edits, @resume_command, @updated_at
      )
      ON CONFLICT (device_id, tool, id) DO UPDATE SET
        title = excluded.title, project = excluded.project, model = excluded.model,
        started_at = excluded.started_at, ended_at = excluded.ended_at,
        duration_ms = excluded.duration_ms, total_tokens = excluded.total_tokens,
        turns = excluded.turns, edits = excluded.edits,
        resume_command = excluded.resume_command, updated_at = excluded.updated_at
    `)
    const updatedAt = new Date().toISOString()
    const run = this.db.transaction((rs: SessionRow[]) => {
      for (const r of rs) stmt.run({ ...r, updated_at: updatedAt })
      return rs.length
    })
    return run(rows)
  }

  upsertDeviceState(rows: DeviceStateRow[]): number {
    const stmt = this.db.prepare(`
      INSERT INTO device_state (device_id, kind, key, payload, updated_at)
      VALUES (@device_id, @kind, @key, @payload, @updated_at)
      ON CONFLICT (device_id, kind, key) DO UPDATE SET
        payload = excluded.payload, updated_at = excluded.updated_at
    `)
    const updatedAt = new Date().toISOString()
    const run = this.db.transaction((rs: DeviceStateRow[]) => {
      for (const r of rs) stmt.run({ updated_at: updatedAt, ...r })
      return rs.length
    })
    return run(rows)
  }

  /** Replace a device's rows of one kind (removes items that disappeared locally). */
  /**
   * Make the hub authoritative for OTHER devices' state: wipe every row not
   * belonging to selfDeviceId and insert the given rows (self rows filtered
   * out — local state is locally authoritative). Snapshot semantics: without
   * the wipe, keys deleted on the source device linger here forever.
   */
  replaceOtherDevicesState(selfDeviceId: string, rows: DeviceStateRow[]): number {
    const wipe = this.db.prepare("DELETE FROM device_state WHERE device_id != ?")
    const run = this.db.transaction(() => {
      wipe.run(selfDeviceId)
      return this.upsertDeviceState(rows.filter((r) => r.device_id !== selfDeviceId))
    })
    return run()
  }

  replaceDeviceState(deviceId: string, kind: string, rows: Omit<DeviceStateRow, "device_id" | "kind">[]): number {
    const wipe = this.db.prepare("DELETE FROM device_state WHERE device_id = ? AND kind = ?")
    const run = this.db.transaction(() => {
      wipe.run(deviceId, kind)
      return this.upsertDeviceState(rows.map((r) => ({ ...r, device_id: deviceId, kind })))
    })
    return run()
  }

  deviceState(kind?: string): DeviceStateRow[] {
    return kind
      ? (this.db.prepare("SELECT * FROM device_state WHERE kind = ?").all(kind) as DeviceStateRow[])
      : (this.db.prepare("SELECT * FROM device_state").all() as DeviceStateRow[])
  }

  allSessionRows(): SessionRow[] {
    return this.db
      .prepare("SELECT * FROM session_records ORDER BY ended_at DESC")
      .all() as SessionRow[]
  }

  countRecords(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM usage_records").get() as { n: number }
    return row.n
  }

  close(): void {
    this.db.close()
  }
}
