import { runInit } from "./commands/init.js"

const HELP = `usageplane — one control plane for all your AI usage

Usage: usageplane <command>

Commands:
  init      Create ~/.usageplane with a starter config and database
  sync      (planned, M2) Parse client logs into the local database
  status    (planned, M4) Print usage and relay-asset summary
  serve     (planned, M4) Local dashboard server

Env:
  USAGEPLANE_HOME   Override the data directory (default ~/.usageplane)
`

const command = process.argv[2]

switch (command) {
  case "init":
    runInit()
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
