// Local skill link management — the write half of the Skills page. Semantics
// ported from TokenTracker skills-manager.js (MIT): link-per-target install,
// idempotent sync/remove, path-containment guards. Our own hard rules on top:
//  - only USER-scope local skills are manageable; plugin caches are read-only
//  - removal only ever deletes links RECORDED IN OUR REGISTRY — a real skill
//    directory, or a link the user made themselves, is never touched
//  - Windows gets junctions (no admin needed), Unix gets dir symlinks

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { dataDir } from "./paths.js"
import { agentSkillDirs, listSkills, skillKey, type SkillInfo } from "./skills.js"

interface LinkRecord {
  target: string
  source: string
  created_at: string
}

interface LinkRegistry {
  links: LinkRecord[]
}

function registryPath(): string {
  return path.join(dataDir(), "skill-links.json")
}

function readRegistry(): LinkRegistry {
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath(), "utf8")) as LinkRegistry
    return Array.isArray(raw.links) ? raw : { links: [] }
  } catch {
    return { links: [] }
  }
}

function writeRegistry(reg: LinkRegistry): void {
  // Atomic replace (tmp + rename): a crash mid-write can never leave a
  // truncated registry that would orphan links as "foreign".
  const file = registryPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  try {
    fs.writeFileSync(tmp, JSON.stringify(reg, null, 2))
    fs.renameSync(tmp, file)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

function pathStrictlyWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
}

function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

/** Fully-resolved real path, or null when it can't be resolved (dangling link). */
function canonical(p: string): string | null {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

export interface LinkResult {
  ok: boolean
  message: string
}

async function findManageableSkill(home: string, key: string): Promise<SkillInfo | LinkResult> {
  const skill = (await listSkills(home)).find((s) => skillKey(s) === key)
  if (!skill) return { ok: false, message: "skill not found on this device" }
  if (skill.scope !== "user") return { ok: false, message: "plugin-cache skills are read-only" }
  return skill
}

/** Install a user-scope skill for another agent by linking its existing dir. */
export async function linkSkill(key: string, agent: string, home = os.homedir()): Promise<LinkResult> {
  const dirs = agentSkillDirs(home)
  const root = dirs[agent]
  if (!root) return { ok: false, message: `unknown agent "${agent}"` }

  const found = await findManageableSkill(home, key)
  if (!("name" in found)) return found
  if (found.paths?.[agent]) return { ok: true, message: "already installed — nothing to do" }

  const anyInstall = Object.values(found.paths ?? {})[0]
  if (!anyInstall) return { ok: false, message: "no local install to link from" }
  // The picked install may itself be one of our links. Always link to the
  // RESOLVED real directory — link chains (A→B→real) break when the middle
  // link is removed, stranding the outer one.
  const source = canonical(anyInstall)
  if (!source) return { ok: false, message: "existing install does not resolve — fix or remove it first" }

  // Target name comes from the scanned source dir's basename — never from
  // client input — and must resolve strictly inside the agent's skills root.
  const target = path.resolve(root, path.basename(source))
  if (!pathStrictlyWithin(path.resolve(root), target)) {
    return { ok: false, message: "refusing target outside the skills root" }
  }
  if (fs.existsSync(target) || isLink(target)) {
    return { ok: false, message: "target path already exists — refusing to overwrite" }
  }

  fs.mkdirSync(root, { recursive: true })
  // Junctions work without admin rights on Windows; the type is ignored on
  // other platforms, where a plain dir symlink is created.
  fs.symlinkSync(source, target, "junction")
  try {
    const reg = readRegistry()
    reg.links.push({ target, source, created_at: new Date().toISOString() })
    writeRegistry(reg)
  } catch (err) {
    // A link we can't record would be stranded as "foreign" — roll it back.
    fs.rmSync(target, { recursive: true, force: true })
    return { ok: false, message: `failed to record link — rolled back (${err instanceof Error ? err.message : err})` }
  }
  return { ok: true, message: `linked for ${agent}` }
}

/** Remove an agent's install ONLY when it is a link recorded in our registry. */
export async function unlinkSkill(key: string, agent: string, home = os.homedir()): Promise<LinkResult> {
  const found = await findManageableSkill(home, key)
  if (!("name" in found)) return found

  const target = found.paths?.[agent]
  if (!target) return { ok: true, message: "not installed for this agent — nothing to do" }
  if (Object.keys(found.paths ?? {}).length === 1) {
    return { ok: false, message: "last remaining install — refusing to remove the skill itself" }
  }
  if (!isLink(target)) {
    return { ok: false, message: "real directory, not a link — remove it manually if intended" }
  }
  const reg = readRegistry()
  const idx = reg.links.findIndex((l) => path.resolve(l.target) === path.resolve(target))
  if (idx === -1) {
    return { ok: false, message: "link was not created by usageplane — remove it manually if intended" }
  }
  // A registry hit on the PATH alone is not ownership: the user may have
  // replaced our link with their own at the same path. Only delete when the
  // link still resolves to the canonical source we recorded at create time.
  if (canonical(target) !== reg.links[idx].source) {
    return { ok: false, message: "link no longer points where we created it — remove it manually if intended" }
  }
  // Registry first: if the removal can't be recorded, nothing changes on
  // disk. Only then delete the link; a delete failure restores the record.
  const removed = reg.links[idx]
  reg.links.splice(idx, 1)
  try {
    writeRegistry(reg)
  } catch (err) {
    return { ok: false, message: `failed to update registry — link left in place (${err instanceof Error ? err.message : err})` }
  }
  try {
    // rm does not follow symlinks — with isLink verified above this removes the
    // link/junction itself, never the linked skill's contents (upstream removePath).
    fs.rmSync(target, { recursive: true, force: true })
  } catch (err) {
    reg.links.splice(idx, 0, removed)
    try {
      writeRegistry(reg)
    } catch {
      /* best effort — the link is still present and still ours */
    }
    return { ok: false, message: `failed to remove link (${err instanceof Error ? err.message : err})` }
  }
  return { ok: true, message: `removed ${agent} link` }
}

export type InstallState = "real" | "owned-link" | "foreign-link"

/**
 * Classify each local install so the UI only offers removal where unlink
 * would actually succeed: our registry-recorded links (still pointing at the
 * recorded source) are "owned-link"; anything else is hands-off.
 */
export function classifyInstalls(paths: Record<string, string> | undefined): Record<string, InstallState> {
  const out: Record<string, InstallState> = {}
  if (!paths) return out
  const reg = readRegistry()
  for (const [agent, p] of Object.entries(paths)) {
    if (!isLink(p)) {
      out[agent] = "real"
      continue
    }
    const rec = reg.links.find((l) => path.resolve(l.target) === path.resolve(p))
    out[agent] = rec && canonical(p) === rec.source ? "owned-link" : "foreign-link"
  }
  return out
}
