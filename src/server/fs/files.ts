import "server-only"
import { lstat, mkdir, readFile, rename, rm, writeFile } from "fs/promises"
import path from "path"
import { topLevelPaths } from "@/lib/repo-paths"
import { git } from "../git/exec"
import { HttpError } from "../http"
import { resolveInRepo } from "../repo"

export async function readRepoFile(repo: string, file: string): Promise<string> {
  return readFile(resolveInRepo(repo, file), "utf-8")
}

export async function writeRepoFile(repo: string, file: string, content: string): Promise<void> {
  await writeFile(resolveInRepo(repo, file), content, "utf-8")
}

function errorCode(e: unknown): string | undefined {
  return (e as { code?: string }).code
}

async function exists(abs: string): Promise<boolean> {
  try {
    await lstat(abs)
    return true
  } catch (e) {
    if (errorCode(e) === "ENOENT") return false
    throw e
  }
}

// resolveInRepo() for paths the file manager creates, moves or deletes: also
// refuses anything inside .git (any case — case-insensitive filesystems).
export function resolveManagedPath(repo: string, relPath: string): string {
  const abs = resolveInRepo(repo, relPath)
  const segments = path.relative(path.resolve(repo), abs).split(path.sep)
  if (segments.some(s => s.toLowerCase() === ".git")) throw new HttpError(400, `Refusing to touch .git: ${relPath}`)
  return abs
}

// Missing parent dirs are created. A file or dir already in the way (the
// target itself or one of its parents) is a 409.
async function mkdirParents(abs: string) {
  try {
    await mkdir(path.dirname(abs), { recursive: true })
  } catch (e) {
    if (errorCode(e) === "EEXIST" || errorCode(e) === "ENOTDIR") throw new HttpError(409, "A file is in the way of that path")
    throw e
  }
}

// Creates an empty file (and any missing parent dirs); refuses to overwrite.
export async function createRepoFile(repo: string, file: string): Promise<void> {
  const abs = resolveManagedPath(repo, file)
  await mkdirParents(abs)
  try {
    await writeFile(abs, "", { flag: "wx" })
  } catch (e) {
    if (errorCode(e) === "EEXIST") throw new HttpError(409, "File already exists")
    throw e
  }
}

// Creates a directory (and any missing parents); refuses an existing path.
export async function createRepoDir(repo: string, dir: string): Promise<void> {
  const abs = resolveManagedPath(repo, dir)
  if (await exists(abs)) throw new HttpError(409, "A file or folder with that name already exists")
  await mkdirParents(abs)
  await mkdir(abs)
}

// Deletes repo files and directories (recursively).
export async function removeRepoPaths(repo: string, paths: string[]): Promise<void> {
  const abs = paths.map(p => resolveManagedPath(repo, p))
  await Promise.all(abs.map(p => rm(p, { recursive: true, force: true })))
}

// Removes files given as absolute paths (already validated by the caller).
export async function removeFiles(absPaths: string[]): Promise<void> {
  await Promise.all(absPaths.map(p => rm(p, { force: true })))
}

// Checks a single rename/move before anything changes: the source must
// exist, the destination must be free (a case-only rename onto the same inode
// is fine) and a folder can't go inside itself. Returns the absolute paths.
async function checkMove(repo: string, from: string, to: string): Promise<{ src: string; dest: string }> {
  const src = resolveManagedPath(repo, from)
  const dest = resolveManagedPath(repo, to)
  if (src === path.resolve(repo)) throw new HttpError(400, "Cannot move the repository root")
  if (dest.startsWith(src + path.sep)) throw new HttpError(400, "Cannot move a folder into itself")

  let srcStat
  try {
    srcStat = await lstat(src)
  } catch (e) {
    if (errorCode(e) === "ENOENT") throw new HttpError(404, `Not found: ${from}`)
    throw e
  }
  if (src === dest) return { src, dest }
  try {
    const destStat = await lstat(dest)
    // Same inode = a case-only rename on a case-insensitive filesystem.
    if (destStat.ino !== srcStat.ino || destStat.dev !== srcStat.dev) {
      throw new HttpError(409, `${to} already exists`)
    }
  } catch (e) {
    if (errorCode(e) !== "ENOENT") throw e
  }
  return { src, dest }
}

// Paths with tracked files go through `git mv` so the index records the
// rename (it moves untracked files inside a dir too); untracked/ignored ones
// are a plain rename.
async function performMove(repo: string, src: string, dest: string) {
  if (src === dest) return
  await mkdirParents(dest)
  const rel = (abs: string) => path.relative(path.resolve(repo), abs)
  const tracked = (await git(repo, ["ls-files", "-z", "--", rel(src)])).stdout.length > 0
  if (tracked) await git(repo, ["mv", "--", rel(src), rel(dest)])
  else await rename(src, dest)
}

// Renames or moves one file/dir inside the repo.
export async function renameRepoPath(repo: string, from: string, to: string): Promise<void> {
  const { src, dest } = await checkMove(repo, from, to)
  await performMove(repo, src, dest)
}

// Moves files/dirs into `destDir` ("" = repo root), keeping their names.
// Items already there are skipped. Everything is checked before anything
// moves. Returns the repo-relative paths that moved.
export async function moveRepoPaths(repo: string, paths: string[], destDir: string): Promise<string[]> {
  const dir = destDir.replace(/\/+$/, "")
  if (dir) {
    const absDir = resolveManagedPath(repo, dir)
    try {
      if (!(await lstat(absDir)).isDirectory()) throw new HttpError(409, `${dir} is a file`)
    } catch (e) {
      if (errorCode(e) !== "ENOENT") throw e
    }
  }
  const moving = topLevelPaths(paths).filter(p => path.posix.dirname(p) !== (dir || "."))
  if (moving.length === 0) throw new HttpError(400, "Everything is already in that folder")
  const names = new Set<string>()
  for (const p of moving) {
    const name = path.posix.basename(p)
    if (names.has(name)) throw new HttpError(409, `Two items are named ${name}`)
    names.add(name)
  }
  const checked = []
  for (const p of moving) checked.push(await checkMove(repo, p, dir ? `${dir}/${path.posix.basename(p)}` : path.posix.basename(p)))
  for (const { src, dest } of checked) await performMove(repo, src, dest)
  return moving
}
