// Session list extraction — the data behind the Sessions page (browse local
// Claude Code / Codex sessions, copy a resume command). Modeled on
// TokenTracker's sessions feature; parsing reuses our collectors' helpers.
// Privacy note: session titles are CONTENT-adjacent. They are served to the
// local dashboard only and must never enter usage_records or hub pushes.

import fssync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import readline from "node:readline"
import { listClaudeSessionFiles, normalizeClaudeUsage, claudeMessageDedupKey } from "../collectors/claude-code.js"
import { codexSessionIdFromPath, extractTokenCount, listRolloutFiles, normalizeCodexUsage } from "../collectors/codex.js"
import { consumeUsageDelta, createUsageDeltaState } from "../collectors/codex-token-usage.js"

export interface SessionInfo {
  id: string
  tool: "claude-code" | "codex"
  title: string
  project: string
  model: string
  started_at: string | null
  ended_at: string | null
  duration_ms: number
  total_tokens: number
  turns: number
  edits: number
  /** Paste-ready resume command, e.g. `claude --resume <id>`. */
  resume_command: string
}

const EDIT_TOOLS = /"name":\s*"(Edit|Write|MultiEdit|NotebookEdit)"/

export async function listSessions(opts: { claudeHome?: string; codexHome?: string } = {}): Promise<SessionInfo[]> {
  const claudeHome = opts.claudeHome ?? path.join(os.homedir(), ".claude")
  const codexHome = opts.codexHome ?? path.join(os.homedir(), ".codex")

  const claudeFiles = (await listClaudeSessionFiles(path.join(claudeHome, "projects"))).filter(
    (f) => !/[\\/]subagents[\\/]/.test(f),
  )
  const codexFiles = [
    ...(await listRolloutFiles(path.join(codexHome, "sessions"))),
    ...(await listRolloutFiles(path.join(codexHome, "archived_sessions"))),
  ]

  const sessions: SessionInfo[] = []
  for (const f of claudeFiles) {
    const s = await scanClaudeSession(f).catch(() => null)
    if (s) sessions.push(s)
  }
  const codexTitles = await loadCodexTitleIndex(codexHome)
  const seenCodex = new Set<string>()
  for (const f of codexFiles) {
    const id = codexSessionIdFromPath(f)
    if (id && seenCodex.has(id)) continue
    if (id) seenCodex.add(id)
    const s = await scanCodexSession(f, codexTitles).catch(() => null)
    if (s) sessions.push(s)
  }

  sessions.sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""))
  return sessions
}

async function scanClaudeSession(filePath: string): Promise<SessionInfo | null> {
  const stream = fssync.createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  const id = path.basename(filePath, ".jsonl")
  let title = ""
  let summary = ""
  let aiTitle = ""
  let project = ""
  let model = ""
  let first: string | null = null
  let last: string | null = null
  let totalTokens = 0
  let turns = 0
  let edits = 0
  const seen = new Set<string>()

  for await (const line of rl) {
    if (!line) continue
    if (EDIT_TOOLS.test(line)) edits++
    // Claude writes its own generated one-line title as an "ai-title" record;
    // prefer it (agent-authored) over summary, then over the first user line.
    if (!aiTitle && line.includes('"type":"ai-title"')) {
      const obj = tryParse(line)
      if (typeof obj?.aiTitle === "string") aiTitle = obj.aiTitle.replace(/\s+/g, " ").trim()
      continue
    }
    if (!summary && line.includes('"type":"summary"')) {
      const obj = tryParse(line)
      if (typeof obj?.summary === "string") summary = obj.summary
      continue
    }
    const needParse =
      line.includes('"usage"') || line.includes('"type":"user"') || (!project && line.includes('"cwd"'))
    if (!needParse) continue
    const obj = tryParse(line)
    if (!obj) continue

    const ts = typeof obj.timestamp === "string" ? obj.timestamp : null
    if (ts) {
      if (!first) first = ts
      last = ts
    }
    if (!project && typeof obj.cwd === "string" && obj.cwd.trim()) project = path.basename(obj.cwd.trim())

    if (obj.type === "user") {
      const content = (obj as { message?: { content?: unknown } }).message?.content
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? ((content.find((b) => (b as { type?: string })?.type === "text") as { text?: string } | undefined)?.text ?? "")
            : ""
      if (text) {
        turns++
        if (!title) title = text.replace(/\s+/g, " ").trim().slice(0, 120)
      }
      continue
    }

    const usage = (obj as { message?: { usage?: unknown; model?: unknown } }).message?.usage
    if (usage && typeof usage === "object") {
      const key = claudeMessageDedupKey(obj)
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      totalTokens += normalizeClaudeUsage(usage as Record<string, unknown>).total_tokens
      const m = (obj as { message?: { model?: unknown } }).message?.model
      if (typeof m === "string" && m) model = m
    }
  }
  rl.close()
  stream.close?.()

  if (turns === 0 && totalTokens === 0) return null
  return {
    id,
    tool: "claude-code",
    title: aiTitle || summary || title || "(untitled session)",
    project,
    model: model || "unknown",
    started_at: first,
    ended_at: last,
    duration_ms: first && last ? Math.max(0, Date.parse(last) - Date.parse(first)) : 0,
    total_tokens: totalTokens,
    turns,
    edits,
    resume_command: `claude --resume ${id}`,
  }
}

/**
 * Codex writes its own thread titles to ~/.codex/session_index.jsonl
 * ({id, thread_name} lines) — agent-authored metadata, the same source
 * TokenTracker uses. We never derive codex titles from message content.
 */
async function loadCodexTitleIndex(codexHome: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  const raw = await fs.readFile(path.join(codexHome, "session_index.jsonl"), "utf8").catch(() => "")
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    const obj = tryParse(line)
    const id = typeof obj?.id === "string" ? obj.id : null
    const name = typeof obj?.thread_name === "string" ? obj.thread_name.replace(/\s+/g, " ").trim() : ""
    if (id && name) titles.set(id, name.slice(0, 120))
  }
  return titles
}

async function scanCodexSession(filePath: string, titles: Map<string, string>): Promise<SessionInfo | null> {
  const stream = fssync.createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  const id = codexSessionIdFromPath(filePath) ?? path.basename(filePath, ".jsonl")
  let project = ""
  let model = ""
  let first: string | null = null
  let last: string | null = null
  let totalTokens = 0
  let turns = 0
  const deltaState = createUsageDeltaState()

  for await (const line of rl) {
    if (!line) continue
    const relevant =
      line.includes('"token_count"') || line.includes('"turn_context"') || line.includes('"session_meta"')
    if (!relevant) continue
    const obj = tryParse(line)
    if (!obj) continue

    if ((obj.type === "turn_context" || obj.type === "session_meta") && obj.payload && typeof obj.payload === "object") {
      const payload = obj.payload as Record<string, unknown>
      if (typeof payload.model === "string" && payload.model.trim()) model = payload.model.trim()
      if (typeof payload.cwd === "string" && payload.cwd.trim()) project = path.basename(payload.cwd.trim())
      continue
    }

    const token = extractTokenCount(obj)
    if (!token?.info || !token.timestamp) continue
    const info = token.info as Record<string, unknown>
    const rawDelta = consumeUsageDelta(deltaState, info.last_token_usage, info.total_token_usage)
    if (!rawDelta) continue
    const delta = normalizeCodexUsage(rawDelta)
    if (delta.total_tokens === 0) continue
    totalTokens += delta.total_tokens
    turns++
    if (!first) first = token.timestamp
    last = token.timestamp
  }
  rl.close()
  stream.close?.()

  if (turns === 0) return null
  return {
    id,
    tool: "codex",
    title: titles.get(id) || (project ? `Codex · ${project}` : "Codex session"),
    project,
    model: model || "unknown",
    started_at: first,
    ended_at: last,
    duration_ms: first && last ? Math.max(0, Date.parse(last) - Date.parse(first)) : 0,
    total_tokens: totalTokens,
    turns,
    edits: 0,
    resume_command: `codex resume ${id}`,
  }
}

function tryParse(line: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(line)
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Session list cache — parsing every log on each request is wasteful. */
let cache: { at: number; data: SessionInfo[] } | null = null
export async function listSessionsCached(ttlMs = 60_000): Promise<SessionInfo[]> {
  if (cache && Date.now() - cache.at < ttlMs) return cache.data
  const data = await listSessions()
  cache = { at: Date.now(), data }
  return data
}
