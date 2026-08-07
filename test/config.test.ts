import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadConfig, resolveRelayToken, starterConfigYaml } from "../src/core/config.js"

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-cfg-"))
}

function writeConfig(dir: string, content: string): void {
  fs.writeFileSync(path.join(dir, "usageplane.yaml"), content)
}

test("missing config file yields defaults", () => {
  const cfg = loadConfig(tempDir())
  assert.equal(cfg.device, os.hostname())
  assert.deepEqual(cfg.collectors, [])
  assert.deepEqual(cfg.relays, [])
})

test("full config round-trips", () => {
  const dir = tempDir()
  writeConfig(
    dir,
    `device: vps-tokyo
collectors:
  - claude-code
relays:
  - id: relay-a
    type: new-api
    base_url: https://relay-a.example.com
    token_env: RELAY_A_TOKEN
`,
  )
  const cfg = loadConfig(dir)
  assert.equal(cfg.device, "vps-tokyo")
  assert.deepEqual(cfg.collectors, ["claude-code"])
  assert.equal(cfg.relays[0].id, "relay-a")
  assert.equal(cfg.relays[0].token_env, "RELAY_A_TOKEN")
})

test("relay entry missing base_url throws with location", () => {
  const dir = tempDir()
  writeConfig(dir, `relays:\n  - id: broken\n    type: new-api\n`)
  assert.throws(() => loadConfig(dir), /relays\[0\].*base_url/)
})

test("malformed top level throws instead of silently defaulting", () => {
  const dir = tempDir()
  writeConfig(dir, `- just\n- a\n- list\n`)
  assert.throws(() => loadConfig(dir), /top level/)
})

test("resolveRelayToken: token_env wins, missing env var throws", () => {
  process.env.UP_TEST_TOKEN = "secret-from-env"
  assert.equal(
    resolveRelayToken({ id: "a", type: "new-api", base_url: "x", token: "inline", token_env: "UP_TEST_TOKEN" }),
    "secret-from-env",
  )
  delete process.env.UP_TEST_TOKEN
  assert.throws(
    () => resolveRelayToken({ id: "a", type: "new-api", base_url: "x", token_env: "UP_TEST_TOKEN" }),
    /UP_TEST_TOKEN/,
  )
  assert.equal(resolveRelayToken({ id: "a", type: "new-api", base_url: "x", token: "inline" }), "inline")
})

test("starter config parses back to valid defaults shape", () => {
  const dir = tempDir()
  writeConfig(dir, starterConfigYaml("my-device"))
  const cfg = loadConfig(dir)
  assert.equal(cfg.device, "my-device")
  assert.deepEqual(cfg.collectors, ["claude-code"])
  assert.deepEqual(cfg.relays, [])
})
