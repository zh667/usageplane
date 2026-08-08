// Event-driven collection, TokenTracker-style: install a Stop hook into
// Claude Code's settings so every finished response triggers a quiet
// sync (+ push when a hub is bound). No daemons, no cron — using the AI
// is itself the sync trigger.

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
// Stop hook, but single-valued: only ONE notify command can exist. When
// another tool (e.g. TokenTracker) already owns it, we chain instead of
// skipping: notify becomes `usageplane notify-chain --then <original…>`,
// which runs our sync AND re-invokes the original command with the same
// payload. The foreign command keeps working and uninstall restores it
// verbatim — nothing foreign is ever dropped.

function codexConfigPath(home: string): string {
  return path.join(home, ".codex", "config.toml")
}

/** Prefer TOML literal strings ('single-quoted', no escaping — safe for Windows
 *  paths); fall back to a basic string when the value contains a quote. */
function tomlStr(s: string): string {
  return s.includes("'") ? `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"` : `'${s}'`
}

/** Extract the string elements of a one-line TOML array (both quote styles). */
export function parseTomlNotifyArray(line: string): string[] {
  const body = line.slice(line.indexOf("=") + 1)
  const out: string[] = []
  for (const m of body.matchAll(/'([^']*)'|"((?:\\.|[^"\\])*)"/g)) {
    if (m[1] !== undefined) out.push(m[1])
    else out.push(m[2].replace(/\\(.)/g, (_, c: string) => ({ n: "\n", t: "\t", r: "\r" })[c] ?? c))
  }
  return out
}

function notifyLine(args: string[]): string {
  const bin = fileURLToPath(new URL("../../bin/usageplane.js", import.meta.url))
  return `notify = [${[process.execPath, bin, ...args].map(tomlStr).join(", ")}]`
}

function codexStatus(home: string): "installed" | "chained" | "foreign" | "not installed" {
  let raw = ""
  try {
    raw = fs.readFileSync(codexConfigPath(home), "utf8")
  } catch {
    return "not installed"
  }
  const line = raw.split("\n").find((l) => /^\s*notify\s*=/.test(l))
  if (!line) return "not installed"
  if (!line.includes(HOOK_MARK)) return "foreign"
  return line.includes("notify-chain") ? "chained" : "installed"
}

function installCodexHook(home: string): void {
  const file = codexConfigPath(home)
  const status = codexStatus(home)
  if (status === "installed" || status === "chained") {
    console.log("codex: already installed — nothing to do")
    return
  }
  let raw = ""
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch {
    /* new file */
  }
  if (status === "foreign") {
    const lines = raw.split("\n")
    const idx = lines.findIndex((l) => /^\s*notify\s*=/.test(l))
    const foreign = parseTomlNotifyArray(lines[idx])
    if (foreign.length === 0) {
      console.warn(`codex: could not parse the existing notify setting in ${file} — not touching it`)
      return
    }
    lines[idx] = notifyLine(["notify-chain", "--then", ...foreign])
    fs.writeFileSync(file, lines.join("\n"))
    console.log(`codex: chained with the existing notify command in ${file} — both tools now run on every turn`)
    return
  }
  // `notify` must sit at TOML top level — prepend so it can't land inside a [table].
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${notifyLine(["sync", "--quiet"])}\n${raw}`)
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
  let changed = false
  const kept: string[] = []
  for (const line of raw.split("\n")) {
    if (!(/^\s*notify\s*=/.test(line) && line.includes(HOOK_MARK))) {
      kept.push(line)
      continue
    }
    changed = true
    const parts = parseTomlNotifyArray(line)
    const thenIdx = parts.indexOf("--then")
    if (thenIdx !== -1 && thenIdx + 1 < parts.length) {
      // Chained install: hand notify back to the original owner.
      kept.push(`notify = [${parts.slice(thenIdx + 1).map(tomlStr).join(", ")}]`)
    }
  }
  if (!changed) {
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
