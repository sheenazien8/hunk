import "server-only"
import { BRANCH_FORMAT, parseBranches } from "@/lib/git/parse-branches"
import type { ActionPayload, BranchesResponse } from "@/lib/git/types"
import { HttpError } from "../http"
import { git, output } from "./exec"
import { refExists, requireNewBranchName, requireRef } from "./refs"

export async function listBranches(repo: string): Promise<BranchesResponse> {
  const [refs, current] = await Promise.all([
    git(repo, ["for-each-ref", `--format=${BRANCH_FORMAT}`, "--sort=-committerdate", "refs/heads", "refs/remotes"]),
    git(repo, ["branch", "--show-current"]),
  ])
  return { current: current.stdout.trim(), branches: parseBranches(refs.stdout) }
}

// Staged or unstaged changes to tracked files — what `git switch` might carry
// over or refuse on. Untracked files are left alone.
export async function hasTrackedChanges(repo: string): Promise<boolean> {
  return (await git(repo, ["status", "--porcelain", "--untracked-files=no"])).stdout.trim() !== ""
}

// Switches to a local branch, or to a remote one ("origin/x") by creating a
// local tracking branch for it. Refuses when there are uncommitted changes
// unless `stash` asks to stash them first.
export async function switchBranch(repo: string, payload: ActionPayload): Promise<string> {
  const branch = requireRef(payload.branch, "Branch")
  const local = await refExists(repo, `refs/heads/${branch}`)
  if (!local && !(await refExists(repo, `refs/remotes/${branch}`))) {
    throw new HttpError(400, `Unknown branch: ${branch}`)
  }

  let stashed = false
  if (await hasTrackedChanges(repo)) {
    if (!payload.stash) {
      throw new HttpError(409, "You have uncommitted changes — commit or stash them before switching branches")
    }
    await git(repo, ["stash", "push", "-m", `hunk: before switching to ${branch}`])
    stashed = true
  }

  try {
    await git(repo, local ? ["switch", "--", branch] : ["switch", "--track", branch])
  } catch (e) {
    // Put the changes back where they were.
    if (stashed) await git(repo, ["stash", "pop"]).catch(() => undefined)
    throw e
  }
  const current = (await git(repo, ["branch", "--show-current"])).stdout.trim()
  return `Switched to ${current || branch}${stashed ? " (changes stashed)" : ""}`
}

export async function createBranch(repo: string, payload: ActionPayload): Promise<string> {
  const branch = await requireNewBranchName(repo, payload.branch)
  const base = requireRef(payload.base || "HEAD", "Base")
  if (payload.checkout) {
    await git(repo, ["switch", "-c", branch, base])
    return `Created and switched to ${branch}`
  }
  await git(repo, ["branch", branch, base])
  return `Created branch ${branch}`
}

export async function deleteBranch(repo: string, payload: ActionPayload): Promise<string> {
  const branch = requireRef(payload.branch, "Branch")
  if (!(await refExists(repo, `refs/heads/${branch}`))) throw new HttpError(400, `Unknown branch: ${branch}`)
  return output(await git(repo, ["branch", payload.force ? "-D" : "-d", "--", branch])) || `Deleted branch ${branch}`
}
