import type { ReactNode } from "react"
import { GitCommitHorizontal, Puzzle, RefreshCw, X, XSquare } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { basename } from "@/features/files/file-types"
import { statusIcon } from "@/features/files/status-display"
import type { GitFile } from "@/lib/git/types"
import { cn } from "@/lib/utils"
import type { BufferEntry } from "./buffer"

function Tip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">{tip}</TooltipContent>
    </Tooltip>
  )
}

// Tab strip — one entry per open file. Click a tab to activate; ↻ to refresh
// its content; × to close (confirming when there are unsaved edits).
// Right-click (long-press on touch) a tab for Close / Others / to the Right /
// All; with 2+ tabs a "Close all" button sits at the end of the strip.
export function TabBar({ entries, activeId, files, pluginName, onActivate, onRefresh, onClose, onCloseMany }: {
  entries: BufferEntry[]
  activeId: string | null
  files: GitFile[]
  pluginName: (id: string) => string
  onActivate: (id: string) => void
  onRefresh: (entry: BufferEntry) => void
  onClose: (entry: BufferEntry) => void
  // Close several tabs (asks once if any has unsaved edits).
  onCloseMany: (entries: BufferEntry[]) => void
}) {
  if (entries.length === 0) return null

  return (
    <div className="diff-tabs mb-1 flex min-h-8 items-center gap-1 rounded-md border border-border bg-card px-1 py-1">
      <div
        role="tablist"
        aria-label="Open files"
        className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto"
      >
        {entries.map((entry, i) => {
          const isActive = entry.id === activeId
          const status = files.find(f => f.path === entry.file && f.staged === entry.staged)?.status
            ?? (entry.fromAll ? "untracked" : "modified")
          const subject = entry.commitData?.commit.subject
          const label = entry.plugin ? pluginName(entry.plugin) : entry.commit ? subject || entry.commit.slice(0, 7) : basename(entry.file)
          const tip = entry.plugin
            ? `Plugin: ${label}`
            : entry.commit
            ? `Commit ${entry.commit.slice(0, 10)}${subject ? ` — ${subject}` : ""}`
            : `${entry.file}${entry.staged ? " (staged)" : ""}${entry.fromAll ? " (from All Files)" : ""}`
          return (
            <ContextMenu key={entry.id}>
              <ContextMenuTrigger asChild>
                <div
                  role="tab"
                  aria-selected={isActive}
                  data-tab-id={entry.id}
                  className={cn(
                    "group flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs outline-none transition-colors",
                    isActive ? "border-primary/40 bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Tip tip={<p className="text-xs">{tip}</p>}>
                    <button type="button" onClick={() => onActivate(entry.id)} className="flex min-w-0 items-center gap-1.5 text-left">
                      <span className="shrink-0">{entry.plugin ? <Puzzle size={14} /> : entry.commit ? <GitCommitHorizontal size={14} /> : statusIcon(status)}</span>
                      <span className="max-w-40 truncate">{label}</span>
                      {entry.dirty && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label="Unsaved changes" />}
                      {entry.diffLoading && <RefreshCw size={11} className="shrink-0 animate-spin text-muted-foreground" />}
                    </button>
                  </Tip>
                  <Tip tip="Refresh">
                    <button
                      type="button"
                      aria-label={`Refresh ${entry.file || label}`}
                      disabled={entry.diffLoading}
                      onClick={e => { e.stopPropagation(); onRefresh(entry) }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                    >
                      <RefreshCw size={11} />
                    </button>
                  </Tip>
                  <Tip tip="Close tab">
                    <button
                      type="button"
                      aria-label={`Close ${entry.file || label}`}
                      onClick={e => { e.stopPropagation(); onClose(entry) }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                    >
                      <X size={11} />
                    </button>
                  </Tip>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem onSelect={() => onClose(entry)}>Close</ContextMenuItem>
                <ContextMenuItem disabled={entries.length < 2} onSelect={() => onCloseMany(entries.filter(e => e.id !== entry.id))}>
                  Close Others
                </ContextMenuItem>
                <ContextMenuItem disabled={i === entries.length - 1} onSelect={() => onCloseMany(entries.slice(i + 1))}>
                  Close to the Right
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onCloseMany(entries)}>Close All</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      {entries.length > 1 && (
        <Tip tip="Close all tabs">
          <button
            type="button"
            aria-label="Close all tabs"
            onClick={() => onCloseMany(entries)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <XSquare size={14} />
          </button>
        </Tip>
      )}
    </div>
  )
}
