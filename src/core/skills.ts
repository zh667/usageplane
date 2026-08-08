// Installed-skills inventory — the data behind the Skills page (My Skills
// tab). Discovery semantics ported from TokenTracker src/lib/skills-manager.js
// (MIT): entry acceptance, marker spellings, scan depths, dot-dir exclusion,
// and the plugin-cache inventory. Cross-device merging is our own layer.

import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { parse } from "yaml"

export interface SkillInfo {
  name: string
  description: string
  /** Agents this skill is installed for, e.g. ["claude-code", "codex", "agents"]. */
  agents: string[]
  /** "user" = agent skills dir; "plugin" = read-only plugin-cache inventory. */
  scope: "user" | "plugin"
  /** Plugin scope only: publisher/plugin identity with the cache version stripped. */
  source?: string
}

// Upstream recurses grouped skill dirs to depth 3; plugin caches are walked
// to depth 6 looking for a directory literally named "skills".
const MAX_SCAN_DEPTH = 3
const PLUGIN_SCAN_DEPTH = 6

function codexHome(home: string): string {
  const env = String(process.env.CODEX_HOME ?? "").trim()
  return env && home === os.homedir() ? env : path.join(home, ".codex")
}

/** Agent id → user-level skills directory. `.agents/skills` is the shared
 *  cross-agent dir (an upstream scan target too — hidden label there). */
function agentSkillDirs(home: string): Record<string, string> {
  return {
    "claude-code": path.join(home, ".claude", "skills"),
    codex: path.join(codexHome(home), "skills"),
    agents: path.join(home, ".agents", "skills"),
  }
}

/** Plugin caches: <publisher>/<plugin>/<version>/skills/<skill>/SKILL.md. */
function pluginCacheRoots(home: string): Record<string, string> {
  return {
    "claude-code": path.join(home, ".claude", "plugins", "cache"),
    codex: path.join(codexHome(home), "plugins", "cache"),
  }
}

/** Marker is SKILL.md (canonical) or skill.md (legacy). stat() follows
 *  symlinks/junctions, so a linked skill directory resolves correctly. */
async function findSkillMarker(dir: string): Promise<string | null> {
  for (const name of ["SKILL.md", "skill.md"]) {
    const candidate = path.join(dir, name)
    const st = await fs.stat(candidate).catch(() => null)
    if (st?.isFile()) return candidate
  }
  return null
}

/**
 * Walk a skills tree collecting relative skill-dir paths. Windows junctions
 * and symlinks report isSymbolicLink(), NOT isDirectory() — an isDirectory()-
 * only filter silently drops every linked skill (2026-08-08 Windows finding).
 * Dot-directories (e.g. codex's .system built-ins) are deliberately excluded,
 * matching upstream. Symlinked GROUP dirs are not traversed — only directly
 * linked skills are accepted — so the scan stays within the target tree.
 */
async function scanSkillDirs(root: string, maxDepth = MAX_SCAN_DEPTH): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string, relDir: string, depth: number): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (!entry.name || entry.name.startsWith(".")) continue
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      const full = path.join(dir, entry.name)
      if (await findSkillMarker(full)) {
        found.push(rel)
        continue
      }
      if (entry.isDirectory() && depth + 1 < maxDepth) await walk(full, rel, depth + 1)
    }
  }
  await walk(root, "", 0)
  return found
}

interface PluginHit {
  source: string | null
  relDir: string
  marker: string
}

/** Find "skills" dirs inside a plugin cache; identity drops the cache version
 *  so upgrading a plugin updates one row instead of duplicating it. */
async function scanPluginCache(root: string): Promise<PluginHit[]> {
  const out: PluginHit[] = []
  const looksLikeVersion = (v: string): boolean => /^v?\d+(?:\.\d+)*$/.test(v)
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (!entry.name || entry.name.startsWith(".") || entry.name === "node_modules") continue
      const full = path.join(dir, entry.name)
      if (entry.name.toLowerCase() === "skills") {
        const before = path
          .relative(root, full)
          .split(path.sep)
          .filter(Boolean)
          .slice(0, -1)
        const parts = before.length > 1 && looksLikeVersion(before[before.length - 1]) ? before.slice(0, -1) : before
        const source = parts.join("/") || null
        for (const relDir of await scanSkillDirs(full, 5)) {
          const marker = await findSkillMarker(path.join(full, relDir))
          if (marker) out.push({ source, relDir, marker })
        }
        continue
      }
      if (depth + 1 < PLUGIN_SCAN_DEPTH) await walk(full, depth + 1)
    }
  }
  await walk(root, 0)
  return out
}

/** Stable identity for merging installs of the same skill across agents/devices. */
export function skillKey(s: Pick<SkillInfo, "name" | "scope" | "source">): string {
  return `${s.scope}:${s.source ?? ""}:${s.name.toLowerCase()}`
}

export async function listSkills(home = os.homedir()): Promise<SkillInfo[]> {
  const merged = new Map<string, SkillInfo>()
  const add = (name: string, description: string, agent: string, scope: "user" | "plugin", source?: string): void => {
    const info: SkillInfo = { name, description, agents: [agent], scope, ...(source ? { source } : {}) }
    const existing = merged.get(skillKey(info))
    if (existing) {
      if (!existing.agents.includes(agent)) existing.agents.push(agent)
      // Plugin caches hold multiple versions; entries arrive in sorted order,
      // so the later (newer) copy's metadata replaces the older (upstream rule).
      if (scope === "plugin" && description) existing.description = description
      else if (!existing.description && description) existing.description = description
    } else {
      merged.set(skillKey(info), info)
    }
  }

  for (const [agent, dir] of Object.entries(agentSkillDirs(home))) {
    for (const rel of await scanSkillDirs(dir)) {
      const marker = await findSkillMarker(path.join(dir, rel))
      if (!marker) continue
      const meta = await readSkillMeta(marker)
      const base = rel.split("/").pop() ?? rel
      add(meta?.name || base, meta?.description ?? "", agent, "user")
    }
  }

  for (const [agent, root] of Object.entries(pluginCacheRoots(home))) {
    for (const hit of await scanPluginCache(root)) {
      const meta = await readSkillMeta(hit.marker)
      const base = hit.relDir.split("/").pop() ?? hit.relDir
      add(meta?.name || base, meta?.description ?? "", agent, "plugin", hit.source ?? "plugin")
    }
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope))
}

/** Parse SKILL.md YAML frontmatter (--- fenced) for name/description. */
async function readSkillMeta(file: string): Promise<{ name: string; description: string } | null> {
  const raw = await fs.readFile(file, "utf8").catch(() => null)
  if (raw === null) return null
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return { name: "", description: "" }
  try {
    const fm = parse(m[1]) as { name?: unknown; description?: unknown }
    return {
      name: typeof fm?.name === "string" ? fm.name.trim() : "",
      description: typeof fm?.description === "string" ? fm.description.replace(/\s+/g, " ").trim() : "",
    }
  } catch {
    return { name: "", description: "" }
  }
}
