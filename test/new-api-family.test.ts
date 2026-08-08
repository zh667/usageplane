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

function fakeFetchByPath(routes: Record<string, unknown>): typeof fetch {
  return (async (url: unknown) => {
    const path = new URL(String(url)).pathname
    const body = routes[path]
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body }
  }) as unknown as typeof fetch
}

test("sk- tokens use key-scoped billing endpoints instead of /api/user/self", async () => {
  const fn = fakeFetchByPath({
    "/dashboard/billing/subscription": { hard_limit_usd: 5 },
    "/dashboard/billing/usage": { total_usage: 100 },
  })
  const b = await newApiFamilyAdapter.fetchBalance(relay({ token: "sk-abc" }), fn)
  assert.equal(b.scope, "key")
  assert.equal(b.used_usd, 1)
  assert.equal(b.balance_usd, 4)
  assert.equal(b.unlimited, false)
})

test("sk- token with sentinel hard limit reports unlimited, no balance", async () => {
  const fn = fakeFetchByPath({
    "/dashboard/billing/subscription": { hard_limit_usd: 100_000_000 },
    "/dashboard/billing/usage": { total_usage: 33.3592 },
  })
  const b = await newApiFamilyAdapter.fetchBalance(relay({ token: "sk-abc" }), fn)
  assert.equal(b.unlimited, true)
  assert.equal(b.balance_usd, undefined)
  assert.equal(b.used_usd, 0.333592)
})

test("registry: new-api and one-api resolve, unknown types do not", () => {
  assert.equal(getAdapter("new-api"), newApiFamilyAdapter)
  assert.equal(getAdapter("one-api"), newApiFamilyAdapter)
  assert.equal(getAdapter("sub2api"), undefined)
  assert.deepEqual(supportedTypes(), ["new-api", "one-api"])
})

// --- today usage (usage_log capability) ---------------------------------

/** Route by pathname; /api/log/self additionally dispatches on the page param. */
function fakeLogFetch(pages: unknown[], stat?: unknown): typeof fetch {
  return (async (url: unknown) => {
    const u = new URL(String(url))
    let body: unknown
    if (u.pathname === "/api/log/self/stat") body = stat
    else if (u.pathname === "/api/log/self") body = pages[Number(u.searchParams.get("p")) - 1]
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: async () => ({ success: true, data: body }),
    }
  }) as unknown as typeof fetch
}

const row = (model: string, quota: number, prompt = 10, completion = 5) => ({
  model_name: model,
  quota,
  prompt_tokens: prompt,
  completion_tokens: completion,
})

test("today usage: paginates logs, groups by model, stat quota is authoritative", async () => {
  const page1 = { items: Array.from({ length: 100 }, () => row("gpt-x", 1000)), total: 150 }
  const page2 = { items: Array.from({ length: 50 }, () => row("claude-y", 2000)), total: 150 }
  const fn = fakeLogFetch([page1, page2], { quota: 250_000 })

  const u = await newApiFamilyAdapter.fetchTodayUsage!(relay(), fn)
  assert.equal(u.requests, 150)
  assert.equal(u.quota, 250_000) // stat wins over summed rows (100*1000 + 50*2000 = 200000)
  assert.equal(u.usd, 0.5)
  assert.equal(u.prompt_tokens, 1500)
  assert.equal(u.completion_tokens, 750)
  assert.equal(u.partial, false)
  // Sorted by quota descending: claude-y (100k) over gpt-x (100k)? equal — check membership precisely.
  assert.deepEqual(
    u.models.map((m) => `${m.model}:${m.quota}:${m.requests}`).sort(),
    ["claude-y:100000:50", "gpt-x:100000:100"],
  )
  assert.equal(u.models[0].usd, u.models[0].quota / QUOTA_PER_UNIT)
})

test("today usage: stat endpoint missing → summed rows stand; bare-array payload accepted", async () => {
  // Older forks return a bare array with no total — treated as a single page.
  const fn = fakeLogFetch([[row("m1", 5000), row("m1", 3000), null]])
  const u = await newApiFamilyAdapter.fetchTodayUsage!(relay(), fn)
  assert.equal(u.quota, 8000)
  assert.equal(u.requests, 2) // non-object rows are skipped entirely (upstream row validity semantics)
  assert.equal(u.models.length, 1)
  assert.equal(u.models[0].model, "m1")
})

test("today usage: rows without model_name fall to unknown; non-finite fields skipped", async () => {
  const fn = fakeLogFetch([{ items: [{ quota: 100 }, row("m2", "NaN-ish")], total: 2 }])
  const u = await newApiFamilyAdapter.fetchTodayUsage!(relay(), fn)
  assert.equal(u.quota, 100)
  assert.deepEqual(u.models.map((m) => m.model).sort(), ["m2", "unknown"])
})

test("today usage: sk- keys are rejected with a helpful message", async () => {
  await assert.rejects(
    () => newApiFamilyAdapter.fetchTodayUsage!(relay({ token: "sk-abc" }), fakeLogFetch([])),
    /access token/,
  )
})

test("today usage: query carries upstream's exact param contract", async () => {
  const seen: string[] = []
  const fn = (async (url: unknown) => {
    seen.push(String(url))
    return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [], total: 0 } }) }
  }) as unknown as typeof fetch
  await newApiFamilyAdapter.fetchTodayUsage!(relay(), fn)
  const q = new URL(seen[0]).searchParams
  assert.equal(q.get("type"), "2")
  assert.equal(q.get("page_size"), "100")
  assert.equal(q.get("token_name"), "")
  assert.equal(q.get("group"), "")
  const start = Number(q.get("start_timestamp"))
  const end = Number(q.get("end_timestamp"))
  assert.ok(end - start === 86399, "local-day boundary spans 23:59:59")
})
