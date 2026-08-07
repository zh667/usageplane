import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { listSessions } from "../src/core/sessions.js"

function makeHomes(): { claudeHome: string; codexHome: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-sess-"))
  const claudeHome = path.join(root, "claude")
  const codexHome = path.join(root, "codex")
  fs.mkdirSync(path.join(claudeHome, "projects", "-home-x-proj"), { recursive: true })
  fs.mkdirSync(path.join(codexHome, "sessions", "2026", "08", "07"), { recursive: true })
  return { claudeHome, codexHome }
}

const CLAUDE_ID = "aaaabbbb-cccc-4ddd-8eee-ffff00001111"
const CODEX_ID = "12345678-abcd-4abc-8def-1234567890ab"

test("claude session: summary title, turns, edits, dedup, resume command", async () => {
  const { claudeHome, codexHome } = makeHomes()
  const usage = (id: string, ts: string) =>
    JSON.stringify({
      type: "assistant",
      timestamp: ts,
      requestId: `r-${id}`,
      message: { id, model: "claude-sonnet-5", usage: { input_tokens: 10, output_tokens: 5 } },
    })
  fs.writeFileSync(
    path.join(claudeHome, "projects", "-home-x-proj", `${CLAUDE_ID}.jsonl`),
    [
      JSON.stringify({ type: "summary", summary: "Fix the flux capacitor" }),
      JSON.stringify({ type: "user", uuid: "u1", timestamp: "2026-08-07T09:00:00Z", cwd: "/home/x/proj", message: { content: [{ type: "text", text: "hello world" }] } }),
      usage("m1", "2026-08-07T09:01:00Z"),
      usage("m1", "2026-08-07T09:01:00Z"),
      JSON.stringify({ type: "assistant", timestamp: "2026-08-07T09:02:00Z", message: { id: "m2", content: [{ type: "tool_use", name: "Edit", input: {} }] } }),
      JSON.stringify({ type: "user", uuid: "u2", timestamp: "2026-08-07T09:03:00Z", message: { content: [{ type: "tool_result", content: "ok" }] } }),
    ].join("\n") + "\n",
  )

  const sessions = await listSessions({ claudeHome, codexHome })
  assert.equal(sessions.length, 1)
  const s = sessions[0]
  assert.equal(s.title, "Fix the flux capacitor")
  assert.equal(s.project, "proj")
  assert.equal(s.model, "claude-sonnet-5")
  assert.equal(s.turns, 1, "tool_result user lines are not turns")
  assert.equal(s.edits, 1)
  assert.equal(s.total_tokens, 15, "duplicate usage row must dedup")
  assert.equal(s.resume_command, `claude --resume ${CLAUDE_ID}`)
  assert.equal(s.duration_ms, 3 * 60 * 1000)
})

test("codex session: delta tokens, model from turn_context, resume command", async () => {
  const { claudeHome, codexHome } = makeHomes()
  fs.writeFileSync(
    path.join(codexHome, "session_index.jsonl"),
    JSON.stringify({ id: CODEX_ID, thread_name: "Refactor the parser" }) + "\n",
  )
  fs.writeFileSync(
    path.join(codexHome, "sessions", "2026", "08", "07", `rollout-2026-08-07T09-00-00-${CODEX_ID}.jsonl`),
    [
      JSON.stringify({ type: "session_meta", timestamp: "2026-08-07T09:00:00Z", payload: { cwd: "/home/x/codex-proj", model: "gpt-5.4" } }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-07T09:01:00Z",
        payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10, total_tokens: 110 }, total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10, total_tokens: 110 } } },
      }),
    ].join("\n") + "\n",
  )

  const sessions = await listSessions({ claudeHome, codexHome })
  assert.equal(sessions.length, 1)
  const s = sessions[0]
  assert.equal(s.tool, "codex")
  assert.equal(s.title, "Refactor the parser", "title comes from Codex's own session_index.jsonl")
  assert.equal(s.project, "codex-proj")
  assert.equal(s.model, "gpt-5.4")
  assert.equal(s.total_tokens, 110, "60 non-cached input + 40 cached + 10 output")
  assert.equal(s.resume_command, `codex resume ${CODEX_ID}`)
})

test("empty and subagent files are excluded", async () => {
  const { claudeHome, codexHome } = makeHomes()
  fs.mkdirSync(path.join(claudeHome, "projects", "-home-x-proj", "subagents"), { recursive: true })
  fs.writeFileSync(path.join(claudeHome, "projects", "-home-x-proj", "empty.jsonl"), "")
  fs.writeFileSync(
    path.join(claudeHome, "projects", "-home-x-proj", "subagents", "sub.jsonl"),
    JSON.stringify({ type: "user", uuid: "u", timestamp: "2026-08-07T09:00:00Z", message: { content: [{ type: "text", text: "hi" }] } }) + "\n",
  )
  const sessions = await listSessions({ claudeHome, codexHome })
  assert.equal(sessions.length, 0)
})
