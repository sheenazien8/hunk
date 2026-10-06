import { parseTrack } from "./parse-branches"
import type { FileStatus, GitFile } from "./types"

// Status of a change that only exists in the index (staged)
function indexStatus(c: string): FileStatus {
  switch (c) {
    case "A": return "added"
    case "D": return "deleted"
    case "R": return "renamed"
    case "C": return "added"
    default: return "modified"
  }
}

// Status of a change between the index and the worktree (unstaged)
function worktreeStatus(c: string): FileStatus {
  return c === "D" ? "deleted" : "modified"
}

// XY codes of unmerged paths (both sides changed, or one side deleted).
const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])

export interface BranchHeader {
  upstream?: string
  ahead: number
  behind: number
  gone?: boolean
}

// The "## …" line `git status --porcelain --branch` starts with:
//   ## main                               no upstream
//   ## main...origin/main [ahead 1, behind 2]
//   ## main...origin/main [gone]          upstream deleted on the remote
//   ## No commits yet on main             unborn ("Initial commit on" in old git)
//   ## HEAD (no branch)                   detached
// Branch names can't contain "..", so "..." always separates the upstream.
export function parseBranchHeader(output: string): BranchHeader {
  const line = output.split("\n").find(l => l.startsWith("## ")) ?? ""
  const m = /^## (?:.*?)\.\.\.(\S+)(?: \[(.*)\])?$/.exec(line)
  if (!m) return { ahead: 0, behind: 0 }
  const track = m[2] ?? ""
  return { upstream: m[1], ...parseTrack(track), ...(track === "gone" ? { gone: true } : {}) }
}

// Parses `git status --porcelain` (v1) output, with or without the --branch
// header line.
export function parseStatus(output: string): GitFile[] {
  const files: GitFile[] = []

  for (const line of output.split("\n").filter(Boolean)) {
    if (line.startsWith("## ")) continue
    const index = line[0]
    const worktree = line[1]
    const path = line.slice(3)

    if (index === "?" && worktree === "?") {
      files.push({ path, status: "untracked", staged: false })
      continue
    }
    // Nothing is staged for an unmerged path until it's resolved (`git add`).
    if (UNMERGED.has(index + worktree)) {
      files.push({ path, status: "conflicted", staged: false })
      continue
    }

    const [renameFrom, newPath] = path.split(" -> ")
    const filePath = newPath || path

    // A file can have both staged and unstaged changes ("MM", "AM", …) —
    // emit one entry per side so the UI can show them in separate sections.
    if (index !== " ") {
      files.push({ path: filePath, status: indexStatus(index), staged: true, oldPath: newPath ? renameFrom : undefined })
    }
    if (worktree !== " ") {
      files.push({
        path: filePath,
        status: worktreeStatus(worktree),
        staged: false,
        oldPath: index !== " " || !newPath ? undefined : renameFrom,
      })
    }
  }

  return files
}
