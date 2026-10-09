import { useState } from "react"
import { Archive, Eye, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePopover } from "@/hooks/use-popover"
import type { StashEntry } from "@/lib/git/types"
import { timeAgo } from "@/lib/time-ago"
import { cn } from "@/lib/utils"

// "On main: msg" / "WIP on main: abc123 subject" → the part after the branch.
function stashTitle(s: StashEntry) {
  return s.message.replace(/^(?:WIP on|On) [^:]+: /, "") || s.message
}

function StashRow({ stash, busy, onView, onApply, onPop, onDrop }: {
  stash: StashEntry
  busy: boolean
  onView: () => void
  onApply: () => void
  onPop: () => void
  onDrop: () => void
}) {
  const small = "h-6 px-2 text-[11px]"
  return (
    <div className="rounded px-2 py-1.5 hover:bg-accent/50" title={stash.message}>
      <div className="flex items-center gap-2 text-xs">
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{stash.index}</span>
        <span className="min-w-0 flex-1 truncate">{stashTitle(stash)}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(stash.date)}</span>
      </div>
      <div className="mt-1 flex items-center gap-1">
        {stash.branch && <span className="mr-auto min-w-0 truncate font-mono text-[10px] text-muted-foreground">{stash.branch}</span>}
        <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" title="Show changes" onClick={onView}>
          <Eye size={12} />
        </Button>
        <Button variant="outline" size="sm" className={small} disabled={busy} title="Apply and keep in the stash" onClick={onApply}>Apply</Button>
        <Button variant="outline" size="sm" className={small} disabled={busy} title="Apply and remove from the stash" onClick={onPop}>Pop</Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          disabled={busy}
          title="Drop"
          onClick={onDrop}
        >
          <Trash2 size={12} />
        </Button>
      </div>
    </div>
  )
}

// Header stash menu: stash the working tree (optionally with untracked
// files), and apply / pop / drop / inspect existing stashes.
export function StashMenu({ stashes, busy, onOpen, onStash, onView, onApply, onPop, onDrop }: {
  stashes: StashEntry[]
  busy: boolean
  onOpen: () => void
  onStash: (message: string, includeUntracked: boolean) => Promise<boolean>
  onView: (stash: StashEntry) => void
  onApply: (stash: StashEntry) => void
  onPop: (stash: StashEntry) => void
  onDrop: (stash: StashEntry) => void
}) {
  const { open, setOpen, rootRef, triggerRef } = usePopover()
  const [message, setMessage] = useState("")
  const [untracked, setUntracked] = useState(false)

  const toggle = () => {
    if (open) return setOpen(false)
    onOpen()
    setOpen(true)
  }

  const submit = async () => {
    if (busy) return
    if (await onStash(message.trim(), untracked)) setMessage("")
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        title="Stash"
        className="flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <Archive size={12} />
        {stashes.length > 0 && <span className="tabular-nums">{stashes.length}</span>}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-14 z-50 flex max-h-[60vh] sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-1 sm:w-80 flex-col rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
          <form
            className="space-y-1.5 border-b border-border p-2"
            onSubmit={e => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="flex gap-1.5">
              <input
                autoFocus
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Stash message (optional)"
                className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button type="submit" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy}>
                {busy ? <RefreshCw size={12} className="animate-spin" /> : <Archive size={12} />}
                Stash
              </Button>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={untracked} onChange={e => setUntracked(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
              Include untracked files
            </label>
          </form>
          <div className={cn("min-h-0 flex-1 overflow-y-auto p-1", stashes.length === 0 && "py-3")}>
            {stashes.length === 0 && <div className="text-center text-xs text-muted-foreground">No stashes</div>}
            {stashes.map(s => (
              <StashRow
                key={s.sha}
                stash={s}
                busy={busy}
                onView={() => {
                  setOpen(false)
                  onView(s)
                }}
                onApply={() => onApply(s)}
                onPop={() => onPop(s)}
                onDrop={() => onDrop(s)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
