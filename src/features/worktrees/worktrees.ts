import type { Worktree } from "@/lib/git/types"

function trimSlashes(p: string) {
  return p.replace(/\/+$/, "") || "/"
}

// Paths from projects.json and from git may differ by a trailing slash.
export function samePath(a: string, b: string) {
  return trimSlashes(a) === trimSlashes(b)
}

export function findWorktree(worktrees: Worktree[], dir: string) {
  return worktrees.find(w => samePath(w.path, dir))
}

// Default location for a new worktree: a sibling of the main worktree named
// `<repo>-<branch>`, e.g. /code/app + feat/login → /code/app-feat-login.
export function defaultWorktreePath(mainDir: string, branch: string) {
  const main = trimSlashes(mainDir)
  const slash = main.lastIndexOf("/")
  const parent = main.slice(0, slash) || ""
  const name = main.slice(slash + 1)
  const slug = branch.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "")
  return `${parent}/${name}${slug ? `-${slug}` : ""}`
}

export function worktreeLabel(w: Worktree) {
  const name = w.branch ?? (w.bare ? "(bare)" : `detached @ ${w.head.slice(0, 7)}`)
  if (w.main) return `${name} (main)`
  return w.prunable ? `${name} (missing)` : name
}

// The last `parts` segments of a path, for compact pickers:
// /mnt/code/app-feat → "…/code/app-feat".
export function tailPath(p: string, parts = 2) {
  const segs = trimSlashes(p).split("/").filter(Boolean)
  if (segs.length <= parts) return trimSlashes(p)
  return `…/${segs.slice(-parts).join("/")}`
}
