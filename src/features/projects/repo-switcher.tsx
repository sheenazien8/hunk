import { type ReactNode, useState } from "react"
import { Check, ChevronDown, Folder, FolderGit2, FolderPlus, Search, Trash2 } from "lucide-react"
import { moveOptionFocus, usePopover } from "@/hooks/use-popover"
import { findWorktree, samePath, tailPath, worktreeLabel } from "@/features/worktrees/worktrees"
import type { Worktree } from "@/lib/git/types"
import { cn } from "@/lib/utils"
import { projects } from "./projects"

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

const rowCls = "flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"

// A two-line option: name, plus a muted path underneath.
function Row({ icon, name, path, active, disabled, onSelect, children }: {
  icon: ReactNode
  name: string
  path: string
  active: boolean
  disabled?: boolean
  onSelect: () => void
  // Trailing row actions.
  children?: ReactNode
}) {
  return (
    <div className="flex items-center">
      <button
        type="button"
        role="option"
        aria-selected={active}
        disabled={disabled}
        onClick={onSelect}
        title={path}
        className={cn(rowCls, active && "font-medium")}
      >
        <span className="shrink-0 text-muted-foreground">{active ? <Check size={12} className="text-primary" /> : icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{name}</span>
          <span className="block truncate font-mono text-[10px] font-normal text-muted-foreground">{tailPath(path)}</span>
        </span>
      </button>
      {children}
    </div>
  )
}

// Header breadcrumb root: the current project (and linked worktree, if one is
// open). Opens one searchable list to switch project or worktree, add a
// worktree, or remove one — the Zed / JetBrains "project widget".
export function RepoSwitcher({ projectDir, repoPath, worktrees, busy, onSelectProject, onSelectWorktree, onAddWorktree, onRemoveWorktree }: {
  projectDir: string
  repoPath: string
  worktrees: Worktree[]
  busy: boolean
  onSelectProject: (dir: string) => void
  onSelectWorktree: (path: string) => void
  onAddWorktree: () => void
  onRemoveWorktree: (worktree: Worktree) => void
}) {
  const { open, setOpen, rootRef, triggerRef } = usePopover()
  const [filter, setFilter] = useState("")

  const project = projects.find(p => samePath(p.dir, projectDir))
  const projectName = project?.name ?? tailPath(projectDir, 1)
  const active = findWorktree(worktrees, repoPath)
  // A linked worktree is open (not the project dir itself).
  const linked = !samePath(repoPath, projectDir)
  const linkedName = active ? worktreeLabel(active) : tailPath(repoPath, 1)

  const q = filter.trim().toLowerCase()
  const hit = (...s: (string | undefined)[]) => !q || s.some(v => v?.toLowerCase().includes(q))
  const shownWorktrees = worktrees.filter(w => !w.bare && hit(w.branch, w.path))
  const shownProjects = projects.filter(p => hit(p.name, p.dir))

  const toggle = () => {
    if (open) return setOpen(false)
    setFilter("")
    setOpen(true)
  }

  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  // Enter in the filter: the first match, worktrees first.
  const pickFirst = () => {
    const w = shownWorktrees.find(w => !w.prunable && !samePath(w.path, repoPath))
    if (w) return run(() => onSelectWorktree(w.path))
    const p = shownProjects.find(p => !samePath(p.dir, projectDir))
    if (p) run(() => onSelectProject(p.dir))
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        title={linked ? `${projectName} — worktree ${repoPath}` : `${projectName} — ${projectDir}`}
        className="flex h-7 max-w-40 items-center gap-1.5 rounded-md px-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-80"
      >
        {linked ? <FolderGit2 size={15} className="shrink-0 text-muted-foreground" /> : <Folder size={15} className="shrink-0 text-muted-foreground" />}
        <span className="hidden min-w-0 truncate sm:inline">{projectName}</span>
        {linked && <span className="hidden min-w-0 truncate font-mono text-xs font-normal text-muted-foreground sm:inline">{linkedName}</span>}
        <ChevronDown size={12} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          onKeyDown={moveOptionFocus}
          className="fixed inset-x-3 top-14 z-50 flex max-h-[70vh] sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-1 sm:w-80 flex-col rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <form className="relative border-b border-border p-1.5" onSubmit={e => { e.preventDefault(); pickFirst() }}>
            <Search size={12} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Switch project or worktree…"
              className="h-7 w-full rounded border border-input bg-background pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </form>
          <div role="listbox" aria-label="Projects and worktrees" className="min-h-0 flex-1 overflow-y-auto p-1">
            {shownWorktrees.length > 0 && (
              <Group label={`Worktrees · ${projectName}`}>
                {shownWorktrees.map(w => (
                  <Row
                    key={w.path}
                    icon={<FolderGit2 size={12} />}
                    name={worktreeLabel(w)}
                    path={w.path}
                    active={samePath(w.path, repoPath)}
                    disabled={w.prunable}
                    onSelect={() => !samePath(w.path, repoPath) && run(() => onSelectWorktree(w.path))}
                  >
                    {!w.main && (
                      <button
                        type="button"
                        title={`Remove the ${worktreeLabel(w)} worktree…`}
                        aria-label={`Remove worktree ${worktreeLabel(w)}`}
                        disabled={busy}
                        onClick={() => run(() => onRemoveWorktree(w))}
                        className="ml-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </Row>
                ))}
              </Group>
            )}
            {shownProjects.length > 0 && (
              <Group label="Projects">
                {shownProjects.map(p => (
                  <Row
                    key={p.dir}
                    icon={<Folder size={12} />}
                    name={p.name}
                    path={p.dir}
                    active={samePath(p.dir, projectDir)}
                    onSelect={() => !samePath(p.dir, projectDir) && run(() => onSelectProject(p.dir))}
                  />
                ))}
              </Group>
            )}
            {shownWorktrees.length === 0 && shownProjects.length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</div>
            )}
          </div>
          <div className="border-t border-border p-1">
            <button type="button" role="option" aria-selected={false} disabled={busy} onClick={() => run(onAddWorktree)} className={rowCls}>
              <FolderPlus size={12} className="shrink-0 text-primary" />
              <span className="flex-1">New worktree…</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
