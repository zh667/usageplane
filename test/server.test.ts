import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"
import { Store } from "../src/core/store.js"
import { createServer } from "../src/server/index.js"
import type { UsageRecord } from "../src/core/types.js"

function seededDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-srv-"))
  const store = new Store(path.join(dir, "usageplane.db"))
  const rec: UsageRecord = {
    device_id: "test",
    tool: "claude-code",
    project: "proj-a",
    source_kind: "unknown",
    model: "claude-sonnet-5",
    hour_start: "2026-08-07T09:00:00.000Z",
    input_tokens: 10,
    output_tokens: 20,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 30,
    conversation_count: 2,
  }
  store.upsertUsage([rec, { ...rec, hour_start: "2026-08-06T10:00:00.000Z", project: "proj-b" }])
  store.close()
  return dir
}

async function withServer<T>(dir: string, fn: (base: string) => Promise<T>): Promise<T> {
  const server = createServer(dir)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
  }
}

test("/api/summary aggregates tools, models, projects, days", async () => {
  await withServer(seededDir(), async (base) => {
    const s = await fetch(`${base}/api/summary`).then((r) => r.json())
    assert.equal(s.record_count, 2)
    assert.equal(s.tools[0].tool, "claude-code")
    assert.equal(s.tools[0].total_tokens, 60)
    assert.equal(s.models[0].model, "claude-sonnet-5")
    assert.deepEqual(s.projects.map((p: { project: string }) => p.project).sort(), ["proj-a", "proj-b"])
    assert.equal(s.days.length, 2)
    assert.equal(s.days[0].day, "2026-08-07")
  })
})

test("/api/relays returns [] with no relays configured; / serves the dashboard; unknown api 404s", async () => {
  await withServer(seededDir(), async (base) => {
    const relays = await fetch(`${base}/api/relays`).then((r) => r.json())
    assert.deepEqual(relays, [])

    const page = await fetch(base)
    assert.equal(page.status, 200)
    assert.match(page.headers.get("content-type") ?? "", /text\/html/)
    assert.match(await page.text(), /UsagePlane|root/)

    // SPA fallback: extension-less page routes serve the app shell…
    const spa = await fetch(`${base}/sessions`)
    assert.equal(spa.status, 200)
    assert.match(spa.headers.get("content-type") ?? "", /text\/html/)
    // …but unknown API endpoints still 404 as JSON.
    const missing = await fetch(`${base}/api/nope`)
    assert.equal(missing.status, 404)
  })
})

test("/api/usage aggregates a range with full columns; bad range 400s", async () => {
  await withServer(seededDir(), async (base) => {
    const usage = await fetch(`${base}/api/usage?range=total`).then((r) => r.json())
    assert.equal(usage.totals.total_tokens, 60)
    assert.equal(usage.totals.conversation_count, 4)
    assert.equal(usage.tools[0].tool, "claude-code")
    assert.equal(usage.days.length, 2)
    assert.equal(typeof usage.active_days, "number")

    const bad = await fetch(`${base}/api/usage?range=bogus`)
    assert.equal(bad.status, 400)

    const heat = await fetch(`${base}/api/heatmap`).then((r) => r.json())
    assert.equal(heat.length, 2)
  })
})

test("/api/ingest: 403 without hub token config, 401 with bad token, upserts with good token", async () => {
  const dir = seededDir()
  await withServer(dir, async (base) => {
    const rec = {
      device_id: "windows-pc", tool: "codex", project: "p", source_kind: "unknown",
      model: "gpt-5.4", hour_start: "2026-08-07T11:00:00.000Z",
      input_tokens: 5, output_tokens: 5, cached_input_tokens: 0,
      cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
      total_tokens: 10, conversation_count: 1,
    }
    const post = (token?: string) =>
      fetch(`${base}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ records: [rec] }),
      })

    assert.equal((await post("any")).status, 403, "no hub token configured → ingest disabled")

    fs.writeFileSync(path.join(dir, "usageplane.yaml"), "hub:\n  token: s3cret\n")
    assert.equal((await post("wrong")).status, 401)
    assert.equal((await post()).status, 401)

    const ok = await post("s3cret")
    assert.equal(ok.status, 200)
    const body = await ok.json()
    assert.equal(body.upserted, 1)
    assert.equal(body.total, 3)

    const summary = await fetch(`${base}/api/summary`).then((r) => r.json())
    const win = summary.devices.find((d: { device_id: string }) => d.device_id === "windows-pc")
    assert.equal(win?.total_tokens, 10)
  })
})

test("session metadata flows: ingest → export → /api/sessions shows remote device rows", async () => {
  const dir = seededDir()
  fs.writeFileSync(path.join(dir, "usageplane.yaml"), "device: hub-dev\nhub:\n  token: s3cret\n")
  await withServer(dir, async (base) => {
    const session = {
      device_id: "windows-pc", tool: "codex", id: "s-1", title: "Refactor parser",
      project: "p", model: "gpt-5.4", started_at: "2026-08-07T09:00:00Z",
      ended_at: "2026-08-07T10:00:00Z", duration_ms: 3600000, total_tokens: 100,
      turns: 3, edits: 1, resume_command: "codex resume s-1",
    }
    const ok = await fetch(`${base}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer s3cret" },
      body: JSON.stringify({ records: [], sessions: [session] }),
    })
    assert.equal((await ok.json()).sessions_upserted, 1)

    const exported = await fetch(`${base}/api/export`, { headers: { authorization: "Bearer s3cret" } }).then((r) => r.json())
    assert.equal(exported.sessions.length, 1)

    const merged = await fetch(`${base}/api/sessions`).then((r) => r.json())
    assert.equal(merged.device, "hub-dev")
    const remote = merged.sessions.find((s: { id: string }) => s.id === "s-1")
    assert.equal(remote?.device_id, "windows-pc")
    assert.equal(remote?.title, "Refactor parser")
  })
})

test("device_state flows: ingest → export → /api/skills and /api/limits show remote devices", async () => {
  const dir = seededDir()
  fs.writeFileSync(path.join(dir, "usageplane.yaml"), "device: hub-dev\nhub:\n  token: s3cret\n")
  await withServer(dir, async (base) => {
    const state = [
      { device_id: "windows-pc", kind: "skill", key: "cool-skill", payload: JSON.stringify({ description: "d", agents: ["codex"] }) },
      { device_id: "windows-pc", kind: "limit", key: "codex", payload: JSON.stringify({ id: "codex", name: "Codex", connected: true, windows: [{ label: "5h", utilization: 30, resets_at: null }] }) },
    ]
    const ok = await fetch(`${base}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer s3cret" },
      body: JSON.stringify({ records: [], state }),
    })
    assert.equal((await ok.json()).state_upserted, 2)

    const skills = await fetch(`${base}/api/skills`).then((r) => r.json())
    const remoteSkill = skills.skills.find((s: { name: string }) => s.name === "cool-skill")
    assert.deepEqual(remoteSkill?.devices, ["windows-pc"])

    const limits = await fetch(`${base}/api/limits`).then((r) => r.json())
    const remoteProvider = limits.providers.find((p: { device_id: string; id: string }) => p.device_id === "windows-pc")
    assert.equal(remoteProvider?.windows[0].utilization, 30)

    const exported = await fetch(`${base}/api/export`, { headers: { authorization: "Bearer s3cret" } }).then((r) => r.json())
    assert.equal(exported.state.length, 2)
  })
})

test("/api/export mirrors ingest auth and returns the full record set", async () => {
  const dir = seededDir()
  await withServer(dir, async (base) => {
    assert.equal((await fetch(`${base}/api/export`)).status, 403, "no hub token → export disabled")

    fs.writeFileSync(path.join(dir, "usageplane.yaml"), "hub:\n  token: s3cret\n")
    assert.equal((await fetch(`${base}/api/export`, { headers: { authorization: "Bearer nope" } })).status, 401)

    const ok = await fetch(`${base}/api/export`, { headers: { authorization: "Bearer s3cret" } })
    assert.equal(ok.status, 200)
    const body = await ok.json()
    assert.equal(body.records.length, 2)
    assert.equal(body.records[0].tool, "claude-code")
  })
})

test("store aggregation queries group correctly", () => {
  const dir = seededDir()
  const store = new Store(path.join(dir, "usageplane.db"))
  assert.equal(store.totalsByModel()[0].total_tokens, 60)
  assert.equal(store.totalsByProject().length, 2)
  assert.equal(store.totalsByDay(1).length, 1, "LIMIT applies")
  store.close()
})

test("device_state snapshot semantics: declared push replaces the group, deletions propagate", async () => {
  const dir = seededDir()
  fs.writeFileSync(path.join(dir, "usageplane.yaml"), "device: hub-dev\nhub:\n  token: s3cret\n")
  await withServer(dir, async (base) => {
    const push = (state: unknown[], declare: boolean) =>
      fetch(`${base}/api/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer s3cret" },
        body: JSON.stringify({
          records: [],
          state,
          ...(declare ? { state_device: "windows-pc", state_kinds: ["skill", "limit"] } : {}),
        }),
      })

    // First push: two skills + one limit, plus an unrelated device's row that
    // must survive windows-pc's replacements.
    const other = { device_id: "mac-mini", kind: "skill", key: "user::keep", payload: "{}" }
    await push([other], false)
    const first = await push(
      [
        { device_id: "windows-pc", kind: "skill", key: "user::old-a", payload: "{}" },
        { device_id: "windows-pc", kind: "skill", key: "user::old-b", payload: "{}" },
        { device_id: "windows-pc", kind: "limit", key: "codex", payload: "{}" },
      ],
      true,
    )
    assert.equal((await first.json()).state_upserted, 3)

    // Second push: old-a deleted on the device, only old-b remains; limits now empty.
    await push([{ device_id: "windows-pc", kind: "skill", key: "user::old-b", payload: "{}" }], true)

    const exported = await fetch(`${base}/api/export`, {
      headers: { authorization: "Bearer s3cret" },
    }).then((r) => r.json())
    const win = exported.state.filter((r: { device_id: string }) => r.device_id === "windows-pc")
    assert.deepEqual(
      win.map((r: { kind: string; key: string }) => `${r.kind}:${r.key}`),
      ["skill:user::old-b"],
      "deleted skill and emptied limit group are gone",
    )
    assert.ok(
      exported.state.some((r: { device_id: string }) => r.device_id === "mac-mini"),
      "other devices' state untouched",
    )
  })
})

test("/api/usage custom range: inclusive UTC day bounds, validation errors", async () => {
  await withServer(seededDir(), async (base) => {
    // Seed has buckets on 08-06 and 08-07; a range covering only 08-06 keeps one.
    const only6 = await fetch(`${base}/api/usage?range=custom&from=2026-08-06&to=2026-08-06`).then((r) => r.json())
    assert.equal(only6.totals.total_tokens, 30)
    assert.equal(only6.days.length, 1)
    assert.equal(only6.days[0].day, "2026-08-06")

    const both = await fetch(`${base}/api/usage?range=custom&from=2026-08-06&to=2026-08-07`).then((r) => r.json())
    assert.equal(both.totals.total_tokens, 60)

    assert.equal((await fetch(`${base}/api/usage?range=custom&from=2026-08-07&to=2026-08-06`)).status, 400)
    assert.equal((await fetch(`${base}/api/usage?range=custom&from=bogus&to=2026-08-07`)).status, 400)
    assert.equal((await fetch(`${base}/api/usage?range=nope`)).status, 400)
  })
})

test("/api/usage projects: per-project rows sum exactly to range totals; unknown kept explicit", async () => {
  const dir = seededDir()
  // Add a bucket with an empty project → must surface as "unknown", not vanish.
  const store2 = new Store(path.join(dir, "usageplane.db"))
  store2.upsertUsage([
    {
      device_id: "test", tool: "codex", project: "", source_kind: "unknown",
      model: "gpt-5.4", hour_start: "2026-08-07T12:00:00.000Z",
      input_tokens: 3, output_tokens: 4, cached_input_tokens: 0,
      cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
      total_tokens: 7, conversation_count: 1,
    },
  ])
  store2.close()
  await withServer(dir, async (base) => {
    const u = await fetch(`${base}/api/usage?range=total`).then((r) => r.json())
    assert.ok(Array.isArray(u.projects) && u.projects.length === 3)
    const sum = u.projects.reduce((s: number, p: { total_tokens: number }) => s + p.total_tokens, 0)
    assert.equal(sum, u.totals.total_tokens, "project rows sum to the range total")
    const names = u.projects.map((p: { project: string }) => p.project).sort()
    assert.deepEqual(names, ["proj-a", "proj-b", "unknown"])
    for (const p of u.projects) assert.equal(typeof p.estimated_cost, "number")
    // custom range narrows projects consistently with days
    const narrow = await fetch(`${base}/api/usage?range=custom&from=2026-08-06&to=2026-08-06`).then((r) => r.json())
    assert.deepEqual(narrow.projects.map((p: { project: string }) => p.project), ["proj-b"])
  })
})

test("skills management API: detail, toggle round-trip, refresh updates device_state", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-skillsrv-"))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-skillsrv-data-"))
  process.env.USAGEPLANE_HOME = dir
  fs.writeFileSync(path.join(dir, "usageplane.yaml"), "device: dev-a\n")
  const sp = path.join(home, ".claude", "skills", "srv-skill")
  fs.mkdirSync(sp, { recursive: true })
  fs.writeFileSync(path.join(sp, "SKILL.md"), "---\nname: srv-skill\ndescription: managed\n---\n")

  const server = createServer(dir, home)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  const base = `http://127.0.0.1:${port}`
  try {
    const detail = await fetch(`${base}/api/skills/detail?key=user::srv-skill`).then((r) => r.json())
    assert.equal(detail.manageable, true)
    assert.ok(detail.paths["claude-code"])

    const on = await fetch(`${base}/api/skills/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "user::srv-skill", agent: "codex", enable: true }),
    })
    assert.equal(on.status, 200)
    // Success must immediately rescan into device_state (requirement 8).
    const store = new Store(path.join(dir, "usageplane.db"))
    const row = store.deviceState("skill").find((r) => r.key === "user::srv-skill")
    store.close()
    assert.ok(row, "device_state updated after toggle")
    assert.deepEqual((JSON.parse(row!.payload) as { agents: string[] }).agents.sort(), ["claude-code", "codex"])

    const off = await fetch(`${base}/api/skills/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "user::srv-skill", agent: "codex", enable: false }),
    })
    assert.equal(off.status, 200)

    const bad = await fetch(`${base}/api/skills/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "user::srv-skill", agent: "../evil", enable: true }),
    })
    assert.equal(bad.status, 409, "unknown agent rejected")

    assert.equal((await fetch(`${base}/api/skills/refresh`, { method: "POST" })).status, 200)
    assert.equal((await fetch(`${base}/api/skills/detail?key=user::nope`)).status, 404)
  } finally {
    server.close()
    delete process.env.USAGEPLANE_HOME
  }
})
