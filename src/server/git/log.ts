import "server-only"
import { LOG_FORMAT, parseLog, parseNameStatus } from "@/lib/git/parse-log"
import type { CommitResponse, LogResponse } from "@/lib/git/types"
import { HttpError } from "../http"
import { resolveInRepo } from "../repo"
import { EMPTY_TREE, git, isUnbornHead } from "./exec"
import { refExists, requireRef, requireSha } from "./refs"

export const MAX_LOG_LIMIT = 200

// A local or remote branch name ("main", "origin/main") → its full ref.
async function branchRef(repo: string, name: string): Promise<string> {
  const branch = requireRef(name, "Branch")
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/${branch}`]) {
    if (await refExists(repo, ref)) return ref
  }
  throw new HttpError(400, `Unknown branch: ${branch}`)
}

// Commit history of HEAD (or of the branch `ref`), newest first; `file`
// limits it to commits touching that file (following renames).
export async function getLog(
  repo: string,
  { file, ref, limit, skip }: { file?: string; ref?: string; limit: number; skip: number }
): Promise<LogResponse> {
  if (file) resolveInRepo(repo, file)
  // One extra commit tells whether another page exists.
  const args = ["log", LOG_FORMAT, `--max-count=${limit + 1}`, `--skip=${skip}`]
  if (ref) args.push(await branchRef(repo, ref))
  if (file) args.push("--follow")
  args.push("--", ...(file ? [file] : []))
  let stdout: string
  try {
    stdout = (await git(repo, args)).stdout
  } catch (e) {
    if (isUnbornHead(e)) return { commits: [], hasMore: false }
    throw e
  }
  const commits = parseLog(stdout)
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit }
}

// What a commit's diff is taken against: its first parent (so a merge shows
// what it brought into the branch), or the empty tree for a root commit.
async function diffBase(repo: string, sha: string, parents?: string[]): Promise<string> {
  const list = parents ?? (await git(repo, ["rev-list", "--parents", "-n", "1", sha, "--"])).stdout.trim().split(" ").slice(1)
  return list[0] ?? EMPTY_TREE
}

async function readCommit(repo: string, sha: string) {
  try {
    const [commit] = parseLog((await git(repo, ["log", "-1", LOG_FORMAT, sha, "--"])).stdout)
    if (commit) return commit
  } catch {
    // fall through
  }
  throw new HttpError(404, `Unknown commit: ${sha}`)
}

// A commit's metadata plus the files it changed.
export async function getCommit(repo: string, shaParam: string): Promise<CommitResponse> {
  const commit = await readCommit(repo, requireSha(shaParam))
  const base = await diffBase(repo, commit.sha, commit.parents)
  const r = await git(repo, ["diff", "--name-status", "-z", "-M", base, commit.sha, "--"])
  return { commit, files: parseNameStatus(r.stdout) }
}

// Diff of one file in a commit (against the commit's first parent).
export async function getCommitDiff(
  repo: string,
  shaParam: string,
  { file, oldPath }: { file: string; oldPath?: string }
): Promise<string> {
  const sha = requireSha(shaParam)
  resolveInRepo(repo, file)
  if (oldPath) resolveInRepo(repo, oldPath)
  const base = await diffBase(repo, sha)
  const paths = oldPath && oldPath !== file ? [oldPath, file] : [file]
  return (await git(repo, ["diff", "-M50", base, sha, "--", ...paths])).stdout
}
