import { type ReactNode, useEffect, useRef } from "react"
import { GitBranch, History as HistoryIcon, Loader2, MoreHorizontal, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { basename } from "@/features/files/file-types"
import type { Commit } from "@/lib/git/types"
import { timeAgo } from "@/lib/time-ago"
import { cn } from "@/lib/utils"
import { CommitMenu, type CommitActions, useCommitMenu } from "./commit-menu"
import type { History } from "./use-history"

function matches(c: Commit, q: string) {
  return c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.sha.startsWith(q)
}

function Chip({ icon, label, title, clearTitle, onClear }: {
  icon: ReactNode
  label: string
  title: string
  clearTitle: string
  onClear: () => void
}) {
  return (
    <span
      className="flex min-w-0 items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[11px]"
      title={title}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={clearTitle}
        title={clearTitle}
        onClick={onClear}
        className="ml-auto shrink-0 rounded text-muted-foreground hover:text-foreground"
      >
        <X size={11} />
      </button>
    </span>
  )
}

// The History sidebar tab: commits of the current branch or another one,
// optionally of one file, newest first, loading more as the end scrolls into
// view. Each commit has a menu (right-click or "…") of commit actions.
export function HistoryList({ history, search, activeCommit, actions, onOpenCommit }: {
  history: History
  // The sidebar's search box: filters the loaded commits.
  search: string
  activeCommit: string | undefined
  actions: CommitActions
  onOpenCommit: (sha: string, file?: string) => void
}) {
  const { ensureLoaded, loadMore } = history
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { target: menu, rootRef: menuRef, show: showMenu, close: closeMenu } = useCommitMenu()
  // Listing another branch: its commits can be cherry-picked here.
  const onBranch = !history.ref || history.ref === actions.branch

  useEffect(() => {
    ensureLoaded()
  }, [ensureLoaded])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) loadMore()
    }, { rootMargin: "200px" })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore, history.commits.length])

  const q = search.trim().toLowerCase()
  const commits = q ? history.commits.filter(c => matches(c, q)) : history.commits

  return (
    <div className="pb-1">
      <div className="flex items-center gap-1 px-1 pb-1">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {history.ref && (
            <Chip
              icon={<GitBranch size={11} />}
              label={history.ref}
              title={`Commits of ${history.ref}`}
              clearTitle="Back to the current branch"
              onClear={() => history.showRef(null)}
            />
          )}
          {history.file && (
            <Chip
              icon={<HistoryIcon size={11} />}
              label={basename(history.file)}
              title={history.file}
              clearTitle="Show all files"
              onClear={() => history.showFile(null)}
            />
          )}
          {!history.ref && !history.file && <span className="px-1 text-[11px] text-muted-foreground">All commits</span>}
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" title="Refresh history" disabled={history.loading} onClick={history.reload}>
          <RefreshCw size={11} className={cn(history.loading && "animate-spin")} />
        </Button>
      </div>

      {commits.map(c => (
        <div key={c.sha} className="group relative">
          <button
            type="button"
            onClick={() => onOpenCommit(c.sha, history.file ?? undefined)}
            onContextMenu={e => {
              e.preventDefault()
              showMenu({ commit: c, x: e.clientX, y: e.clientY })
            }}
            title={`${c.subject}\n\n${c.shortSha} · ${c.author} · ${new Date(c.date).toLocaleString()}`}
            className={cn(
              "block w-full rounded-md px-2 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              c.sha === activeCommit ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <div className="truncate pr-5">{c.subject || "(no message)"}</div>
            <div className={cn("flex gap-1.5 text-[10px]", c.sha === activeCommit ? "text-primary-foreground/80" : "text-muted-foreground")}>
              <span className="font-mono">{c.shortSha}</span>
              {c.sha === actions.head && <span className="shrink-0 rounded border border-current px-1 leading-tight">HEAD</span>}
              <span className="min-w-0 truncate">{c.author}</span>
              <span className="ml-auto shrink-0">{timeAgo(c.date)}</span>
            </div>
          </button>
          <button
            type="button"
            aria-label={`Actions for ${c.shortSha}`}
            title="Commit actions"
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect()
              showMenu({ commit: c, x: r.right - 224, y: r.bottom + 2 })
            }}
            className={cn(
              "absolute right-1 top-1 rounded p-0.5 opacity-100 hover:bg-background/40 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100",
              c.sha === activeCommit ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <MoreHorizontal size={13} />
          </button>
        </div>
      ))}
      {menu && (
        <CommitMenu
          target={menu}
          rootRef={menuRef}
          onBranch={onBranch}
          actions={actions}
          onOpen={() => onOpenCommit(menu.commit.sha, history.file ?? undefined)}
          onClose={closeMenu}
        />
      )}

      {history.error && <p className="px-2 py-2 text-[11px] text-destructive">{history.error}</p>}
      {!history.loading && !history.error && commits.length === 0 && (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">{q && history.commits.length > 0 ? "No matches" : "No commits yet"}</p>
      )}
      <div ref={sentinelRef} className="h-px" />
      {history.loading ? (
        <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Loading history…
        </div>
      ) : history.hasMore && (
        <Button variant="ghost" size="sm" className="h-7 w-full text-[11px]" onClick={loadMore}>Load more</Button>
      )}
    </div>
  )
}
