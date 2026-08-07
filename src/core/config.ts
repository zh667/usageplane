import fs from "node:fs"
import os from "node:os"
import { parse } from "yaml"
import { configPath, dataDir } from "./paths.js"

/** A relay site the user manages. `type` follows docs/relay-sites.md family buckets. */
export interface RelayConfig {
  /** User-chosen stable id, e.g. "relay-a". Referenced by UsageRecord.relay_id. */
  id: string
  /** Architecture bucket: "new-api" | "one-api" | "veloera" | ... */
  type: string
  base_url: string
  /** Access token, or prefer token_env to keep secrets out of the file. */
  token?: string
  /** Name of an environment variable holding the token. Wins over `token`. */
  token_env?: string
  /** Site user id — sent as New-API-User/… compat headers; some forks require it. */
  user_id?: number | string
  /**
   * Display currency symbol, default "$". Sites choose their own display
   * currency (¥ is common) while the underlying unit stays quota/500000 —
   * this affects display only, never conversion.
   */
  currency?: string
}

export interface UsagePlaneConfig {
  /** Stable device name; defaults to os.hostname(). */
  device: string
  /** Enabled collector ids, e.g. ["claude-code"]. */
  collectors: string[]
  relays: RelayConfig[]
}

export function defaultConfig(): UsagePlaneConfig {
  return { device: os.hostname(), collectors: [], relays: [] }
}

/**
 * Load config from <dataDir>/usageplane.yaml.
 * A missing file yields defaults; a malformed file throws (never silently ignore).
 */
export function loadConfig(dir = dataDir()): UsagePlaneConfig {
  const file = configPath(dir)
  if (!fs.existsSync(file)) return defaultConfig()

  const raw: unknown = parse(fs.readFileSync(file, "utf8"))
  if (raw === null || raw === undefined) return defaultConfig()
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${file}: top level must be a mapping`)
  }
  const cfg = raw as Partial<UsagePlaneConfig>
  const out = defaultConfig()

  if (cfg.device !== undefined) {
    if (typeof cfg.device !== "string" || cfg.device.trim() === "") {
      throw new Error(`${file}: "device" must be a non-empty string`)
    }
    out.device = cfg.device.trim()
  }
  if (cfg.collectors !== undefined) {
    if (!Array.isArray(cfg.collectors) || cfg.collectors.some((c) => typeof c !== "string")) {
      throw new Error(`${file}: "collectors" must be a list of strings`)
    }
    out.collectors = cfg.collectors
  }
  if (cfg.relays !== undefined) {
    if (!Array.isArray(cfg.relays)) throw new Error(`${file}: "relays" must be a list`)
    out.relays = cfg.relays.map((r, i) => validateRelay(r, `${file}: relays[${i}]`))
  }
  return out
}

function validateRelay(r: unknown, where: string): RelayConfig {
  if (typeof r !== "object" || r === null) throw new Error(`${where}: must be a mapping`)
  const relay = r as Partial<RelayConfig>
  for (const field of ["id", "type", "base_url"] as const) {
    if (typeof relay[field] !== "string" || relay[field].trim() === "") {
      throw new Error(`${where}: "${field}" is required`)
    }
  }
  return relay as RelayConfig
}

/** Resolve a relay's access token: token_env (if set) wins over inline token. */
export function resolveRelayToken(relay: RelayConfig): string | undefined {
  if (relay.token_env) {
    const v = process.env[relay.token_env]
    if (!v) throw new Error(`relay "${relay.id}": env var ${relay.token_env} is not set`)
    return v
  }
  return relay.token
}

/** Starter config written by `usageplane init`. */
export function starterConfigYaml(device: string): string {
  return `# UsagePlane configuration — see docs/ARCHITECTURE.md
device: ${device}

# Enabled collectors. Available: claude-code (codex planned)
collectors:
  - claude-code

# Relay sites. Prefer token_env over inline token to keep secrets out of this file.
# user_id is the site's numeric user id (shown in the site's profile page);
# some new-api forks require it as a header.
relays: []
#  - id: relay-a
#    type: new-api
#    base_url: https://relay-a.example.com
#    token_env: RELAY_A_TOKEN
#    user_id: 123
`
}
