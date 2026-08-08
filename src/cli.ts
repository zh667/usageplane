import { runDoctor } from "./commands/doctor.js"
import { runHooks } from "./commands/hooks.js"
import { runInit } from "./commands/init.js"
import { runPull } from "./commands/pull.js"
import { runPush } from "./commands/push.js"
import { runRelays } from "./commands/relays.js"
import { runStatus } from "./commands/status.js"
import { runSync } from "./commands/sync.js"
import { runServe } from "./server/index.js"

const HELP = `usageplane — one control plane for all your AI usage

Usage: usageplane <command>

Commands:
  init      Create ~/.usageplane with a starter config and database
  sync      Parse client logs into the local database (auto-pushes when a hub is set)
  hooks     install | uninstall | status — event-driven sync (Claude Stop hook + Codex notify)
  doctor    Diagnose data sources, credentials presence, and config on this machine
  push      Send local records to the aggregation hub (see hub in usageplane.yaml)
  pull      Fetch the hub's records so this device shows the merged view
  relays    Query configured relay sites' balances
  status    Print usage and relay-asset summary
  serve     Local dashboard server (default http://127.0.0.1:7690)

Env:
  USAGEPLANE_HOME   Override the data directory (default ~/.usageplane)
  USAGEPLANE_PORT   Dashboard port for serve (default 7690)
`

const command = process.argv[2]

switch (command) {
  case "init":
    runInit()
    break
  case "sync":
    await runSync({ quiet: process.argv.includes("--quiet") })
    break
  case "hooks":
    runHooks(process.argv[3])
    break
  case "notify-chain": {
    // Installed by `hooks install` when another tool already owns Codex's
    // single notify slot: run our sync, then re-invoke the original command
    // (everything after --then) with the payload Codex appended as last arg.
    const rest = process.argv.slice(3)
    const thenIdx = rest.indexOf("--then")
    const original = thenIdx === -1 ? [] : rest.slice(thenIdx + 1)
    if (original.length > 0) {
      const { spawn } = await import("node:child_process")
      try {
        spawn(original[0], original.slice(1), { stdio: "ignore", detached: true }).unref()
      } catch {
        /* the foreign tool's failure must never block our sync */
      }
    }
    await runSync({ quiet: true })
    break
  }
  case "doctor":
    runDoctor()
    break
  case "push":
    await runPush(process.argv[3])
    break
  case "pull":
    await runPull(process.argv[3])
    break
  case "relays":
    await runRelays()
    break
  case "status":
    await runStatus()
    break
  case "serve":
    runServe(Number(process.env.USAGEPLANE_PORT) || 7690)
    break
  case undefined:
  case "help":
  case "--help":
  case "-h":
    console.log(HELP)
    break
  default:
    console.error(`unknown command: ${command}\n`)
    console.log(HELP)
    process.exitCode = 1
}
