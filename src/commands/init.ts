import fs from "node:fs"
import os from "node:os"
import { starterConfigYaml } from "../core/config.js"
import { configPath, dataDir, dbPath } from "../core/paths.js"
import { Store } from "../core/store.js"

/** Create ~/.usageplane, a starter usageplane.yaml (if absent), and the database. */
export function runInit(): void {
  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true })

  const cfgFile = configPath(dir)
  if (fs.existsSync(cfgFile)) {
    console.log(`config exists, leaving untouched: ${cfgFile}`)
  } else {
    fs.writeFileSync(cfgFile, starterConfigYaml(os.hostname()))
    console.log(`created ${cfgFile}`)
  }

  const store = new Store(dbPath(dir))
  console.log(`database ready: ${dbPath(dir)} (${store.countRecords()} usage records)`)
  store.close()
}
