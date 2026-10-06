// Shared API contract between the /api/git/* route handlers and the client.

// "conflicted" = an unmerged path (merge/rebase/stash conflict); reported
// once, on the unstaged side.
export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted"

// One side (staged or unstaged) of a changed file. A file with both staged
// and unstaged changes appears twice, once per side.
export interface GitFile {
  path: string
  status: FileStatus
  staged: boolean
  oldPath?: string
}

// A multi-step git operation stopped half-way (usually on conflicts).
export type GitOperation = "merge" | "rebase" | "cherry-pick" | "revert"

export interface StatusResponse {
  files: GitFile[]
  branch: string
  // Full sha and subject of HEAD; absent before the first commit.
  head?: string
  headSubject?: string
  // The current branch's upstream ("origin/main") and how far HEAD is ahead
  // of / behind it. `gone`: the upstream branch was deleted on the remote.
  upstream?: string
  ahead: number
  behind: number
  gone?: boolean
  operation?: GitOperation
}

// One entry of `git worktree list`. The first entry is always the main worktree.
export interface Worktree {
  path: string
  head: string
  // Short branch name; absent when detached (or bare).
  branch?: string
  main: boolean
  detached: boolean
  bare: boolean
  locked: boolean
  // The worktree's directory is gone; git will drop it on `worktree prune`.
  prunable: boolean
}

export interface WorktreesResponse {
  worktrees: Worktree[]
  // Local branch names, for the "add worktree" dialog.
  branches: string[]
}

export type RepoEntryStatus = "tracked" | "untracked" | "ignored"
export type RepoEntryType = "file" | "dir"

// A file or directory from the filesystem walk behind /api/git/all-files.
export interface RepoEntry {
  path: string
  status: RepoEntryStatus
  type: RepoEntryType
}

export interface AllFilesResponse {
  files: RepoEntry[]
}

// "staged" = index vs HEAD, "unstaged" = worktree vs index, "head" = worktree vs HEAD.
export type DiffSide = "staged" | "unstaged" | "head"

export interface DiffResponse {
  diff: string
}

export interface ContentResponse {
  content: string
}

// --- Blame -------------------------------------------------------------------

// The all-zero sha `git blame` uses for lines that aren't committed yet.
export const UNCOMMITTED_SHA = "0000000000000000000000000000000000000000"

export interface BlameCommit {
  sha: string
  author: string
  email: string
  // ISO 8601 author date.
  date: string
  summary: string
  // Line isn't committed yet (sha is UNCOMMITTED_SHA).
  uncommitted: boolean
}

export interface BlameLine {
  // 1-based line number in the blamed version of the file.
  line: number
  sha: string
  content: string
}

export interface BlameResponse {
  lines: BlameLine[]
  // Keyed by sha; every BlameLine.sha has an entry.
  commits: Record<string, BlameCommit>
}

// --- History -----------------------------------------------------------------

export interface Commit {
  sha: string
  shortSha: string
  author: string
  email: string
  // ISO 8601 author date.
  date: string
  // Parent shas; empty for a root commit, 2+ for a merge.
  parents: string[]
  subject: string
  body: string
}

export interface LogResponse {
  commits: Commit[]
  hasMore: boolean
}

// A file changed by a commit, relative to its first parent.
export interface CommitFile {
  path: string
  status: FileStatus
  oldPath?: string
}

export interface CommitResponse {
  commit: Commit
  files: CommitFile[]
}

// --- Branches ----------------------------------------------------------------

export interface Branch {
  // Short name: "main" for local branches, "origin/main" for remote ones.
  name: string
  remote: boolean
  // Checked out in the repo (worktree) the request was made for.
  current: boolean
  shortSha: string
  // Local branches: upstream short name and how far ahead/behind it is.
  upstream?: string
  ahead: number
  behind: number
  // Local branches checked out in some worktree: that worktree's path.
  worktree?: string
  // ISO 8601 committer date of the tip.
  date: string
  subject: string
}

export interface BranchesResponse {
  // Current branch name; "" when HEAD is detached.
  current: string
  branches: Branch[]
}

// --- Stash -------------------------------------------------------------------

export interface StashEntry {
  // n in stash@{n}
  index: number
  sha: string
  // Reflog subject, e.g. "On main: my message" / "WIP on main: abc123 subject".
  message: string
  // Branch the stash was made on, parsed from the message.
  branch?: string
  date: string
}

export interface StashResponse {
  stashes: StashEntry[]
}

export const ACTION_NAMES = [
  "add",
  "addAll",
  "unstage",
  "unstageAll",
  "commit",
  "push",
  "create",
  "delete",
  "discard",
  "discardAll",
  "discardStaged",
  "addWorktree",
  "removeWorktree",
  "switchBranch",
  "createBranch",
  "deleteBranch",
  "stash",
  "stashPop",
  "stashApply",
  "stashDrop",
  "fetch",
  "pull",
  "amend",
  "undoCommit",
  "revert",
  "cherryPick",
  "continueOperation",
  "abortOperation",
] as const

export type ActionName = (typeof ACTION_NAMES)[number]

export interface ActionPayload {
  files?: string[]
  // Commit message, or the stash message.
  message?: string
  // Repo-relative file path, or the absolute worktree path for add/removeWorktree.
  path?: string
  // addWorktree: branch to check out, creating it from `base` when `newBranch`.
  // switchBranch: local or remote ("origin/x") branch; createBranch/deleteBranch: local branch.
  branch?: string
  newBranch?: boolean
  // addWorktree/createBranch: start point (default HEAD).
  base?: string
  // removeWorktree: remove even with uncommitted changes.
  // deleteBranch: delete even when not fully merged.
  // push: overwrite the remote branch (--force-with-lease).
  force?: boolean
  // createBranch: switch to the new branch.
  checkout?: boolean
  // switchBranch: stash uncommitted changes first instead of refusing.
  // pull: stash them around the pull (--autostash).
  stash?: boolean
  // pull: rebase onto the upstream instead of fast-forwarding only.
  rebase?: boolean
  // revert/cherryPick: the commit. undoCommit: the HEAD the UI saw (refused
  // if HEAD has moved since).
  sha?: string
  // stash: include untracked files.
  includeUntracked?: boolean
  // stashPop/stashApply/stashDrop: n in stash@{n}.
  index?: number
}

export interface ActionRequest extends ActionPayload {
  action: ActionName
  repo?: string
}

// Starts the error of a push the remote refused as non-fast-forward, so the
// UI can offer a force push.
export const PUSH_REJECTED = "Push rejected"

export interface ActionResponse {
  success: true
  message: string
}

export interface ErrorResponse {
  error: string
}
