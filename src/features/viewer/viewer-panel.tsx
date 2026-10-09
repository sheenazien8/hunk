import type { ReactNode } from "react"
import {
  AlignJustify,
  Check,
  Cherry,
  Ellipsis,
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
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { BufferEntry, ViewMode } from "@/features/buffer/buffer"
import { basename, isMarkdownFile } from "@/features/files/file-types"
import { FindBar } from "@/features/find/find-bar"
import type { Find } from "@/features/find/use-find"
import { type CommitActions, commitActionsFor } from "@/features/history/commit-menu"
import type { ConflictChoice } from "@/lib/git/parse-conflict"
import type { ActionName } from "@/lib/git/types"
import { cn } from "@/lib/utils"
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

// One segment of the Split / Unified / Raw control.
function ViewToggle({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <IconTip tip={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        {children}
      </button>
    </IconTip>
  )
}

// An overflow-menu item that is on or off (trailing check when on).
function MenuToggle({ on, onSelect, children }: { on: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <DropdownMenuItem onSelect={onSelect} aria-checked={on} role="menuitemcheckbox">
      {children}
      {on && <Check className="ml-auto text-primary" />}
    </DropdownMenuItem>
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

  // Files: "dir/" muted + name on one line (the tab already shows the name).
  const dir = active && !commit && active.file.includes("/") ? active.file.slice(0, active.file.lastIndexOf("/") + 1) : ""
  const title = commit ? `Commit ${commit.slice(0, 7)}` : active ? basename(active.file) : "Select a file"
  const subtitle = commit ? active?.commitData?.commit.subject ?? "" : ""
  const isBlame = active?.viewMode === "blame"

  return (
    <Card ref={cardRef} className="diff-card flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader className="shrink-0 p-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="min-w-0 truncate text-sm" title={active && !commit ? active.file : undefined}>
            {dir && <span className="font-normal text-muted-foreground">{dir}</span>}
            {title}
          </CardTitle>
          {active && (
            <div className="flex shrink-0 items-center gap-1">
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
                      aria-label={active.staged ? "Discard staged changes" : "Discard changes"}
                      disabled={!!busyAction}
                      onClick={() => on.discard(active)}
                    >
                      <RotateCcw size={13} />
                    </Button>
                  </IconTip>
                  <IconTip tip={active.staged ? "Unstage this file" : "Stage this file"}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2"
                      aria-label={active.staged ? "Unstage this file" : "Stage this file"}
                      disabled={!!busyAction}
                      onClick={() => on.toggleStaged(active)}
                    >
                      {busyAction === "add" || busyAction === "unstage"
                        ? <RefreshCw size={13} className="animate-spin" />
                        : active.staged ? <Minus size={13} /> : <Plus size={13} />}
                      <span className="hidden sm:inline">{active.staged ? "Unstage" : "Stage"}</span>
                    </Button>
                  </IconTip>
                  <div role="group" aria-label="Diff view" className="flex items-center rounded-md border border-border p-0.5">
                    <ViewToggle label="Split" active={active.viewMode === "split"} onClick={() => on.setViewMode(active, "split")}>
                      <Split size={13} />
                    </ViewToggle>
                    <ViewToggle label="Unified" active={active.viewMode === "unified"} onClick={() => on.setViewMode(active, "unified")}>
                      <AlignJustify size={13} />
                    </ViewToggle>
                    <ViewToggle label="Raw file" active={active.viewMode === "raw"} onClick={() => on.setViewMode(active, "raw")}>
                      <FileCode size={13} />
                    </ViewToggle>
                  </div>
                </>
              )}
              {editing && (
                <IconTip tip="Cancel editing">
                  <Button variant="outline" size="icon" className="h-7 w-7" aria-label="Cancel editing" onClick={on.toggleEdit}>
                    <X size={13} />
                  </Button>
                </IconTip>
              )}
              {fileTools && !editing && !resolving && (
                <IconTip tip="Search in file (Ctrl/Cmd+F)">
                  <Button
                    variant={active.findOpen ? "default" : "ghost"}
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Search in file"
                    aria-pressed={!!active.findOpen}
                    onClick={on.toggleFind}
                  >
                    <Search size={13} />
                  </Button>
                </IconTip>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="More actions">
                    <Ellipsis size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {fileTools && canEdit && !editing && (
                    <DropdownMenuItem onSelect={on.toggleEdit}>
                      <FilePen /> Edit file
                    </DropdownMenuItem>
                  )}
                  {fileTools && isMarkdownFile(active.file) && !editing && !resolving && !isBlame && (
                    <MenuToggle on={!!active.mdRender} onSelect={() => on.toggleMarkdown(active)}>
                      <Eye /> Render Markdown
                    </MenuToggle>
                  )}
                  {fileTools && !editing && !resolving && (
                    <MenuToggle on={isBlame} onSelect={() => on.toggleBlame(active)}>
                      <ScanText /> Blame
                    </MenuToggle>
                  )}
                  {fileTools && !editing && (
                    <DropdownMenuItem onSelect={() => on.showHistory(active.file)}>
                      <History /> File history
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={toggleFullscreen}>
                    {isFullscreen ? <Minimize /> : <Maximize />} {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                  </DropdownMenuItem>
                  {fileTools && active.fromAll && !editing && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => on.delete(active.file)}>
                        <Trash2 /> Delete file
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
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
