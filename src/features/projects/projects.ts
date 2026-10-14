import projectsFile from "../../../projects.json"

export interface Project {
  name: string
  dir: string
}

// Trailing slashes are dropped so the dir is the one key every consumer (API
// routes, plugin iframes, the MCP bridge) agrees on.
const trimSlash = (dir: string) => (dir.length > 1 ? dir.replace(/\/+$/, "") : dir)

// Imported at build time — edits to projects.json need a rebuild.
export const projects: Project[] = projectsFile.projects.map(p => ({ ...p, dir: trimSlash(p.dir) }))

export const defaultRepo = projects[0]?.dir ?? ""

// The selected project plus the worktree of it the app is pointed at (the
// project dir itself unless a linked worktree is selected).
export interface RepoSelection {
  project: string
  repo: string
}

// Selection from ?project=<name> (exact, case-sensitive match) and
// ?worktree=<path>, if either is present.
export function selectionFromUrl(): RepoSelection | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const name = params.get("project")
    const worktree = params.get("worktree")
    const project = (name && projects.find(p => p.name === name)?.dir) || null
    if (!project && !worktree) return null
    const dir = project ?? defaultRepo
    return { project: dir, repo: worktree || dir }
  } catch {
    return null
  }
}

// Keeps ?project= / ?worktree= in the URL in sync so reloads keep the same repo.
export function syncRepoToUrl({ project, repo }: RepoSelection) {
  const params = new URLSearchParams()
  if (project !== defaultRepo) params.set("project", projects.find(p => p.dir === project)?.name ?? "")
  if (repo !== project) params.set("worktree", repo)
  const qs = params.toString()
  window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
}
