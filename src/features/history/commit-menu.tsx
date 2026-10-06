import { type ReactNode, type RefObject, useState } from "react"
import { Cherry, Copy, ExternalLink, Undo2, Undo } from "lucide-react"
import { usePopover } from "@/hooks/use-popover"
import type { Commit } from "@/lib/git/types"

export type CommitActionKind = "revert" | "cherryPick" | "undoCommit"

// What the History list / commit tab need to offer commit actions.
export interface CommitActions {
  // Full sha of HEAD: only that commit can be undone.
  head?: string
  // Current branch ("" when detached): the cherry-pick target.
  branch: string
  busy: boolean
  run: (kind: CommitActionKind, commit: Commit) => void
  // Whether a commit is known to be on the current branch (best effort, from
  // the loaded history), where cherry-picking it would change nothing.
  isOnBranch: (sha: string) => boolean
}

// Which actions make sense for a commit. `onBranch`: it's in the current
// branch's history, where cherry-picking it would change nothing.
export function commitActionsFor(commit: Commit, actions: CommitActions, onBranch: boolean) {
  return {
    undo: commit.sha === actions.head,
    revert: true,
    cherryPick: !onBranch && !!actions.branch,
  }
}

const itemCls = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"

function Item({ icon, label, disabled, onClick }: { icon: ReactNode; label: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={itemCls}>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

export interface MenuTarget {
  commit: Commit
  x: number
  y: number
}

// The commit context menu's target (null when closed). Closes on an outside
// click or Escape.
export function useCommitMenu() {
  const { open, setOpen, rootRef } = usePopover()
  const [target, setTarget] = useState<MenuTarget | null>(null)
  const show = (next: MenuTarget) => {
    setTarget(next)
    setOpen(true)
  }
  return { target: open ? target : null, rootRef, show, close: () => setOpen(false) }
}

// Floating menu of one commit's actions, at the pointer (right-click) or
// under the row's "more" button.
export function CommitMenu({ target, rootRef, onBranch, actions, onOpen, onClose }: {
  target: MenuTarget
  rootRef: RefObject<HTMLDivElement | null>
  onBranch: boolean
  actions: CommitActions
  onOpen: () => void
  onClose: () => void
}) {
  const { commit } = target
  const can = commitActionsFor(commit, actions, onBranch)
  const run = (fn: () => void) => {
    onClose()
    fn()
  }
  // Keep the menu on screen.
  const left = Math.min(target.x, window.innerWidth - 232)
  const top = Math.min(target.y, window.innerHeight - 180)

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={`Commit ${commit.shortSha}`}
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
      className="fixed z-50 w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
    >
      <Item icon={<ExternalLink size={12} />} label="Open commit" onClick={() => run(onOpen)} />
      <Item
        icon={<Copy size={12} />}
        label="Copy sha"
        onClick={() => run(() => void navigator.clipboard?.writeText(commit.sha).catch(() => undefined))}
      />
      <div className="my-1 border-t border-border" />
      {can.undo && (
        <Item icon={<Undo size={12} />} label="Undo commit (keep changes)" disabled={actions.busy} onClick={() => run(() => actions.run("undoCommit", commit))} />
      )}
      <Item icon={<Undo2 size={12} />} label="Revert commit" disabled={actions.busy} onClick={() => run(() => actions.run("revert", commit))} />
      {can.cherryPick && (
        <Item
          icon={<Cherry size={12} />}
          label={<>Cherry-pick onto <span className="font-mono">{actions.branch}</span></>}
          disabled={actions.busy}
          onClick={() => run(() => actions.run("cherryPick", commit))}
        />
      )}
    </div>
  )
}
