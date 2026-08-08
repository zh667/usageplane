// Skill discovery + managed installs — ported from TokenTracker
// skills-manager.js (MIT): GitHub tree API with main/master branch fallback,
// SKILL.md blob scan (cap 200), raw-metadata fetch at concurrency 4,
// fingerprinted 1-hour cache, rate-limit surfacing, and the download-to-
// temp → atomic-rename install into a managed SSOT dir. Installs are then
// linked into agents through the same owned-link registry the Skills page
// uses, so ownership and removal rules stay identical.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { parse } from "yaml"
import { dataDir } from "./paths.js"
import { createOwnedLink, removeOwnedLinksTo, type LinkResult } from "./skill-links.js"

export interface DiscoverRepo {
  owner: string
  name: string
  branch: string
}

/** Upstream's default repo set. */
export const DEFAULT_REPOS: DiscoverRepo[] = [
  { owner: "anthropics", name: "skills", branch: "main" },
  { owner: "ComposioHQ", name: "awesome-claude-skills", branch: "master" },
  { owner: "cexll", name: "myclaude", branch: "master" },
  { owner: "JimLiu", name: "baoyu-skills", branch: "main" },
]

export interface DiscoveredSkill {
  key: string // owner/name:directory
  name: string
  description: string
  directory: string
  readme_url: string
  repo_owner: string
  repo_name: string
  repo_branch: string
}

const FETCH_TIMEOUT_MS = 20_000
/** GLOBAL metadata-fetch concurrency across all repos — not per repo. */
const DISCOVER_CONCURRENCY = 4
const DISCOVER_CACHE_TTL_MS = 60 * 60 * 1000
/** Partial results (some repos failed) get a short TTL so recovery is quick,
 *  while still absorbing rate-limit storms from repeated Browse opens. */
const DISCOVER_PARTIAL_TTL_MS = 5 * 60 * 1000
const MAX_SKILLS_PER_REPO = 200
// Install-download ceilings — a hostile or bloated repo dir must not be able
// to exhaust disk or memory through us.
const MAX_INSTALL_FILES = 200
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024

export class RateLimitError extends Error {}

function cachePath(): string {
  return path.join(dataDir(), "cache", "skill-discover.json")
}

function managedDir(): string {
  return path.join(dataDir(), "skills", "managed")
}

function managedRegistryPath(): string {
  return path.join(dataDir(), "skills", "managed.json")
}

export interface ManagedSkill {
  key: string
  name: string
  description: string
  directory: string // install dir name under managed/
  repo: string
  branch: string
  installed_at: string
}

export function readManaged(): ManagedSkill[] {
  try {
    const raw = JSON.parse(fs.readFileSync(managedRegistryPath(), "utf8")) as { skills?: ManagedSkill[] }
    return Array.isArray(raw.skills) ? raw.skills : []
  } catch {
    return []
  }
}

function writeManaged(skills: ManagedSkill[]): void {
  const file = managedRegistryPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  try {
    fs.writeFileSync(tmp, JSON.stringify({ skills }, null, 2))
    fs.renameSync(tmp, file)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

/** Forward-slash relative path with no "..", ".", or absolute segments. */
export function sanitizeRelativePath(p: string): string | null {
  if (typeof p !== "string" || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) return null
  const segs = p.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".")
  if (segs.length === 0 || segs.some((s) => s === "..")) return null
  return segs.join("/")
}

async function fetchWithTimeout(url: string, accept: string, fetchFn: typeof fetch): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetchFn(url, {
      headers: { Accept: accept, "User-Agent": "usageplane-skills" },
      signal: controller.signal,
    })
    if (res.status === 429 || res.status === 403) {
      throw new RateLimitError(`GitHub rate-limited this request (HTTP ${res.status}) — try again later`)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
    return res
  } finally {
    clearTimeout(timer)
  }
}

const rawUrl = (r: DiscoverRepo, branch: string, p: string): string =>
  `https://raw.githubusercontent.com/${r.owner}/${r.name}/${branch}/${p.split("/").map(encodeURIComponent).join("/")}`
const docUrl = (r: DiscoverRepo, branch: string, p: string): string =>
  `https://github.com/${r.owner}/${r.name}/blob/${branch}/${p.split("/").map(encodeURIComponent).join("/")}`

interface TreeEntry {
  path?: string
  type?: string
  sha?: string
}

/** Tree with branch fallback: configured branch, then main, then master. */
async function getRepoTree(repo: DiscoverRepo, fetchFn: typeof fetch): Promise<{ branch: string; tree: TreeEntry[] }> {
  const branches = [...new Set([repo.branch, "main", "master"].filter(Boolean))]
  let lastError: unknown = null
  for (const branch of branches) {
    try {
      const res = await fetchWithTimeout(
        `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
        "application/vnd.github+json",
        fetchFn,
      )
      const data = (await res.json()) as { tree?: TreeEntry[] }
      if (Array.isArray(data.tree)) return { branch, tree: data.tree }
    } catch (err) {
      if (err instanceof RateLimitError) throw err
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`unable to read ${repo.owner}/${repo.name}`)
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const run = async (): Promise<void> => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await worker(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

function parseFrontmatter(raw: string, fallbackName: string): { name: string; description: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return { name: fallbackName, description: "" }
  try {
    const fm = parse(m[1]) as { name?: unknown; description?: unknown }
    return {
      name: typeof fm?.name === "string" && fm.name.trim() ? fm.name.trim() : fallbackName,
      description: typeof fm?.description === "string" ? fm.description.replace(/\s+/g, " ").trim() : "",
    }
  } catch {
    return { name: fallbackName, description: "" }
  }
}

interface RepoMarkers {
  repo: DiscoverRepo
  branch: string
  docPath: string
}

export interface DiscoverResult {
  skills: DiscoveredSkill[]
  cached: boolean
  /** True when at least one repo failed — the catalog may be incomplete. */
  partial: boolean
  /** Per-repo failure messages, e.g. rate limits, for the UI banner. */
  errors: string[]
}

async function skillFromMarker({ repo, branch, docPath }: RepoMarkers, fetchFn: typeof fetch): Promise<DiscoveredSkill> {
  const clean = docPath.replace(/\\/g, "/")
  const directory = clean.replace(/(^|\/)(?:SKILL|skill)\.md$/i, "") || repo.name
  const installName = directory.split("/").filter(Boolean).pop() ?? repo.name
  let meta = { name: installName, description: "" }
  try {
    const res = await fetchWithTimeout(rawUrl(repo, branch, clean), "text/plain", fetchFn)
    meta = parseFrontmatter(await res.text(), installName)
  } catch {
    // keep discoverable without metadata (rate-limited raws included — the
    // tree already succeeded, so the repo is not reported as failed)
  }
  return {
    key: `${repo.owner}/${repo.name}:${directory}`,
    name: meta.name,
    description: meta.description,
    directory,
    readme_url: docUrl(repo, branch, clean),
    repo_owner: repo.owner,
    repo_name: repo.name,
    repo_branch: branch,
  }
}

export async function discoverSkills(
  { force = false, repos = DEFAULT_REPOS }: { force?: boolean; repos?: DiscoverRepo[] } = {},
  fetchFn: typeof fetch = fetch,
): Promise<DiscoverResult> {
  const fingerprint = repos.map((r) => `${r.owner}/${r.name}@${r.branch}`).sort().join("|")
  if (!force) {
    try {
      const c = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as {
        fingerprint?: string
        generated_at?: number
        skills?: DiscoveredSkill[]
        partial?: boolean
        errors?: string[]
      }
      const ttl = c.partial ? DISCOVER_PARTIAL_TTL_MS : DISCOVER_CACHE_TTL_MS
      if (c.fingerprint === fingerprint && Array.isArray(c.skills) && Date.now() - (c.generated_at ?? 0) < ttl) {
        return { skills: c.skills, cached: true, partial: c.partial ?? false, errors: c.errors ?? [] }
      }
    } catch {
      /* no cache */
    }
  }

  // Phase 1: one tree call per repo; failures are reported per repo, never
  // silently dropped. Phase 2: ONE global concurrency pool over all markers.
  const errors: string[] = []
  const markers: RepoMarkers[] = []
  const settled = await Promise.allSettled(repos.map(async (repo) => ({ repo, ...(await getRepoTree(repo, fetchFn)) })))
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
      errors.push(`${repos[i].owner}/${repos[i].name}: ${reason}`)
      return
    }
    const { repo, branch, tree } = r.value
    for (const e of tree.filter((t) => t?.type === "blob" && /(^|\/)SKILL\.md$/i.test(t.path ?? "")).slice(0, MAX_SKILLS_PER_REPO)) {
      markers.push({ repo, branch, docPath: e.path ?? "" })
    }
  })

  const fetched = await mapWithConcurrency(markers, DISCOVER_CONCURRENCY, (m) => skillFromMarker(m, fetchFn))
  const byKey = new Map<string, DiscoveredSkill>()
  for (const s of fetched) byKey.set(s.key.toLowerCase(), s)
  const skills = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
  const partial = errors.length > 0

  fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
  fs.writeFileSync(cachePath(), JSON.stringify({ fingerprint, generated_at: Date.now(), skills, partial, errors }))
  return { skills, cached: false, partial, errors }
}

/**
 * Install a discovered skill: download every file under its directory into
 * the managed SSOT dir (temp + atomic rename, traversal-sanitized), then
 * link into the requested agents via the owned-link registry.
 */
export async function installDiscoveredSkill(
  skill: Pick<DiscoveredSkill, "key" | "name" | "description" | "directory" | "repo_owner" | "repo_name" | "repo_branch">,
  agents: string[],
  home = os.homedir(),
  fetchFn: typeof fetch = fetch,
): Promise<LinkResult & { linked?: Record<string, string> }> {
  const sourceDir = sanitizeRelativePath(skill.directory)
  if (!sourceDir || !skill.repo_owner || !skill.repo_name) return { ok: false, message: "invalid skill reference" }
  const installName = sourceDir.split("/").pop() ?? ""
  if (!installName || installName.startsWith(".")) return { ok: false, message: "invalid install name" }

  const dest = path.resolve(managedDir(), installName)
  if (path.dirname(dest) !== path.resolve(managedDir())) return { ok: false, message: "invalid install name" }

  const managed = readManaged()
  const conflict = managed.find((m) => m.directory.toLowerCase() === installName.toLowerCase() && m.key !== skill.key)
  if (conflict) return { ok: false, message: `directory "${installName}" is already managed from ${conflict.repo}` }

  const repo: DiscoverRepo = { owner: skill.repo_owner, name: skill.repo_name, branch: skill.repo_branch || "main" }
  let tree: TreeEntry[]
  let branch: string
  try {
    ;({ branch, tree } = await getRepoTree(repo, fetchFn))
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
  const files = tree.filter(
    (e) => e?.type === "blob" && (e.path === sourceDir || String(e.path ?? "").startsWith(`${sourceDir}/`)),
  )
  if (!files.some((e) => /(^|\/)SKILL\.md$/i.test(e.path ?? ""))) {
    return { ok: false, message: "SKILL.md not found in the selected directory" }
  }
  if (files.length > MAX_INSTALL_FILES) {
    return { ok: false, message: `skill has ${files.length} files (limit ${MAX_INSTALL_FILES}) — refusing` }
  }

  const temp = path.join(dataDir(), "tmp", `${installName}-${Date.now()}`)
  try {
    fs.rmSync(temp, { recursive: true, force: true })
    fs.mkdirSync(temp, { recursive: true })
    let totalBytes = 0
    for (const entry of files) {
      const entryPath = String(entry.path)
      const relative = entryPath === sourceDir ? path.basename(entryPath) : entryPath.slice(sourceDir.length + 1)
      const safe = sanitizeRelativePath(relative)
      if (!safe) continue
      const out = path.join(temp, safe)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      const res = await fetchWithTimeout(rawUrl(repo, branch, entryPath), "text/plain", fetchFn)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_FILE_BYTES) throw new Error(`${entryPath} exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB per-file limit`)
      totalBytes += buf.byteLength
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`download exceeds the ${MAX_TOTAL_BYTES / 1024 / 1024}MB total limit`)
      fs.writeFileSync(out, buf)
    }
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.renameSync(temp, dest)
  } catch (err) {
    fs.rmSync(temp, { recursive: true, force: true })
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }

  // TRANSACTIONAL apply: any link failure or managed-registry failure rolls
  // back every link created here plus the managed copy — no partial installs,
  // no orphaned dirs the Browse tab can't see or uninstall.
  const rollback = (): void => {
    removeOwnedLinksTo(dest)
    fs.rmSync(dest, { recursive: true, force: true })
  }
  const linked: Record<string, string> = {}
  for (const agent of agents) {
    const r = createOwnedLink(dest, agent, home)
    if (!r.ok) {
      rollback()
      return { ok: false, message: `install failed for ${agent}: ${r.message} — rolled back` }
    }
    linked[agent] = r.message
  }
  try {
    writeManaged([
      ...managed.filter((m) => m.key !== skill.key),
      {
        key: skill.key,
        name: skill.name || installName,
        description: skill.description ?? "",
        directory: installName,
        repo: `${skill.repo_owner}/${skill.repo_name}`,
        branch,
        installed_at: new Date().toISOString(),
      },
    ])
  } catch (err) {
    rollback()
    return { ok: false, message: `failed to record install — rolled back (${err instanceof Error ? err.message : err})` }
  }
  return { ok: true, message: `installed ${installName}`, linked }
}

/** Uninstall a managed skill: remove our links into it, then the SSOT copy. */
export function uninstallManagedSkill(key: string): LinkResult {
  const managed = readManaged()
  const entry = managed.find((m) => m.key === key)
  if (!entry) return { ok: false, message: "not a managed skill" }
  const dir = path.resolve(managedDir(), entry.directory)
  if (path.dirname(dir) !== path.resolve(managedDir())) return { ok: false, message: "invalid managed directory" }
  const removedLinks = removeOwnedLinksTo(dir)
  fs.rmSync(dir, { recursive: true, force: true })
  writeManaged(managed.filter((m) => m.key !== key))
  return { ok: true, message: `uninstalled ${entry.directory} (${removedLinks} links removed)` }
}
