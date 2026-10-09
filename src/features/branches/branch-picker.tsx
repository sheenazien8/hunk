import { useState } from "react"
import { ArrowDown, ArrowUp, Check, ChevronDown, Cloud, FolderGit2, FolderPlus, GitBranch, GitBranchPlus, History, Search, Trash2 } from "lucide-react"
import { moveOptionFocus, usePopover } from "@/hooks/use-popover"
import type { NewWorktreeSeed } from "@/features/worktrees/worktree-dialogs"
import type { Branch } from "@/lib/git/types"
import { localNameOf } from "./use-branches"
import { cn } from "@/lib/utils"

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

const rowCls = "group flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"

const iconBtn = "ml-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"

function BranchRow({ branch, otherWorktree, onSwitch, onHistory, onNewWorktree, onDelete }: {
  branch: Branch
  // Checked out in another worktree: git won't switch to it here, so
  // choosing it opens that worktree instead.
  otherWorktree: boolean
  onSwitch: () => void
  onHistory: () => void
  onNewWorktree?: () => void
  onDelete?: () => void
}) {
  const tip = [
    branch.name,
    branch.upstream && `tracks ${branch.upstream}`,
    otherWorktree && `checked out in ${branch.worktree} — click to open that worktree`,
    `${branch.shortSha} ${branch.subject}`,
  ].filter(Boolean).join("\n")
  return (
    <div className="flex items-center">
      <button
        type="button"
        role="option"
        aria-selected={branch.current}
        disabled={branch.current}
        onClick={onSwitch}
        title={tip}
        className={cn(rowCls, branch.current && "font-medium disabled:opacity-100")}
      >
        {branch.current
          ? <Check size={12} className="shrink-0 text-primary" />
          : branch.remote ? <Cloud size={12} className="shrink-0 text-muted-foreground" /> : <GitBranch size={12} className="shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate font-mono">{branch.name}</span>
        {otherWorktree && <FolderGit2 size={11} className="shrink-0 text-muted-foreground" />}
        {branch.ahead > 0 && <span className="flex shrink-0 items-center text-[10px] text-muted-foreground"><ArrowUp size={10} />{branch.ahead}</span>}
        {branch.behind > 0 && <span className="flex shrink-0 items-center text-[10px] text-muted-foreground"><ArrowDown size={10} />{branch.behind}</span>}
      </button>
      {onNewWorktree && (
        <button
          type="button"
          title={`Check out ${branch.name} in a new worktree…`}
          aria-label={`New worktree for ${branch.name}`}
          onClick={onNewWorktree}
          className={iconBtn}
        >
          <FolderPlus size={12} />
        </button>
      )}
      <button
        type="button"
        title={`Show the history of ${branch.name}`}
        aria-label={`History of ${branch.name}`}
        onClick={onHistory}
        className={iconBtn}
      >
        <History size={12} />
      </button>
      {onDelete && (
        <button
          type="button"
          title={`Delete ${branch.name}`}
          aria-label={`Delete ${branch.name}`}
          onClick={onDelete}
          className="ml-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}

// The current-branch badge in the header, opening a branch list: switch to a
// local or remote branch (or open the worktree it's checked out in), create
// one from the filter text — here or in a new worktree — check a branch out
// in a new worktree, delete local ones, or show a branch's history.
export function BranchPicker({ current, branches, repoPath, busy, onOpen, onSwitch, onCreate, onDelete, onHistory, onOpenWorktree, onNewWorktree }: {
  // Current branch; "" when HEAD is detached.
  current: string
  branches: Branch[]
  repoPath: string
  busy: boolean
  onOpen: () => void
  onSwitch: (branch: string) => void
  onCreate: (branch: string) => void
  onDelete: (branch: string) => void
  onHistory: (branch: string) => void
  onOpenWorktree: (path: string) => void
  onNewWorktree: (seed: NewWorktreeSeed) => void
}) {
  const { open, setOpen, rootRef, triggerRef } = usePopover()
  const [filter, setFilter] = useState("")

  const toggle = () => {
    if (open) return setOpen(false)
    setFilter("")
    onOpen()
    setOpen(true)
  }

  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  const q = filter.trim()
  const match = (b: Branch) => !q || b.name.toLowerCase().includes(q.toLowerCase())
  const local = branches.filter(b => !b.remote && match(b))
  const remote = branches.filter(b => b.remote && match(b))
  const canCreate = !!q && !/\s/.test(q) && !branches.some(b => !b.remote && b.name === q)
  const inOtherWorktree = (b: Branch) => !!b.worktree && !b.current && b.worktree.replace(/\/+$/, "") !== repoPath.replace(/\/+$/, "")
  const hasLocal = (name: string) => branches.some(b => !b.remote && b.name === name)

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        title={current ? `Branch: ${current}` : "Detached HEAD"}
        className="flex h-7 max-w-36 items-center gap-1.5 rounded-md px-1.5 text-sm hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-64"
      >
        <GitBranch size={14} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono text-xs">{current || "detached"}</span>
        <ChevronDown size={12} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          onKeyDown={moveOptionFocus}
          className="fixed inset-x-3 top-14 z-50 flex max-h-[70vh] sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-1 sm:w-80 flex-col rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <form
            className="relative border-b border-border p-1.5"
            onSubmit={e => {
              e.preventDefault()
              if (canCreate && !busy) run(() => onCreate(q))
            }}
          >
            <Search size={12} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Switch or create branch…"
              className="h-7 w-full rounded border border-input bg-background pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </form>
          <div role="listbox" aria-label="Branches" className="min-h-0 flex-1 overflow-y-auto p-1">
            {canCreate && (
              <>
                <button type="button" role="option" aria-selected={false} disabled={busy} onClick={() => run(() => onCreate(q))} className={rowCls}>
                  <GitBranchPlus size={12} className="shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">Create <span className="font-mono">{q}</span> from {current || "HEAD"}</span>
                  <kbd className="shrink-0 text-[10px] text-muted-foreground">↵</kbd>
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  disabled={busy}
                  onClick={() => run(() => onNewWorktree({ branch: q, newBranch: true }))}
                  className={rowCls}
                >
                  <FolderPlus size={12} className="shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate">Create <span className="font-mono">{q}</span> in a new worktree…</span>
                </button>
              </>
            )}
            {local.length > 0 && (
              <Group label="Local">
                {local.map(b => (
                  <BranchRow
                    key={b.name}
                    branch={b}
                    otherWorktree={inOtherWorktree(b)}
                    onSwitch={() => {
                      if (inOtherWorktree(b)) run(() => onOpenWorktree(b.worktree!))
                      else if (!busy) run(() => onSwitch(b.name))
                    }}
                    onHistory={() => run(() => onHistory(b.name))}
                    onNewWorktree={b.current || b.worktree ? undefined : () => run(() => onNewWorktree({ branch: b.name, newBranch: false }))}
                    onDelete={b.current || b.worktree ? undefined : () => run(() => onDelete(b.name))}
                  />
                ))}
              </Group>
            )}
            {remote.length > 0 && (
              <Group label="Remote">
                {remote.map(b => (
                  <BranchRow
                    key={b.name}
                    branch={b}
                    otherWorktree={false}
                    onSwitch={() => !busy && run(() => onSwitch(b.name))}
                    onHistory={() => run(() => onHistory(b.name))}
                    onNewWorktree={hasLocal(localNameOf(b.name))
                      ? undefined
                      : () => run(() => onNewWorktree({ branch: localNameOf(b.name), newBranch: true, base: b.name }))}
                  />
                ))}
              </Group>
            )}
            {local.length === 0 && remote.length === 0 && !canCreate && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">{q ? "No matching branches" : "No branches"}</div>
            )}
          </div>
          {!canCreate && (
            <div className="border-t border-border p-1">
              <button type="button" role="option" aria-selected={false} disabled={busy} onClick={() => run(() => onNewWorktree({ branch: "", newBranch: true }))} className={rowCls}>
                <FolderPlus size={12} className="shrink-0 text-primary" />
                <span className="flex-1">New worktree…</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
