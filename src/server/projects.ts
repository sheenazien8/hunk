import "server-only"
import path from "path"
import { randomUUID } from "crypto"
import { readFile, realpath, rename, stat, unlink, writeFile } from "fs/promises"
import type { Project, ProjectInput } from "@/lib/git/types"
import { invalidateProjects, parseProjects, projectsPath, trimSlash } from "./config"
import { HttpError } from "./http"
import { writeTarget } from "./settings"

// projects.json: the repo allowlist, edited from the RepoSwitcher. Read at
// runtime (see config.ts); writes reuse settings.json's atomic, queued,
// symlink-aware pattern.

const NAME_MAX = 200

function cleanName(name: unknown): string {
  const value = typeof name === "string" ? name.trim() : ""
  if (!value) throw new HttpError(400, "A project name is required")
  if (value.length > NAME_MAX) throw new HttpError(400, `Project names are at most ${NAME_MAX} characters`)
  return value
}

function cleanIgnore(ignore: unknown): string[] | undefined {
  if (ignore === undefined || ignore === null) return undefined
  if (!Array.isArray(ignore) || !ignore.every(i => typeof i === "string")) {
    throw new HttpError(400, "ignore must be a list of patterns")
  }
  const list = [...new Set(ignore.map(i => i.trim()).filter(Boolean))]
  return list.length > 0 ? list : undefined
}

// A listed dir: it must exist, be a directory, and be a working tree (has a
// .git file or dir — a bare repo has none). Returns the real path, so the
// allowlist entry can't be sidestepped by a symlink.
async function resolveProjectDir(dir: unknown): Promise<string> {
  if (typeof dir !== "string" || !dir.trim()) throw new HttpError(400, "A project directory is required")
  const target = await realpath(path.resolve(dir.trim())).catch(() => null)
  if (!target) throw new HttpError(400, `Not a directory: ${dir}`)
  const info = await stat(target).catch(() => null)
  if (!info?.isDirectory()) throw new HttpError(400, `Not a directory: ${dir}`)
  const dotGit = await stat(path.join(target, ".git")).catch(() => null)
  if (!dotGit) throw new HttpError(400, `Not a git repository (no .git): ${dir}`)
  return trimSlash(target)
}

const sameDir = (a: string, b: string) => path.resolve(a) === path.resolve(b)

function serialize(projects: Project[]): string {
  return JSON.stringify({ projects }, null, 2) + "\n"
}

// One writer at a time, so concurrent add/edit/remove can't lose each other.
let queue: Promise<unknown> = Promise.resolve()

async function mutate(change: (projects: Project[]) => Project[], file = projectsPath()): Promise<Project[]> {
  const run = queue.then(async () => {
    const before = await readFile(file, "utf-8")
      .then(raw => parseProjects(JSON.parse(raw)))
      .catch(() => [] as Project[])
    const next = change(before)
    const target = await writeTarget(file)
    const tmp = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(tmp, serialize(next), "utf-8")
      await rename(tmp, target)
    } catch (e) {
      await unlink(tmp).catch(() => {})
      throw e
    }
    invalidateProjects()
    return next
  })
  queue = run.catch(() => {})
  return run
}

export async function addProject(input: ProjectInput, file = projectsPath()): Promise<Project[]> {
  const name = cleanName(input.name)
  const dir = await resolveProjectDir(input.dir)
  const ignore = cleanIgnore(input.ignore)
  return mutate(projects => {
    if (projects.some(p => sameDir(p.dir, dir))) throw new HttpError(409, `Already listed: ${dir}`)
    return [...projects, { name, dir, ...(ignore ? { ignore } : {}) }]
  }, file)
}

export async function updateProject(prevDir: string, input: ProjectInput, file = projectsPath()): Promise<Project[]> {
  const name = cleanName(input.name)
  const dir = await resolveProjectDir(input.dir)
  const ignore = cleanIgnore(input.ignore)
  return mutate(projects => {
    const index = projects.findIndex(p => sameDir(p.dir, prevDir))
    if (index === -1) throw new HttpError(404, `Unknown project: ${prevDir}`)
    if (projects.some((p, i) => i !== index && sameDir(p.dir, dir))) {
      throw new HttpError(409, `Already listed: ${dir}`)
    }
    const next = [...projects]
    next[index] = { name, dir, ...(ignore ? { ignore } : {}) }
    return next
  }, file)
}

export async function removeProject(dir: string, file = projectsPath()): Promise<Project[]> {
  return mutate(projects => {
    const index = projects.findIndex(p => sameDir(p.dir, dir))
    if (index === -1) throw new HttpError(404, `Unknown project: ${dir}`)
    return projects.filter((_, i) => i !== index)
  }, file)
}
