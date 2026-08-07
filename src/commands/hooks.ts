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

export function runHooks(action: string | undefined, home = os.homedir()): void {
  const file = settingsPath(home)
  const settings = readSettings(home)

  if (action === "status" || action === undefined) {
    console.log(`claude-code Stop hook: ${hasOurHook(settings) ? "installed" : "not installed"} (${file})`)
    return
  }

  if (action === "install") {
    if (hasOurHook(settings)) {
      console.log("already installed — nothing to do")
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
    return
  }

  console.error(`unknown hooks action "${action}" (use: install | uninstall | status)`)
  process.exitCode = 1
}
