import type { ReactNode } from "react"
import { ArrowDown, ArrowDownToLine, ArrowUp, Cloud, CloudOff, GitPullRequestArrow, RefreshCw, Upload } from "lucide-react"
import type { RepoState } from "@/features/changes/use-git-status"
import { usePopover } from "@/hooks/use-popover"
import type { ActionName } from "@/lib/git/types"
import { cn } from "@/lib/utils"

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

function MenuButton({ icon, label, hint, busy, disabled, onClick }: {
  icon: ReactNode
  label: string
  hint: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground">{busy ? <RefreshCw size={12} className="animate-spin" /> : icon}</span>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-[10px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}

// Header sync control: how far the branch is ahead of / behind its upstream
// (as of the last fetch), opening fetch / pull / push.
export function SyncMenu({ branch, state, busyAction, onFetch, onPull, onPush }: {
  // Current branch; "" when HEAD is detached.
  branch: string
  state: RepoState
  busyAction: ActionName | null
  onFetch: () => void
  onPull: (rebase: boolean) => void
  onPush: () => void
}) {
  const { open, setOpen, rootRef, triggerRef } = usePopover()
  const { upstream, ahead, behind, gone } = state
  const busy = !!busyAction
  const tracking = !!upstream && !gone

  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  const summary = !branch
    ? "Detached HEAD — check out a branch to sync"
    : gone
      ? `${upstream} was deleted on the remote`
      : !upstream
        ? `${branch} isn't on a remote yet — Push publishes it to origin`
        : ahead === 0 && behind === 0
          ? `Up to date with ${upstream}`
          : [ahead > 0 && `${plural(ahead, "commit")} to push`, behind > 0 && `${plural(behind, "commit")} to pull`].filter(Boolean).join(" · ")

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        aria-label={`Sync: ${summary}`}
        title={`Sync — ${summary}${tracking ? " (as of the last fetch)" : ""}`}
        className={cn(
          "flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-xs text-muted-foreground tabular-nums hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring",
          gone && "text-destructive",
        )}
      >
        {busyAction === "fetch" || busyAction === "pull" || busyAction === "push"
          ? <RefreshCw size={12} className="animate-spin" />
          : tracking ? <Cloud size={12} /> : <CloudOff size={12} />}
        {tracking && ahead > 0 && <span className="flex items-center"><ArrowUp size={10} />{ahead}</span>}
        {tracking && behind > 0 && <span className="flex items-center text-foreground"><ArrowDown size={10} />{behind}</span>}
      </button>

      {open && (
        <div
          role="menu"
          className="fixed inset-x-3 top-14 z-50 sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-1 sm:w-72 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <div className="border-b border-border px-2 pb-1.5 pt-1 text-[11px]">
            {upstream && <div className="truncate font-mono text-muted-foreground">{branch} → {upstream}</div>}
            <div className={cn(gone && "text-destructive")}>{summary}</div>
          </div>
          <div className="pt-1">
            <MenuButton
              icon={<ArrowDownToLine size={12} />}
              label="Fetch"
              hint="Update remote branches; changes nothing locally"
              busy={busyAction === "fetch"}
              disabled={busy}
              onClick={() => run(onFetch)}
            />
            <MenuButton
              icon={<ArrowDown size={12} />}
              label="Pull"
              hint="Fast-forward to the upstream; refuses if the branches diverged"
              busy={busyAction === "pull"}
              disabled={busy || !tracking}
              onClick={() => run(() => onPull(false))}
            />
            <MenuButton
              icon={<GitPullRequestArrow size={12} />}
              label="Pull with rebase"
              hint="Replay your local commits on top of the upstream"
              busy={false}
              disabled={busy || !tracking}
              onClick={() => run(() => onPull(true))}
            />
            <MenuButton
              icon={<Upload size={12} />}
              label="Push"
              hint={upstream && !gone ? `Send your commits to ${upstream}` : "Publish the branch to origin"}
              busy={busyAction === "push"}
              disabled={busy || !branch}
              onClick={() => run(onPush)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
