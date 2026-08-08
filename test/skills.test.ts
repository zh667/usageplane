import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { listSkills } from "../src/core/skills.js"

function makeHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-skills-"))
}

function writeSkill(home: string, agentDir: string, dir: string, frontmatter: string): void {
  const p = path.join(home, agentDir, "skills", dir)
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, "SKILL.md"), `---\n${frontmatter}\n---\n\n# body\n`)
}

test("merges same skill across agents into one row with an agent matrix", async () => {
  const home = makeHome()
  writeSkill(home, ".claude", "my-skill", "name: my-skill\ndescription: Does things well")
  writeSkill(home, ".codex", "my-skill", "name: my-skill\ndescription: Does things well")
  writeSkill(home, ".claude", "solo", "name: solo\ndescription: Claude only")

  const skills = await listSkills(home)
  assert.equal(skills.length, 2)
  const merged = skills.find((s) => s.name === "my-skill")
  assert.deepEqual(merged?.agents.sort(), ["claude-code", "codex"])
  assert.equal(skills.find((s) => s.name === "solo")?.agents.length, 1)
})

test("falls back to directory name and survives broken frontmatter", async () => {
  const home = makeHome()
  const p = path.join(home, ".claude", "skills", "no-front")
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, "SKILL.md"), "# just markdown\n")
  writeSkill(home, ".claude", "bad-yaml", "description: [unclosed")

  const skills = await listSkills(home)
  assert.deepEqual(skills.map((s) => s.name).sort(), ["bad-yaml", "no-front"])
})

test("missing skills dirs yield empty list", async () => {
  assert.deepEqual(await listSkills(makeHome()), [])
})

test("symlinked skill dirs are discovered (Windows junctions report as symlinks)", async (t) => {
  const home = makeHome()
  // Real skill lives outside the skills tree; the skills dir only holds a link.
  const real = path.join(home, "elsewhere", "linked-skill")
  fs.mkdirSync(real, { recursive: true })
  fs.writeFileSync(path.join(real, "SKILL.md"), "---\nname: linked-skill\ndescription: via link\n---\n")
  const codexSkills = path.join(home, ".codex", "skills")
  fs.mkdirSync(codexSkills, { recursive: true })
  try {
    fs.symlinkSync(real, path.join(codexSkills, "linked-skill"), "junction")
  } catch (err) {
    // Windows denies symlink creation to non-admin shells (EPERM). Real
    // junctions were field-verified; skip only the fixture creation.
    if ((err as NodeJS.ErrnoException).code === "EPERM") return t.skip("symlink creation not permitted here")
    throw err
  }

  const skills = await listSkills(home)
  const linked = skills.find((s) => s.name === "linked-skill")
  assert.ok(linked, "linked skill discovered")
  assert.deepEqual(linked?.agents, ["codex"])
})

test("dot-directories (.system) are deliberately excluded; grouped skills found to depth 3", async () => {
  const home = makeHome()
  writeSkill(home, ".codex", ".system/builtin", "name: builtin\ndescription: system skill")
  writeSkill(home, ".claude", "group/sub/deep-skill", "name: deep-skill\ndescription: nested")

  const skills = await listSkills(home)
  assert.equal(skills.find((s) => s.name === "builtin"), undefined, ".system stays hidden (upstream rule)")
  assert.ok(skills.find((s) => s.name === "deep-skill"), "grouped skill within depth found")
})

test("shared ~/.agents/skills root is scanned with its own agent id", async () => {
  const home = makeHome()
  writeSkill(home, ".agents", "shared-skill", "name: shared-skill\ndescription: for every agent")

  const skills = await listSkills(home)
  assert.deepEqual(skills.find((s) => s.name === "shared-skill")?.agents, ["agents"])
})

test("legacy lowercase skill.md marker is accepted", async () => {
  const home = makeHome()
  const p = path.join(home, ".claude", "skills", "legacy")
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, "skill.md"), "---\nname: legacy\ndescription: old spelling\n---\n")

  const skills = await listSkills(home)
  assert.ok(skills.find((s) => s.name === "legacy"))
})

test("plugin cache inventory: version stripped from identity, scope=plugin, separate from user rows", async () => {
  const home = makeHome()
  const mk = (version: string, desc: string) => {
    const p = path.join(home, ".claude", "plugins", "cache", "acme", "toolkit", version, "skills", "cache-skill")
    fs.mkdirSync(p, { recursive: true })
    fs.writeFileSync(path.join(p, "SKILL.md"), `---\nname: cache-skill\ndescription: ${desc}\n---\n`)
  }
  mk("1.0.0", "old")
  mk("1.2.0", "new")
  // Same name installed as a user skill — must remain a distinct row.
  writeSkill(home, ".claude", "cache-skill", "name: cache-skill\ndescription: user copy")

  const skills = await listSkills(home)
  const rows = skills.filter((s) => s.name === "cache-skill")
  assert.equal(rows.length, 2, "plugin and user copies are separate rows")
  const plugin = rows.find((s) => s.scope === "plugin")
  assert.equal(plugin?.source, "acme/toolkit", "cache version stripped from identity")
  assert.equal(plugin?.description, "new", "newer cache version's metadata wins")
  const user = rows.find((s) => s.scope === "user")
  assert.equal(user?.description, "user copy")
})
