import "server-only"
import { existsSync } from "fs"
import path from "path"
import { parseBranchHeader, parseStatus } from "@/lib/git/parse-status"
import type { GitOperation, StatusResponse } from "@/lib/git/types"
import { git } from "./exec"

export async function getStatus(repo: string): Promise<StatusResponse> {
  const [status, branch, head, operation] = await Promise.all([
    git(repo, ["status", "--porcelain", "--branch", "-uall"]),
    git(repo, ["branch", "--show-current"]),
    // Exits 128 before the first commit.
    git(repo, ["log", "-1", "--format=%H%n%s"], { okExitCodes: [128] }),
    getOperation(repo),
  ])
  const [sha, subject] = head.stdout.split("\n")
  return {
    files: parseStatus(status.stdout),
    branch: branch.stdout.trim(),
    ...(sha ? { head: sha, headSubject: subject } : {}),
    ...parseBranchHeader(status.stdout),
    operation,
  }
}

// State files of each operation, checked in order: a rebase stops on its
// steps with the same files a cherry-pick leaves, so it must win.
const OPERATION_FILES: [string, GitOperation][] = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
]

// The multi-step operation (rebase, merge, …) this worktree is in the middle
// of, if any. `--git-path` resolves each file for linked worktrees too.
export async function getOperation(repo: string): Promise<GitOperation | undefined> {
  const r = await git(repo, ["rev-parse", ...OPERATION_FILES.flatMap(([file]) => ["--git-path", file])])
  const paths = r.stdout.split("\n")
  return OPERATION_FILES.find((_, i) => paths[i] && existsSync(path.resolve(repo, paths[i])))?.[1]
}

export async function isUntracked(repo: string, file: string): Promise<boolean> {
  const r = await git(repo, ["status", "--porcelain", "-uall", "--", file])
  return r.stdout.startsWith("??")
}
