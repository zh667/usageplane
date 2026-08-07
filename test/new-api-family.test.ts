import { test } from "node:test"
import assert from "node:assert/strict"
import type { RelayConfig } from "../src/core/config.js"
import { newApiFamilyAdapter, QUOTA_PER_UNIT, buildHeaders } from "../src/relays/common/newApiFamily.js"
import { getAdapter, supportedTypes } from "../src/relays/index.js"

function relay(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return { id: "r1", type: "new-api", base_url: "https://relay.example.com", token: "tok-123", ...overrides }
}

function fakeFetch(body: unknown, status = 200): { fn: typeof fetch; calls: { url: string; headers: Record<string, string> }[] } {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fn = (async (url: unknown, init?: { headers?: unknown }) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }
  }) as unknown as typeof fetch
  return { fn, calls }
}

test("fetchBalance hits /api/user/self with Bearer auth and converts quota to USD", async () => {
  const { fn, calls } = fakeFetch({ success: true, data: { quota: 1_000_000, used_quota: 250_000 } })
  const b = await newApiFamilyAdapter.fetchBalance(relay(), fn)

  assert.equal(calls[0].url, "https://relay.example.com/api/user/self")
  assert.equal(calls[0].headers.Authorization, "Bearer tok-123")
  assert.equal(b.quota, 1_000_000)
  assert.equal(b.balance_usd, 1_000_000 / QUOTA_PER_UNIT)
  assert.equal(b.used_usd, 0.5)
})

test("trailing slash in base_url does not produce a double slash", async () => {
  const { fn, calls } = fakeFetch({ success: true, data: { quota: 0 } })
  await newApiFamilyAdapter.fetchBalance(relay({ base_url: "https://relay.example.com/" }), fn)
  assert.equal(calls[0].url, "https://relay.example.com/api/user/self")
})

test("user_id fans out across all compat headers; absent user_id sends none", () => {
  const withId = buildHeaders(relay({ user_id: 42 }))
  assert.equal(withId["New-API-User"], "42")
  assert.equal(withId["Veloera-User"], "42")
  assert.equal(withId["X-Api-User"], "42")

  const withoutId = buildHeaders(relay())
  assert.ok(!("New-API-User" in withoutId))
})

test("token_env wins over inline token in headers", () => {
  process.env.UP_RELAY_TEST_TOKEN = "env-tok"
  const h = buildHeaders(relay({ token_env: "UP_RELAY_TEST_TOKEN" }))
  assert.equal(h.Authorization, "Bearer env-tok")
  delete process.env.UP_RELAY_TEST_TOKEN
})

test("business error (success:false) throws the upstream message", async () => {
  const { fn } = fakeFetch({ success: false, message: "无权进行此操作" })
  await assert.rejects(() => newApiFamilyAdapter.fetchBalance(relay(), fn), /无权进行此操作/)
})

test("HTTP error and missing data field throw with relay id and endpoint", async () => {
  const { fn } = fakeFetch({}, 401)
  await assert.rejects(() => newApiFamilyAdapter.fetchBalance(relay(), fn), /r1.*HTTP 401.*\/api\/user\/self/)

  const { fn: fn2 } = fakeFetch({ success: true })
  await assert.rejects(() => newApiFamilyAdapter.fetchBalance(relay(), fn2), /no data field/)
})

test("registry: new-api and one-api resolve, unknown types do not", () => {
  assert.equal(getAdapter("new-api"), newApiFamilyAdapter)
  assert.equal(getAdapter("one-api"), newApiFamilyAdapter)
  assert.equal(getAdapter("sub2api"), undefined)
  assert.deepEqual(supportedTypes(), ["new-api", "one-api"])
})
