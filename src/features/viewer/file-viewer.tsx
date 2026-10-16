import { useLayoutEffect, useRef } from "react"
import { GitCommit, RefreshCw } from "lucide-react"
import type { BufferEntry } from "@/features/buffer/buffer"
import { isBinaryFile, isImageFile, isMarkdownFile } from "@/features/files/file-types"
import { CommitDetail } from "@/features/history/commit-detail"
import type { ConflictChoice } from "@/lib/git/parse-conflict"
import { BlameView } from "./blame-view"
import { CodeView } from "./code-view"
import { ConflictView } from "./conflict-view"
import { DiffView } from "./diff-view"
import { EditView } from "./edit-view"
import { BinaryPlaceholder, ImageView } from "./image-view"
import { MarkdownView } from "./markdown-view"

function Spinner() {
  return (
    <div className="flex items-center justify-center h-32">
      <RefreshCw size={20} className="animate-spin text-muted-foreground" />
    </div>
  )
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
      <GitCommit size={24} />
      <p className="text-sm mt-2">{text}</p>
    </div>
  )
}

function ErrorText({ text }: { text: string }) {
  return <div className="p-4 text-sm text-destructive whitespace-pre-wrap break-words">{text}</div>
}

// Picks the right view for the active tab: commit, editor, conflict
// resolution, blame, rendered Markdown, raw code, or diff.
export function FileViewer({ entry, repoPath, fullPath, conflicted, onEditChange, onMatchIndexClamp, onOpenCommit, onOpenFile, onResolveConflict }: {
  entry: BufferEntry | null
  repoPath: string
  fullPath: string
  // The file is unmerged: show the conflict view.
  conflicted: boolean
  onEditChange: (content: string) => void
  onMatchIndexClamp: (index: number) => void
  onOpenCommit: (sha: string) => void
  onOpenFile: (file: string) => void
  onResolveConflict: (index: number, choice: ConflictChoice) => void
}) {
  const find = entry?.findOpen
    ? { findQuery: entry.findQuery, findCaseSensitive: entry.findCaseSensitive, findMatchIndex: entry.findMatchIndex }
    : { findCaseSensitive: entry?.findCaseSensitive }

  // Per-tab scroll offset. One shared container serves every diff/raw tab, so
  // the position is saved on scroll and restored when the tab is activated
  // again. Kept in a ref: a scroll-per-frame React state update would
  // re-render the whole buffer.
  const scrollRef = useRef<HTMLDivElement>(null)
  const offsetsRef = useRef<Map<string, { top: number; left: number }>>(new Map())
  // gotoLine objects already acted on, so a jump suppresses restore once but
  // the tab still restores its position on later switches.
  const jumpedRef = useRef<Map<string, unknown>>(new Map())
  const entryId = entry?.id
  const gotoLine = entry?.gotoLine

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !entryId || !!entry?.findOpen) return
    if (gotoLine && jumpedRef.current.get(entryId) !== gotoLine) {
      jumpedRef.current.set(entryId, gotoLine)
      offsetsRef.current.delete(entryId)
      return
    }
    const saved = offsetsRef.current.get(entryId)
    el.scrollTop = saved?.top ?? 0
    el.scrollLeft = saved?.left ?? 0
    // Also re-run when content arrives (view-mode switch, activation refetch):
    // the body may have collapsed to a spinner and clamped scrollTop to 0.
  }, [entryId, gotoLine, entry?.findOpen, entry?.editMode, entry?.diff, entry?.raw, entry?.diffLoading, entry?.blame, entry?.md])

  if (entry?.editMode) {
    return (
      <EditView
        content={entry.editContent}
        file={entry.file}
        onChange={onEditChange}
        onMatchIndexClamp={onMatchIndexClamp}
        {...find}
      />
    )
  }

  let body
  if (!entry) {
    body = <Placeholder text="Select a file to view diff" />
  } else if (entry.commit) {
    body = entry.commitError ? (
      <ErrorText text={entry.commitError} />
    ) : entry.commitData ? (
      <CommitDetail
        // Remount when another file is focused so it expands + scrolls to it.
        key={`${entry.id}:${entry.commitFile ?? ""}`}
        repo={repoPath}
        data={entry.commitData}
        focusFile={entry.commitFile}
        onOpenCommit={onOpenCommit}
        onOpenFile={onOpenFile}
      />
    ) : (
      <Spinner />
    )
  } else if (entry.plugin) {
    // Plugin tabs render in their own frame outside this component.
    body = null
  } else if (isImageFile(entry.file)) {
    body = <ImageView key={entry.id} repoPath={repoPath} file={entry.file} />
  } else if (isBinaryFile(entry.file)) {
    body = <BinaryPlaceholder file={entry.file} />
  } else if (entry.diffLoading && !entry.diff && !entry.raw && !entry.blame && !entry.md) {
    body = <Spinner />
  } else if (conflicted) {
    body = (
      <ConflictView
        content={entry.dirty ? entry.editContent : entry.raw}
        error={entry.rawError}
        dirty={entry.dirty}
        onResolve={onResolveConflict}
      />
    )
  } else if (entry.viewMode === "blame") {
    body = entry.blameError ? (
      <ErrorText text={entry.blameError} />
    ) : entry.blame ? (
      <BlameView blame={entry.blame} file={entry.file} fullPath={fullPath} onOpenCommit={onOpenCommit} {...find} />
    ) : (
      <Spinner />
    )
  } else if (entry.mdRender && isMarkdownFile(entry.file)) {
    body = <MarkdownView content={entry.md} fullPath={fullPath} {...find} />
  } else if (entry.fromAll || entry.viewMode === "raw") {
    body = entry.rawError ? (
      <ErrorText text={entry.rawError} />
    ) : entry.raw ? (
      <CodeView content={entry.raw} file={entry.file} fullPath={fullPath} gotoLine={entry.gotoLine} {...find} />
    ) : (
      <Spinner />
    )
  } else if (entry.diff) {
    body = <DiffView raw={entry.diff} view={entry.viewMode === "split" ? "split" : "unified"} fullPath={fullPath} {...find} />
  } else {
    body = <Placeholder text="No changes for this file" />
  }

  return (
    <div
      ref={scrollRef}
      className="diff-scroll h-full overflow-auto"
      onScroll={() => {
        const el = scrollRef.current
        // A collapsed body (spinner/placeholder, nothing scrollable) clamps
        // scrollTop to 0; ignore those so they can't overwrite the offset.
        if (el && entryId && el.scrollHeight > el.clientHeight) {
          offsetsRef.current.set(entryId, { top: el.scrollTop, left: el.scrollLeft })
        }
      }}
    >
      {body}
    </div>
  )
}
