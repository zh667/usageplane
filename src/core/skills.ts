// Installed-skills inventory — the data behind the Skills page (My Skills
// tab). Scans each agent's user-level skills directory and merges by skill
// name into an install matrix, TokenTracker-style.

import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { parse } from "yaml"

export interface SkillInfo {
  name: string
  description: string
  /** Agents this skill is installed for, e.g. ["claude-code", "codex"]. */
  agents: string[]
}

/** Agent id → user-level skills directory. Extend as more agents gain skills. */
function agentSkillDirs(home: string): Record<string, string> {
  return {
    "claude-code": path.join(home, ".claude", "skills"),
    codex: path.join(home, ".codex", "skills"),
  }
}

export async function listSkills(home = os.homedir()): Promise<SkillInfo[]> {
  const byName = new Map<string, SkillInfo>()
  for (const [agent, dir] of Object.entries(agentSkillDirs(home))) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const meta = await readSkillMeta(path.join(dir, entry.name, "SKILL.md"))
      if (!meta) continue
      const name = meta.name || entry.name
      const existing = byName.get(name)
      if (existing) {
        if (!existing.agents.includes(agent)) existing.agents.push(agent)
        if (!existing.description && meta.description) existing.description = meta.description
      } else {
        byName.set(name, { name, description: meta.description, agents: [agent] })
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
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
