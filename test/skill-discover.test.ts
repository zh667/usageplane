import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  discoverSkills,
  installDiscoveredSkill,
  readManaged,
  sanitizeRelativePath,
  uninstallManagedSkill,
} from "../src/core/skill-discover.js"
import { listSkills } from "../src/core/skills.js"

function makeEnv(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "usageplane-disc-"))
  process.env.USAGEPLANE_HOME = path.join(home, ".usageplane")
  return home
}

/** GitHub API double: one repo with a tree and raw file contents. */
function fakeGithub(tree: { path: string; type?: string }[], raw: Record<string, string>): typeof fetch {
  return (async (url: unknown) => {
    const u = String(url)
    const body = u.includes("api.github.com")
      ? JSON.stringify({ tree: tree.map((t) => ({ ...t, type: t.type ?? "blob", sha: "x" })) })
      : raw[decodeURIComponent(new URL(u).pathname.split("/").slice(4).join("/"))]
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: async () => JSON.parse(body as string),
      text: async () => body,
      arrayBuffer: async () => new TextEncoder().encode(body ?? "").buffer,
    }
  }) as unknown as typeof fetch
}

const REPO = [{ owner: "acme", name: "skills", branch: "main" }]

test("discover: finds SKILL.md dirs, reads frontmatter, caches by fingerprint", async () => {
  makeEnv()
  const gh = fakeGithub(
    [
      { path: "cool-skill/SKILL.md" },
      { path: "group/deep-skill/SKILL.md" },
      { path: "README.md" },
    ],
    {
      "cool-skill/SKILL.md": "---\nname: cool-skill\ndescription: Very cool\n---\n",
      "group/deep-skill/SKILL.md": "---\nname: deep-skill\ndescription: Nested\n---\n",
    },
  )
  const first = await discoverSkills({ repos: REPO }, gh)
  assert.equal(first.cached, false)
  assert.deepEqual(first.skills.map((s) => s.key).sort(), ["acme/skills:cool-skill", "acme/skills:group/deep-skill"])
  assert.equal(first.skills.find((s) => s.name === "cool-skill")?.description, "Very cool")

  // Second call hits the fingerprinted cache — a failing fetch proves it.
  const boom = (async () => {
    throw new Error("network must not be touched")
  }) as unknown as typeof fetch
  const second = await discoverSkills({ repos: REPO }, boom)
  assert.equal(second.cached, true)
  assert.equal(second.skills.length, 2)
})

test("install: downloads under the managed dir, links agents, uninstall cleans up", async () => {
  const home = makeEnv()
  const gh = fakeGithub(
    [
      { path: "cool-skill/SKILL.md" },
      { path: "cool-skill/helper.py" },
      { path: "cool-skill/refs/notes.md" },
      { path: "other/thing.md" },
    ],
    {
      "cool-skill/SKILL.md": "---\nname: cool-skill\ndescription: Very cool\n---\n",
      "cool-skill/helper.py": "print('hi')",
      "cool-skill/refs/notes.md": "notes",
    },
  )
  const { skills } = await discoverSkills({ repos: REPO }, gh)
  const skill = skills.find((s) => s.key === "acme/skills:cool-skill")!

  const r = await installDiscoveredSkill(skill, ["claude-code", "codex"], home, gh)
  assert.equal(r.ok, true, r.message)
  const managedPath = path.join(process.env.USAGEPLANE_HOME!, "skills", "managed", "cool-skill")
  assert.ok(fs.existsSync(path.join(managedPath, "SKILL.md")))
  assert.ok(fs.existsSync(path.join(managedPath, "refs", "notes.md")), "nested files land correctly")
  assert.ok(!fs.existsSync(path.join(managedPath, "..", "thing.md")), "unrelated repo files not downloaded")

  // Both agents see it through owned links; scan resolves through junctions.
  const scanned = await listSkills(home)
  assert.deepEqual(scanned.find((s) => s.name === "cool-skill")?.agents.sort(), ["claude-code", "codex"])
  assert.equal(readManaged().length, 1)

  const un = uninstallManagedSkill(skill.key)
  assert.equal(un.ok, true, un.message)
  assert.ok(!fs.existsSync(managedPath), "managed copy removed")
  assert.equal((await listSkills(home)).find((s) => s.name === "cool-skill"), undefined, "links removed")
  assert.equal(readManaged().length, 0)
})

test("install: traversal-shaped directories and missing SKILL.md are rejected", async () => {
  const home = makeEnv()
  const gh = fakeGithub([{ path: "no-marker/readme.md" }], { "no-marker/readme.md": "x" })

  const evil = await installDiscoveredSkill(
    { key: "a/b:../../evil", name: "evil", description: "", directory: "../../evil", repo_owner: "a", repo_name: "b", repo_branch: "main" },
    ["codex"],
    home,
    gh,
  )
  assert.equal(evil.ok, false)

  const noMarker = await installDiscoveredSkill(
    { key: "acme/skills:no-marker", name: "x", description: "", directory: "no-marker", repo_owner: "acme", repo_name: "skills", repo_branch: "main" },
    ["codex"],
    home,
    gh,
  )
  assert.equal(noMarker.ok, false)
  assert.match(noMarker.message, /SKILL\.md not found/)
})

test("sanitizeRelativePath: rejects absolute, drive-letter, and dot-dot paths", () => {
  assert.equal(sanitizeRelativePath("a/b"), "a/b")
  assert.equal(sanitizeRelativePath("a\\b"), "a/b")
  assert.equal(sanitizeRelativePath("./a//b/"), "a/b")
  assert.equal(sanitizeRelativePath("../a"), null)
  assert.equal(sanitizeRelativePath("a/../b"), null)
  assert.equal(sanitizeRelativePath("/etc/passwd"), null)
  assert.equal(sanitizeRelativePath("C:\\evil"), null)
  assert.equal(sanitizeRelativePath(""), null)
})
