import { runInit } from "./commands/init.js"
import { runRelays } from "./commands/relays.js"
import { runStatus } from "./commands/status.js"
import { runSync } from "./commands/sync.js"
import { runServe } from "./server/index.js"

const HELP = `usageplane — one control plane for all your AI usage

Usage: usageplane <command>

Commands:
  init      Create ~/.usageplane with a starter config and database
  sync      Parse client logs into the local database
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
    await runSync()
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
