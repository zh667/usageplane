// Event-driven collection, TokenTracker-style: install a Stop hook into
// Claude Code's settings so every finished response triggers a quiet
// sync (+ push when a hub is bound). No daemons, no cron — using the AI
// is itself the sync trigger. Codex hook lands with Windows testing.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const HOOK_MARK = "usageplane"

interface HookEntry {
  matcher?: string
  hooks?: { type?: string; command?: string }[]
}

function settingsPath(home: string): string {
  return path.join(home, ".claude", "settings.json")
}

function hookCommand(): string {
  const bin = fileURLToPath(new URL("../../bin/usageplane.js", import.meta.url))
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(bin)} sync --quiet`
}

function readSettings(home: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(home), "utf8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function stopHooks(settings: Record<string, unknown>): HookEntry[] {
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>
  return Array.isArray(hooks.Stop) ? (hooks.Stop as HookEntry[]) : []
}

function hasOurHook(settings: Record<string, unknown>): boolean {
  return stopHooks(settings).some((e) => e.hooks?.some((h) => h.command?.includes(HOOK_MARK)))
}

// --- Codex: notify command in ~/.codex/config.toml ----------------------
// Codex executes `notify` on every turn end — the TOML analog of Claude's
// Stop hook. We only ever touch a line we wrote (contains "usageplane");
// a foreign notify setting is reported, never overwritten.

function codexConfigPath(home: string): string {
  return path.join(home, ".codex", "config.toml")
}

/** TOML literal strings ('single-quoted') need no backslash escaping — safe for Windows paths. */
function codexNotifyLine(): string {
  const bin = fileURLToPath(new URL("../../bin/usageplane.js", import.meta.url))
  return `notify = ['${process.execPath}', '${bin}', 'sync', '--quiet']`
}

function codexStatus(home: string): "installed" | "foreign" | "not installed" {
  let raw = ""
  try {
    raw = fs.readFileSync(codexConfigPath(home), "utf8")
  } catch {
    return "not installed"
  }
  const line = raw.split("\n").find((l) => /^\s*notify\s*=/.test(l))
  if (!line) return "not installed"
  return line.includes(HOOK_MARK) ? "installed" : "foreign"
}

function installCodexHook(home: string): void {
  const file = codexConfigPath(home)
  const status = codexStatus(home)
  if (status === "installed") {
    console.log("codex: already installed — nothing to do")
    return
  }
  if (status === "foreign") {
    console.warn(`codex: ${file} already has a notify setting from another tool — not touching it`)
    return
  }
  let raw = ""
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch {
    /* new file */
  }
  // `notify` must sit at TOML top level — prepend so it can't land inside a [table].
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${codexNotifyLine()}\n${raw}`)
  console.log(`codex: installed notify hook in ${file}`)
}

function uninstallCodexHook(home: string): void {
  const file = codexConfigPath(home)
  let raw = ""
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch {
    console.log("codex: no config.toml — nothing to do")
    return
  }
  const kept = raw.split("\n").filter((l) => !(/^\s*notify\s*=/.test(l) && l.includes(HOOK_MARK)))
  if (kept.join("\n") === raw) {
    console.log("codex: no usageplane notify found — nothing to do")
    return
  }
  fs.writeFileSync(file, kept.join("\n"))
  console.log(`codex: removed notify hook from ${file}`)
}

export function runHooks(action: string | undefined, home = os.homedir()): void {
  const file = settingsPath(home)
  const settings = readSettings(home)

  if (action === "status" || action === undefined) {
    console.log(`claude-code Stop hook: ${hasOurHook(settings) ? "installed" : "not installed"} (${file})`)
    console.log(`codex notify hook: ${codexStatus(home)} (${codexConfigPath(home)})`)
    return
  }

  if (action === "install") {
    if (hasOurHook(settings)) {
      console.log("claude-code: already installed — nothing to do")
      installCodexHook(home)
      return
    }
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>
    const stop = stopHooks(settings)
    stop.push({ hooks: [{ type: "command", command: hookCommand() }] })
    hooks.Stop = stop
    settings.hooks = hooks
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n")
    console.log(`installed Stop hook in ${file}`)
    console.log("every Claude Code response now triggers a quiet sync (+push when a hub is configured)")
    installCodexHook(home)
    return
  }

  if (action === "uninstall") {
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>
    const kept = stopHooks(settings).filter((e) => !e.hooks?.some((h) => h.command?.includes(HOOK_MARK)))
    if (kept.length === stopHooks(settings).length) {
      console.log("no usageplane hook found — nothing to do")
      return
    }
    if (kept.length > 0) hooks.Stop = kept
    else delete hooks.Stop
    settings.hooks = hooks
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n")
    console.log(`removed usageplane hook from ${file}`)
    uninstallCodexHook(home)
    return
  }

  console.error(`unknown hooks action "${action}" (use: install | uninstall | status)`)
  process.exitCode = 1
}
