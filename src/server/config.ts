import "server-only"
import path from "path"
import { readFile } from "fs/promises"
import { loadSettings } from "./settings"
// Bundled at build time — the same copy the client's project selector uses,
// so the server's allowlist and the UI can never disagree.
import projectsFile from "../../projects.json"

export interface Project {
  name: string
  dir: string
  // Extra ignore patterns for the All Files walk (added to the global ones).
  ignore?: string[]
}

// Trailing slashes are dropped so the server's project keys match the ones
// the plugin MCP bridge derives from the same dir (see plugins/sdk/mcp.mjs).
const trimSlash = (dir: string) => (dir.length > 1 ? dir.replace(/\/+$/, "") : dir)

export const projects: Project[] = (projectsFile as { projects: Project[] }).projects.map(p => ({ ...p, dir: trimSlash(p.dir) }))

export function defaultRepo(): string {
  return projects[0]?.dir ?? ""
}

export function findProject(repo: string): Project | undefined {
  const resolved = path.resolve(repo)
  return projects.find(p => path.resolve(p.dir) === resolved)
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
