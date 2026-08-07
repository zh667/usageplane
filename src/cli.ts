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
  hooks     install | uninstall | status — event-driven sync via Claude Code Stop hook
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
