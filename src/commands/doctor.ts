// Environment diagnostics — made for debugging a remote machine over chat:
// the user pastes this output and the state of every data source is visible.
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { loadConfig } from "../core/config.js"
import { dataDir, dbPath } from "../core/paths.js"

function check(label: string, p: string, extra = ""): void {
  const exists = fs.existsSync(p)
  console.log(`  ${exists ? "✓" : "✗"} ${label}: ${p}${exists && extra ? ` ${extra}` : ""}`)
}

function countFiles(dir: string, suffix: string): number {
  let n = 0
  const walk = (d: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(d, e.name))
      else if (e.name.endsWith(suffix)) n++
    }
  }
  walk(dir)
  return n
}

export function runDoctor(): void {
  const home = os.homedir()
  console.log(`usageplane doctor — ${os.hostname()} (${process.platform})\n`)

  console.log("data sources:")
  const claudeProjects = path.join(home, ".claude", "projects")
  check("claude logs", claudeProjects, `(${countFiles(claudeProjects, ".jsonl")} jsonl)`)
  const codexSessions = path.join(home, ".codex", "sessions")
  check("codex logs", codexSessions, `(${countFiles(codexSessions, ".jsonl")} jsonl)`)
  check("codex title index", path.join(home, ".codex", "session_index.jsonl"))

  console.log("credentials (presence only — contents never printed):")
  check("claude oauth", path.join(home, ".claude", ".credentials.json"))
  check("codex auth", path.join(home, ".codex", "auth.json"))

  console.log("usageplane:")
  check("config", path.join(dataDir(), "usageplane.yaml"))
  check("database", dbPath())
  try {
    const cfg = loadConfig(dataDir())
    console.log(`  device=${cfg.device} collectors=[${cfg.collectors.join(", ")}] hub=${cfg.hub?.url ?? "none"}`)
  } catch (err) {
    console.log(`  ✗ config parse failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
