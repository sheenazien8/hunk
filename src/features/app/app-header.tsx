import { useState, type ReactNode } from "react"
import { Bot, Check, FilePlus, Folder, FolderGit2, FolderMinus, FolderPlus, GitBranch, Menu, Moon, PanelLeft, RefreshCw, RotateCcw, Search, Sun, TriangleAlert, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ActionResult } from "@/features/changes/use-git-actions"
import { projects } from "@/features/projects/projects"
import { findWorktree, worktreeLabel } from "@/features/worktrees/worktrees"
import type { ActionName, GitOperation, Worktree } from "@/lib/git/types"
import { cn } from "@/lib/utils"

function IconTip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  )
}

const OPERATION_LABEL: Record<GitOperation, string> = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
}

// A merge / rebase / cherry-pick / revert stopped half-way: finish or undo it.
function OperationBanner({ operation, busyAction, onContinue, onAbort }: {
  operation: GitOperation
  busyAction: ActionName | null
  onContinue: () => void
  onAbort: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200 sm:px-4">
      <TriangleAlert size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <strong>{OPERATION_LABEL[operation]} in progress.</strong>{" "}
        <span className="text-xs">Resolve any conflicts and mark the files resolved, then continue — or abort to go back.</span>
      </span>
      <Button size="sm" className="h-7 gap-1" disabled={!!busyAction} onClick={onContinue}>
        {busyAction === "continueOperation" ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
        Continue
      </Button>
      <Button variant="outline" size="sm" className="h-7 gap-1 text-destructive hover:text-destructive" disabled={!!busyAction} onClick={onAbort}>
        {busyAction === "abortOperation" ? <RefreshCw size={13} className="animate-spin" /> : <X size={13} />}
        Abort
      </Button>
    </div>
  )
}

const inputCls = "rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"

// Title bar (sidebar toggles, branch + stash controls, last action result,
// theme, new file, discard all) plus the project + worktree selectors /
// refresh / commit / push row.
export function AppHeader(props: {
  // Branch picker and stash menu.
  branchControls: ReactNode
  error: string
  loading: boolean
  actionResult: ActionResult | null
  busyAction: ActionName | null
  isDark: boolean
  projectDir: string
  repoPath: string
  worktrees: Worktree[]
  onToggleTheme: () => void
  onToggleSidebar: () => void
  agentOpen: boolean
  onToggleAgent: () => void
  onOpenMobileSidebar: () => void
  onNewFile: () => void
  onQuickOpen: () => void
  onDiscardAll: () => void
  onProjectChange: (project: string) => void
  onWorktreeChange: (repo: string) => void
  onAddWorktree: () => void
  onRemoveWorktree: (worktree: Worktree) => void
  onRefresh: () => void
  onCommit: (message: string) => Promise<boolean>
  // Subject of HEAD; amending is offered only when there is one.
  headSubject?: string
  // An empty message keeps HEAD's.
  onAmend: (message: string) => Promise<boolean>
  onPush: () => void
  operation?: GitOperation
  onContinueOperation: () => void
  onAbortOperation: () => void
}) {
  const { error, loading, actionResult, busyAction, isDark, worktrees, headSubject } = props
  const activeWorktree = findWorktree(worktrees, props.repoPath)
  const [commitMsg, setCommitMsg] = useState("")
  const [amendOn, setAmendOn] = useState(false)
  const amend = amendOn && !!headSubject
  const canCommit = !busyAction && (amend || !!commitMsg.trim())

  const commit = async () => {
    if (!canCommit) return
    if (await (amend ? props.onAmend(commitMsg) : props.onCommit(commitMsg))) {
      setCommitMsg("")
      setAmendOn(false)
    }
  }

  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
        <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" title="Open file sidebar" onClick={props.onOpenMobileSidebar}>
          <Menu size={16} />
        </Button>
        <Button variant="ghost" size="icon" className="hidden h-8 w-8 md:inline-flex" title="Toggle sidebar (Ctrl+B)" onClick={props.onToggleSidebar}>
          <PanelLeft size={16} />
        </Button>
        <GitBranch size={18} className="text-muted-foreground" />
        <h1 className="text-sm font-semibold sm:text-lg">Hunk</h1>
        <div className="flex min-w-0 items-center gap-1">{props.branchControls}</div>
        <div className="flex-1" />
        {actionResult && (
          <span
            className={cn("max-w-32 truncate text-xs sm:max-w-72", actionResult.ok ? "text-green-600 dark:text-green-400" : "text-destructive")}
            title={actionResult.message}
          >
            {actionResult.message}
          </span>
        )}
        <IconTip tip="Go to file (Ctrl+P)">
          <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Go to file" onClick={props.onQuickOpen}>
            <Search size={16} />
          </Button>
        </IconTip>
        <IconTip tip="Agent (Ctrl+I)">
          <Button
            variant={props.agentOpen ? "default" : "outline"}
            size="icon"
            className="h-9 w-9"
            aria-pressed={props.agentOpen}
            onClick={props.onToggleAgent}
          >
            <Bot size={16} />
          </Button>
        </IconTip>
        <Button variant="outline" size="sm" onClick={props.onToggleTheme} className="gap-2">
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
          <span className="hidden sm:inline">{isDark ? "Light" : "Dark"}</span>
        </Button>
        <IconTip tip="New File">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={props.onNewFile}>
            <FilePlus size={16} />
          </Button>
        </IconTip>
        <IconTip tip="Discard all changes">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 text-destructive hover:text-destructive"
            disabled={!!busyAction}
            onClick={props.onDiscardAll}
          >
            <RotateCcw size={16} />
          </Button>
        </IconTip>
      </div>

      <form
        onSubmit={e => { e.preventDefault(); props.onRefresh() }}
        className="grid grid-cols-4 gap-2 border-t border-border px-3 py-2 sm:flex sm:flex-wrap sm:items-center sm:px-4"
      >
        <div className="relative col-span-3 min-w-40 flex-1 sm:max-w-xs">
          <Folder size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <select
            value={props.projectDir}
            onChange={e => props.onProjectChange(e.target.value)}
            title={props.projectDir}
            className={cn(inputCls, "h-9 w-full cursor-pointer pl-9 pr-3 font-mono")}
          >
            {projects.map(p => (
              <option key={p.dir} value={p.dir}>{p.name}</option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" disabled={loading} className="col-span-1 gap-1.5">
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
        {worktrees.length > 0 && (
          <div className="col-span-4 flex gap-2 sm:min-w-64 sm:max-w-xs sm:flex-1">
            <div className="relative min-w-0 flex-1">
              <FolderGit2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <select
                value={activeWorktree?.path ?? props.repoPath}
                onChange={e => props.onWorktreeChange(e.target.value)}
                title={`Worktree: ${props.repoPath}`}
                className={cn(inputCls, "h-9 w-full cursor-pointer pl-9 pr-3 font-mono")}
              >
                {!activeWorktree && <option value={props.repoPath}>{props.repoPath}</option>}
                {worktrees.map(w => (
                  <option key={w.path} value={w.path} disabled={w.prunable || w.bare}>{worktreeLabel(w)}</option>
                ))}
              </select>
            </div>
            <IconTip tip="Add worktree">
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" disabled={!!busyAction} onClick={props.onAddWorktree}>
                <FolderPlus size={16} />
              </Button>
            </IconTip>
            <IconTip tip="Remove this worktree">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                disabled={!!busyAction || !activeWorktree || activeWorktree.main}
                onClick={() => activeWorktree && props.onRemoveWorktree(activeWorktree)}
              >
                <FolderMinus size={16} />
              </Button>
            </IconTip>
          </div>
        )}
        <div className="relative col-span-2 min-w-40 flex-1">
          <input
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault()
                void commit()
              }
            }}
            placeholder={amend ? `Empty keeps "${headSubject}"` : "Commit message…"}
            title={amend ? `Amending "${headSubject}"` : undefined}
            className={cn(inputCls, "h-9 w-full pl-3 pr-16 placeholder:text-muted-foreground", amend && "ring-1 ring-primary")}
          />
          {headSubject && (
            <button
              type="button"
              aria-pressed={amend}
              onClick={() => setAmendOn(!amendOn)}
              title={amend ? "Stop amending — make a new commit" : `Amend the last commit ("${headSubject}") instead of making a new one`}
              className={cn(
                "absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-ring",
                amend ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              Amend
            </button>
          )}
        </div>
        <Button type="button" size="sm" className="col-span-1 gap-1.5" disabled={!canCommit} onClick={() => void commit()}>
          {busyAction === "commit" || busyAction === "amend" ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
          {amend ? "Amend" : "Commit"}
        </Button>
        <Button type="button" variant="outline" size="sm" className="col-span-1 gap-1.5" disabled={!!busyAction} onClick={props.onPush}>
          {busyAction === "push" ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
          Push
        </Button>
      </form>

      {props.operation && (
        <OperationBanner
          operation={props.operation}
          busyAction={busyAction}
          onContinue={props.onContinueOperation}
          onAbort={props.onAbortOperation}
        />
      )}
      {error && (
        <div className="border-t border-border bg-destructive/10 px-3 py-1.5 text-sm text-destructive sm:px-4" title={error}>
          <span className="line-clamp-1">{error}</span>
        </div>
      )}
    </header>
  )
}
