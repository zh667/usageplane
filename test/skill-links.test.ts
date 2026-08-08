import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { linkSkill, unlinkSkill } from "../src/core/skill-links.js"
import { listSkills } from "../src/core/skills.js"

// The link registry lives under dataDir() — point it at a temp dir so tests
// never touch the real ~/.usageplane.
function makeEnv(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-links-"))
  process.env.USAGEPLANE_HOME = path.join(home, ".usageplane")
  return home
}

function writeSkill(home: string, agentDir: string, dir: string, name: string): string {
  const p = path.join(home, agentDir, "skills", dir)
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`)
  return p
}

const KEY = (name: string) => `user::${name}`

test("link → discovered for the new agent; second link is a no-op; unlink removes only our link", async () => {
  const home = makeEnv()
  const source = writeSkill(home, ".claude", "my-skill", "my-skill")

  const r1 = await linkSkill(KEY("my-skill"), "codex", home)
  assert.equal(r1.ok, true, r1.message)
  const linked = path.join(home, ".codex", "skills", "my-skill")
  assert.ok(fs.lstatSync(linked).isSymbolicLink())

  const after = await listSkills(home)
  assert.deepEqual(after.find((s) => s.name === "my-skill")?.agents.sort(), ["claude-code", "codex"])

  const r2 = await linkSkill(KEY("my-skill"), "codex", home)
  assert.equal(r2.ok, true)
  assert.match(r2.message, /already/)

  const r3 = await unlinkSkill(KEY("my-skill"), "codex", home)
  assert.equal(r3.ok, true, r3.message)
  assert.ok(!fs.existsSync(linked), "link removed")
  assert.ok(fs.existsSync(source), "real skill dir untouched")

  const r4 = await unlinkSkill(KEY("my-skill"), "codex", home)
  assert.equal(r4.ok, true, "unlink is idempotent")
})

test("unlink refuses real directories, foreign links, and the last remaining install", async () => {
  const home = makeEnv()
  writeSkill(home, ".claude", "dup", "dup")
  writeSkill(home, ".codex", "dup", "dup") // real dir in both agents

  const real = await unlinkSkill(KEY("dup"), "codex", home)
  assert.equal(real.ok, false)
  assert.match(real.message, /real directory/)

  // A link the USER made (not in our registry) must not be deleted.
  const src = writeSkill(home, ".claude", "hand", "hand")
  const handLink = path.join(home, ".codex", "skills", "hand")
  fs.symlinkSync(src, handLink, "junction")
  const foreign = await unlinkSkill(KEY("hand"), "codex", home)
  assert.equal(foreign.ok, false)
  assert.match(foreign.message, /not created by usageplane/)
  assert.ok(fs.lstatSync(handLink).isSymbolicLink(), "foreign link survives")

  // The only copy of a skill can never be removed through unlink.
  writeSkill(home, ".claude", "solo", "solo")
  const solo = await unlinkSkill(KEY("solo"), "claude-code", home)
  assert.equal(solo.ok, false)
  assert.match(solo.message, /last remaining/)
})

test("plugin-cache skills reject management; unknown agents and skills error cleanly", async () => {
  const home = makeEnv()
  const p = path.join(home, ".claude", "plugins", "cache", "pub", "kit", "1.0.0", "skills", "cached")
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, "SKILL.md"), "---\nname: cached\ndescription: d\n---\n")

  const plugin = await linkSkill("plugin:pub/kit:cached", "codex", home)
  assert.equal(plugin.ok, false)
  assert.match(plugin.message, /read-only/)

  writeSkill(home, ".claude", "ok", "ok")
  assert.equal((await linkSkill(KEY("ok"), "nonexistent-agent", home)).ok, false)
  assert.equal((await linkSkill(KEY("missing"), "codex", home)).ok, false)
})

test("link refuses to overwrite an existing target path", async () => {
  const home = makeEnv()
  writeSkill(home, ".claude", "clash", "clash")
  // Same-named REAL directory already at the codex target, without a marker —
  // scan doesn't see it as an install, but link must still not overwrite it.
  fs.mkdirSync(path.join(home, ".codex", "skills", "clash"), { recursive: true })
  const r = await linkSkill(KEY("clash"), "codex", home)
  assert.equal(r.ok, false)
  assert.match(r.message, /already exists/)
})

test("no link chains: every link resolves to the real dir; middle removal strands nothing", async () => {
  const home = makeEnv()
  const real = writeSkill(home, ".codex", "chain", "chain")

  // claude picks the codex real dir; agents would naively pick the claude
  // LINK (agent scan order) — canonicalization must flatten it to the real dir.
  assert.equal((await linkSkill(KEY("chain"), "claude-code", home)).ok, true)
  assert.equal((await linkSkill(KEY("chain"), "agents", home)).ok, true)

  const agentsLink = path.join(home, ".agents", "skills", "chain")
  assert.equal(fs.realpathSync(agentsLink), fs.realpathSync(real), "agents links straight to the real dir")

  // Removing the middle hop must leave the outer install fully functional.
  assert.equal((await unlinkSkill(KEY("chain"), "claude-code", home)).ok, true)
  const after = await listSkills(home)
  assert.deepEqual(after.find((s) => s.name === "chain")?.agents.sort(), ["agents", "codex"])
  assert.equal((await unlinkSkill(KEY("chain"), "agents", home)).ok, true)
  assert.ok(fs.existsSync(real), "real dir untouched throughout")
})

test("same-path replacement: a user link at our registered path is refused", async () => {
  const home = makeEnv()
  writeSkill(home, ".claude", "swap", "swap")
  assert.equal((await linkSkill(KEY("swap"), "codex", home)).ok, true)

  // User deletes our link and puts THEIR OWN link at the same path,
  // pointing at a different copy of the skill.
  const target = path.join(home, ".codex", "skills", "swap")
  fs.rmSync(target, { recursive: true, force: true })
  const copy = path.join(home, "copies", "swap")
  fs.mkdirSync(copy, { recursive: true })
  fs.writeFileSync(path.join(copy, "SKILL.md"), "---\nname: swap\ndescription: copy\n---\n")
  fs.symlinkSync(copy, target, "junction")

  const r = await unlinkSkill(KEY("swap"), "codex", home)
  assert.equal(r.ok, false)
  assert.match(r.message, /no longer points/)
  assert.ok(fs.lstatSync(target).isSymbolicLink(), "user's replacement link survives")
})
