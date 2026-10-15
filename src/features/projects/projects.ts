import type { Project } from "@/lib/git/types"

export type { Project }

export const defaultRepo = (projects: Project[]) => projects[0]?.dir ?? ""

// Parent directory of a path, for prefilling "Add project" (a sibling repo).
export function parentDir(p: string): string {
  const trimmed = p.replace(/\/+$/, "")
  const slash = trimmed.lastIndexOf("/")
  return slash > 0 ? trimmed.slice(0, slash) : trimmed
}

// The selected project plus the worktree of it the app is pointed at (the
// project dir itself unless a linked worktree is selected).
export interface RepoSelection {
  project: string
  repo: string
}

// Selection from ?project=<name> (exact, case-sensitive match) and
// ?worktree=<path>, if either is present.
export function selectionFromUrl(projects: Project[]): RepoSelection | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const name = params.get("project")
    const worktree = params.get("worktree")
    const project = (name && projects.find(p => p.name === name)?.dir) || null
    if (!project && !worktree) return null
    const dir = project ?? defaultRepo(projects)
    return { project: dir, repo: worktree || dir }
  } catch {
    return null
  }
}

// Keeps ?project= / ?worktree= in the URL in sync so reloads keep the same repo.
export function syncRepoToUrl({ project, repo }: RepoSelection, projects: Project[]) {
  const params = new URLSearchParams()
  if (project !== defaultRepo(projects)) params.set("project", projects.find(p => p.dir === project)?.name ?? "")
  if (repo !== project) params.set("worktree", repo)
  const qs = params.toString()
  window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
}
