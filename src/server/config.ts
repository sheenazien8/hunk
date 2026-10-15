import "server-only"
import path from "path"
import { readFileSync, statSync } from "fs"
import { readFile } from "fs/promises"
import { loadSettings } from "./settings"

export interface Project {
  name: string
  dir: string
  // Extra ignore patterns for the All Files walk (added to the global ones).
  ignore?: string[]
}

// Trailing slashes are dropped so the server's project keys match the ones
// the plugin MCP bridge derives from the same dir (see plugins/sdk/mcp.mjs).
export const trimSlash = (dir: string) => (dir.length > 1 ? dir.replace(/\/+$/, "") : dir)

export function projectsPath(): string {
  return process.env.HUNK_PROJECTS_PATH || path.join(process.cwd(), "projects.json")
}

// Keeps only well-formed entries; invalid ones are dropped rather than
// crashing the allowlist.
export function parseProjects(raw: unknown): Project[] {
  const list = (raw as { projects?: unknown } | null)?.projects
  if (!Array.isArray(list)) return []
  return list
    .filter((p): p is Project => {
      const e = p as Project | null
      return !!e && typeof e.name === "string" && typeof e.dir === "string" && e.dir !== ""
        && (e.ignore === undefined || (Array.isArray(e.ignore) && e.ignore.every(i => typeof i === "string")))
    })
    .map(p => ({ ...p, dir: trimSlash(p.dir) }))
}

// Runtime read of projects.json, cached by mtime so the sync callers below
// stay cheap. Any write invalidates the cache explicitly.
let cache: { file: string; mtimeMs: number; projects: Project[] } | null = null

export function invalidateProjects(): void {
  cache = null
}

function readProjectsSync(file = projectsPath()): Project[] {
  try {
    const { mtimeMs } = statSync(file)
    if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.projects
    const projects = parseProjects(JSON.parse(readFileSync(file, "utf-8")))
    cache = { file, mtimeMs, projects }
    return projects
  } catch {
    // Missing or malformed: no projects (the file is created on first add).
    return cache?.file === file ? cache.projects : []
  }
}

export function listProjects(): Project[] {
  return readProjectsSync()
}

export function defaultRepo(): string {
  return listProjects()[0]?.dir ?? ""
}

export function findProject(repo: string): Project | undefined {
  const resolved = path.resolve(repo)
  return listProjects().find(p => path.resolve(p.dir) === resolved)
}

// Escape hatch for opening repos that aren't listed in projects.json.
export function allowAnyRepo(): boolean {
  // GIT_REVIEW_* is the pre-rebrand name, still honoured.
  return (process.env.HUNK_ALLOW_ANY_REPO ?? process.env.GIT_REVIEW_ALLOW_ANY_REPO) === "1"
}

// Global defaults used when neither settings.json nor ignore.config.json has a list.
const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "vendor",
  "dist",
  "build",
  ".next",
  ".idea",
  "coverage",
  "tmp",
  "*.log",
  ".DS_Store",
]

export async function defaultIgnorePatterns(): Promise<string[]> {
  try {
    const raw = await readFile(path.join(process.cwd(), "ignore.config.json"), "utf-8")
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(p => typeof p === "string")) {
      return parsed
    }
  } catch {
    // missing or malformed -> fall through to hardcoded defaults
  }
  return DEFAULT_IGNORE_PATTERNS
}

/**
 * Ignore patterns for a repo: the global list (settings.json files.ignore,
 * else ignore.config.json, else the hardcoded fallback), unioned with the
 * optional per-project "ignore" array from projects.json. Per-project entries
 * only add patterns; they never remove global ones.
 */
export async function loadIgnorePatterns(repo: string): Promise<string[]> {
  const patterns = [...((await loadSettings()).files.ignore ?? await defaultIgnorePatterns())]

  const ignore = findProject(repo)?.ignore
  if (Array.isArray(ignore) && ignore.every(i => typeof i === "string")) {
    patterns.push(...ignore)
  }

  return [...new Set(patterns)]
}
