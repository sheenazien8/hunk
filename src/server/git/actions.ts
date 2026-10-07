import "server-only"
import type { ActionName, ActionPayload } from "@/lib/git/types"
import { createRepoDir, createRepoFile, moveRepoPaths, removeFiles, removeRepoPaths, renameRepoPath } from "../fs/files"
import { HttpError } from "../http"
import { resolveInRepo } from "../repo"
import { createBranch, deleteBranch, switchBranch } from "./branches"
import { abortOperation, amend, cherryPick, continueOperation, revert, undoCommit } from "./commit-tools"
import { git, isUnbornHead, output } from "./exec"
import { fetch, pull, push } from "./remote"
import { stash, stashApply, stashDrop, stashPop } from "./stash"
import { isUntracked } from "./status"
import { addWorktree, removeWorktree } from "./worktree"

function plural(n: number, noun: string) {
  return `${n} ${noun}${n > 1 ? "s" : ""}`
}

function requireFiles(payload: ActionPayload): string[] {
  const files = payload.files
  if (!Array.isArray(files) || files.length === 0) throw new HttpError(400, "No file specified")
  return files
}

// `git reset` needs HEAD; in a repo with no commits fall back to removing the
// paths from the index directly.
async function unstage(repo: string, files: string[] | null) {
  try {
    await git(repo, files ? ["reset", "-q", "--", ...files] : ["reset", "-q"])
  } catch (e) {
    if (!isUnbornHead(e)) throw e
    await git(repo, files ? ["rm", "--cached", "-q", "--", ...files] : ["rm", "-r", "--cached", "-q", "."])
  }
}

// Reverts tracked files and deletes untracked ones.
async function restoreOrRemove(repo: string, files: string[]) {
  const tracked: string[] = []
  const untracked: string[] = []
  for (const file of files) {
    const abs = resolveInRepo(repo, file)
    if (await isUntracked(repo, file)) untracked.push(abs)
    else tracked.push(file)
  }
  if (tracked.length > 0) await git(repo, ["restore", "--", ...tracked])
  if (untracked.length > 0) await removeFiles(untracked)
}

type ActionHandler = (repo: string, payload: ActionPayload) => Promise<string>

// Each handler performs one action and returns the success message.
export const actions: Record<ActionName, ActionHandler> = {
  async add(repo, payload) {
    const files = requireFiles(payload)
    await git(repo, ["add", "--", ...files])
    return `Staged ${plural(files.length, "file")}`
  },

  async addAll(repo) {
    await git(repo, ["add", "-A"])
    return "Staged all changes"
  },

  async unstage(repo, payload) {
    const files = requireFiles(payload)
    await unstage(repo, files)
    return `Unstaged ${plural(files.length, "file")}`
  },

  async unstageAll(repo) {
    await unstage(repo, null)
    return "Unstaged all changes"
  },

  async commit(repo, payload) {
    const msg = (payload.message || "").trim()
    if (!msg) throw new HttpError(400, "Commit message is required")
    return output(await git(repo, ["commit", "-m", msg])) || "Committed"
  },

  async create(repo, payload) {
    const filePath = (payload.path || "").trim()
    if (!filePath) throw new HttpError(400, "File path is required")
    await createRepoFile(repo, filePath)
    return `Created ${filePath}`
  },

  async createDir(repo, payload) {
    const dirPath = (payload.path || "").trim()
    if (!dirPath) throw new HttpError(400, "Folder path is required")
    await createRepoDir(repo, dirPath)
    return `Created ${dirPath}/`
  },

  async rename(repo, payload) {
    const from = (payload.path || "").trim()
    const to = (payload.to || "").trim()
    if (!from || !to) throw new HttpError(400, "Source and destination are required")
    await renameRepoPath(repo, from, to)
    return `Moved ${from} → ${to}`
  },

  async move(repo, payload) {
    const files = requireFiles(payload)
    const to = (payload.to ?? "").trim().replace(/\/+$/, "")
    const moved = await moveRepoPaths(repo, files, to)
    return `Moved ${moved.length === 1 ? moved[0] : plural(moved.length, "item")} to ${to ? `${to}/` : "the repository root"}`
  },

  async delete(repo, payload) {
    const files = requireFiles(payload)
    await removeRepoPaths(repo, files)
    return `Deleted ${files.length === 1 ? files[0] : plural(files.length, "item")}`
  },

  async discard(repo, payload) {
    const files = requireFiles(payload)
    files.forEach(f => resolveInRepo(repo, f))
    await restoreOrRemove(repo, files)
    return `Discarded ${plural(files.length, "file")}`
  },

  async discardAll(repo) {
    await git(repo, ["restore", "."])
    await git(repo, ["clean", "-fd"])
    return "Discarded all changes"
  },

  async discardStaged(repo, payload) {
    const files = requireFiles(payload)
    files.forEach(f => resolveInRepo(repo, f))
    // Unstage first so the worktree check below sees newly-added files as untracked.
    for (const file of files) await unstage(repo, [file])
    await restoreOrRemove(repo, files)
    return `Discarded ${plural(files.length, "staged file")}`
  },

  addWorktree,
  removeWorktree,
  switchBranch,
  createBranch,
  deleteBranch,
  stash,
  stashPop,
  stashApply,
  stashDrop,
  fetch,
  pull,
  push,
  amend,
  undoCommit,
  revert,
  cherryPick,
  continueOperation,
  abortOperation,
}
