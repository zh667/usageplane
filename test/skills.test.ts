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
