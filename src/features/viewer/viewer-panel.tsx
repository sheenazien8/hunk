import type { ReactNode } from "react"
import {
  AlignJustify,
  Check,
  Cherry,
  Eye,
  FileCode,
  FilePen,
  History,
  Maximize,
  Minimize,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScanText,
  Search,
  Split,
  Trash2,
  Undo,
  Undo2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { BufferEntry, ViewMode } from "@/features/buffer/buffer"
import { basename, isMarkdownFile } from "@/features/files/file-types"
import { FindBar } from "@/features/find/find-bar"
import type { Find } from "@/features/find/use-find"
import { type CommitActions, commitActionsFor } from "@/features/history/commit-menu"
import type { ConflictChoice } from "@/lib/git/parse-conflict"
import type { ActionName } from "@/lib/git/types"
import { FileViewer } from "./file-viewer"
import { useFullscreen } from "./use-fullscreen"

export interface ViewerHandlers {
  save: () => void
  toggleEdit: () => void
  editChange: (content: string) => void
  discard: (entry: BufferEntry) => void
  toggleStaged: (entry: BufferEntry) => void
  toggleMarkdown: (entry: BufferEntry) => void
  setViewMode: (entry: BufferEntry, mode: ViewMode) => void
  delete: (file: string) => void
  toggleFind: () => void
  toggleBlame: (entry: BufferEntry) => void
  showHistory: (file: string) => void
  openCommit: (sha: string) => void
  openFile: (file: string) => void
  resolveConflict: (index: number, choice: ConflictChoice) => void
  // Drop conflict resolutions that haven't been saved.
  revertResolutions: (entry: BufferEntry) => void
  // Stage a conflicted file (git add).
  markResolved: (entry: BufferEntry) => void
}

function IconTip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="left">{tip}</TooltipContent>
    </Tooltip>
  )
}

// The main card: file title + toolbar, find bar, and the file view.
export function ViewerPanel({ active, repoPath, fullPath, conflicted, busyAction, isSaving, canEdit, commitActions, find, on }: {
  active: BufferEntry | null
  repoPath: string
  fullPath: string
  // The active file is unmerged (conflict view).
  conflicted: boolean
  busyAction: ActionName | null
  isSaving: boolean
  canEdit: boolean
  commitActions: CommitActions
  find: Find
  on: ViewerHandlers
}) {
  const { ref: cardRef, isFullscreen, toggle: toggleFullscreen } = useFullscreen<HTMLDivElement>()
  const editing = !!active?.editMode
  const commit = active?.commit
  // Conflict resolution replaces the diff views (manual editing still works).
  const resolving = conflicted && !editing
  // Toolbar for a working-tree file (not a commit tab).
  const fileTools = !!active && !commit
  const commitData = commit ? active?.commitData?.commit : undefined
  // Cherry-pick is offered unless the commit is known to be on this branch;
  // the server says so when it would change nothing anyway.
  const can = commitData ? commitActionsFor(commitData, commitActions, commitActions.isOnBranch(commitData.sha)) : null

  let title = active ? basename(active.file) : "Select a file"
  if (commit) title = `Commit ${commit.slice(0, 7)}`
  const subtitle = commit ? active?.commitData?.commit.subject ?? "" : active?.file

  return (
    <Card ref={cardRef} className="diff-card flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="shrink-0 p-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="truncate text-sm">{title}</CardTitle>
          {active && (
            <div className="flex items-center gap-1">
              {commitData && can && (
                <>
                  {can.undo && (
                    <IconTip tip="Undo this commit (its changes stay staged)">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1"
                        disabled={commitActions.busy}
                        onClick={() => commitActions.run("undoCommit", commitData)}
                      >
                        {busyAction === "undoCommit" ? <RefreshCw size={13} className="animate-spin" /> : <Undo size={13} />}
                        <span className="hidden sm:inline">Undo</span>
                      </Button>
                    </IconTip>
                  )}
                  <IconTip tip="Revert — add a commit that undoes this one">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1"
                      disabled={commitActions.busy}
                      onClick={() => commitActions.run("revert", commitData)}
                    >
                      {busyAction === "revert" ? <RefreshCw size={13} className="animate-spin" /> : <Undo2 size={13} />}
                      <span className="hidden sm:inline">Revert</span>
                    </Button>
                  </IconTip>
                  {can.cherryPick && (
                    <IconTip tip={`Cherry-pick onto ${commitActions.branch}`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1"
                        disabled={commitActions.busy}
                        onClick={() => commitActions.run("cherryPick", commitData)}
                      >
                        {busyAction === "cherryPick" ? <RefreshCw size={13} className="animate-spin" /> : <Cherry size={13} />}
                        <span className="hidden sm:inline">Cherry-pick</span>
                      </Button>
                    </IconTip>
                  )}
                </>
              )}
              {(editing || (resolving && active.dirty)) && (
                <Button variant="default" size="sm" className="h-7 gap-1" disabled={!active.dirty || isSaving} onClick={on.save}>
                  {isSaving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                  Save
                </Button>
              )}
              {resolving && active.dirty && (
                <IconTip tip="Revert unsaved resolutions">
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => on.revertResolutions(active)}>
                    <Undo2 size={13} />
                  </Button>
                </IconTip>
              )}
              {resolving && (
                <IconTip tip={active.dirty ? "Save before marking as resolved" : "Mark as resolved (stage)"}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1"
                    disabled={active.dirty || !!busyAction}
                    onClick={() => on.markResolved(active)}
                  >
                    {busyAction === "add" ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                    <span className="hidden sm:inline">Mark resolved</span>
                  </Button>
                </IconTip>
              )}
              {fileTools && !active.fromAll && !editing && !resolving && (
                <>
                  <IconTip tip={active.staged ? "Discard staged changes" : "Discard changes"}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      disabled={!!busyAction}
                      onClick={() => on.discard(active)}
                    >
                      <RotateCcw size={13} />
                    </Button>
                  </IconTip>
                  <IconTip tip={active.staged ? "Unstage this file" : "Stage this file"}>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={!!busyAction} onClick={() => on.toggleStaged(active)}>
                      {busyAction === "add" || busyAction === "unstage"
                        ? <RefreshCw size={13} className="animate-spin" />
                        : active.staged ? <Minus size={13} /> : <Plus size={13} />}
                    </Button>
                  </IconTip>
                </>
              )}
              {fileTools && isMarkdownFile(active.file) && !editing && !resolving && active.viewMode !== "blame" && (
                <Button
                  variant={active.mdRender ? "default" : "outline"}
                  size="icon"
                  className="h-7 w-7"
                  title="Render as Markdown"
                  onClick={() => on.toggleMarkdown(active)}
                >
                  <Eye size={13} />
                </Button>
              )}
              {fileTools && canEdit && !editing && (
                <IconTip tip="Edit file">
                  <Button variant="outline" size="icon" className="h-7 w-7" title="Edit file" onClick={on.toggleEdit}>
                    <FilePen size={13} />
                  </Button>
                </IconTip>
              )}
              {fileTools && active.fromAll && !editing && (
                <IconTip tip="Delete file">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    title="Delete file"
                    onClick={() => on.delete(active.file)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </IconTip>
              )}
              {editing && (
                <IconTip tip="Cancel editing">
                  <Button variant="outline" size="icon" className="h-7 w-7" title="Cancel editing" onClick={on.toggleEdit}>
                    <Minus size={13} />
                  </Button>
                </IconTip>
              )}
              {fileTools && !editing && (
                <IconTip tip="File history">
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => on.showHistory(active.file)}>
                    <History size={13} />
                  </Button>
                </IconTip>
              )}
              {fileTools && !editing && !resolving && (
                <IconTip tip="Blame">
                  <Button
                    variant={active.viewMode === "blame" ? "default" : "outline"}
                    size="icon"
                    className="h-7 w-7"
                    aria-pressed={active.viewMode === "blame"}
                    onClick={() => on.toggleBlame(active)}
                  >
                    <ScanText size={13} />
                  </Button>
                </IconTip>
              )}
              {fileTools && !active.fromAll && !editing && !resolving && (
                <>
                  <Button
                    variant={active.viewMode === "raw" ? "default" : "outline"}
                    size="icon"
                    className="h-7 w-7"
                    title="View raw file (syntax highlighted)"
                    onClick={() => on.setViewMode(active, active.viewMode === "raw" ? "split" : "raw")}
                  >
                    <FileCode size={13} />
                  </Button>
                  <Button
                    variant={active.viewMode === "unified" ? "default" : "outline"}
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => on.setViewMode(active, "unified")}
                  >
                    <AlignJustify size={13} />
                  </Button>
                  <Button
                    variant={active.viewMode === "split" ? "default" : "outline"}
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => on.setViewMode(active, "split")}
                  >
                    <Split size={13} />
                  </Button>
                </>
              )}
              {fileTools && !editing && !resolving && (
                <Button
                  variant={active.findOpen ? "default" : "outline"}
                  size="icon"
                  className="h-7 w-7"
                  title="Search in file (Ctrl/Cmd+F)"
                  onClick={on.toggleFind}
                >
                  <Search size={13} />
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                onClick={toggleFullscreen}
              >
                {isFullscreen ? <Minimize size={13} /> : <Maximize size={13} />}
              </Button>
            </div>
          )}
        </div>
        {active?.findOpen && fileTools && !editing && !resolving && (
          <div className="mt-2">
            <FindBar
              query={active.findQuery}
              caseSensitive={active.findCaseSensitive}
              total={find.total}
              index={active.findMatchIndex}
              onQueryChange={find.setQuery}
              onCaseToggle={find.toggleCase}
              onPrev={find.prev}
              onNext={find.next}
              onClose={find.close}
            />
          </div>
        )}
        {subtitle && <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <Separator />
      <CardContent className="diff-content min-h-0 flex-1 p-0">
        <FileViewer
          entry={active}
          repoPath={repoPath}
          fullPath={fullPath}
          conflicted={conflicted}
          onEditChange={on.editChange}
          onMatchIndexClamp={find.setIndex}
          onOpenCommit={on.openCommit}
          onOpenFile={on.openFile}
          onResolveConflict={on.resolveConflict}
        />
      </CardContent>
    </Card>
  )
}
