import os from "node:os"
import path from "node:path"

/** Data directory: ~/.usageplane, overridable via USAGEPLANE_HOME. */
export function dataDir(): string {
  return process.env.USAGEPLANE_HOME ?? path.join(os.homedir(), ".usageplane")
}

export function dbPath(dir = dataDir()): string {
  return path.join(dir, "usageplane.db")
}

export function configPath(dir = dataDir()): string {
  return path.join(dir, "usageplane.yaml")
}
