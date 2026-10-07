import type { KeyboardEvent, ReactNode } from "react"
import { ChevronDown, File, FilePlus, Folder, FolderPlus, Minus, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { statusBadgeColor, statusIcon, statusLabel } from "@/features/files/status-display"
import { cn } from "@/lib/utils"
import { parentDir, renameSelection } from "./file-ops"
import { InlineNameInput } from "./inline-name-input"
import { collectFilePaths, type TreeNode } from "./tree"
import type { FileManager } from "./use-file-manager"

// "all" = the All Files tree; "changes"/"staged" = one side of git status.
export type TreeMode = "all" | "changes" | "staged"

export interface FileTreeProps {
  nodes: TreeNode[]
  mode: TreeMode
  activeFile: string | undefined
  expanded: Set<string>
  // Show every dir expanded (while searching).
  expandAll: boolean
  busy: boolean
  onToggleDir: (path: string) => void
  onOpenFile: (path: string) => void
  onStage: (files: string[], staged: boolean) => void
  onDiscard: (files: string[], staged: boolean) => void
  onDelete: (paths: string[]) => void
  // Right-click on a row: remembers it as the context menu's target.
  onContextNode?: (node: TreeNode) => void
  // All Files only: create / rename / move.
  files?: FileManager
  // Multi-select (Ctrl/Cmd+click, Shift+click, Shift+arrows, Ctrl/Cmd+A).
  selection?: TreeSelection
}

export interface TreeSelection {
  paths: ReadonlySet<string>
  // A plain click (resets the selection, moves the anchor).
  click: (path: string) => void
  toggle: (path: string) => void
  range: (path: string) => void
  selectAll: () => void
  clear: () => void
}

function RowButton({ title, className, disabled, onClick, children }: {
  title: string
  className?: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-5 w-5 shrink-0", className)}
      disabled={disabled}
      onClick={e => {
        e.stopPropagation()
        onClick()
      }}
      title={title}
    >
      {children}
    </Button>
  )
}

// Row actions appear on hover/focus; touch screens can't hover, so they're
// always shown there.
const reveal = "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100 text-muted-foreground"
const hoverReveal = cn(reveal, "hover:text-destructive")
const hoverRevealNeutral = cn(reveal, "hover:text-foreground")

// Keyboard navigation between rows: Enter/Space activates, Up/Down moves
// focus (Shift extends the selection), Right/Left expands/collapses
// directories, Ctrl/Cmd+A selects all, Escape clears the selection. `extra`
// handles a key first and returns true when it did.
function handleRowKeyDown(
  e: KeyboardEvent<HTMLDivElement>,
  activate: () => void,
  dir: { expanded: boolean; toggle: () => void } | null,
  selection: TreeSelection | undefined,
  extra?: (e: KeyboardEvent<HTMLDivElement>) => boolean
) {
  if (extra?.(e)) {
    e.preventDefault()
    return
  }
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault()
    activate()
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault()
    const container = e.currentTarget.closest("[data-sidebar-body]")
    const rows = container ? Array.from(container.querySelectorAll<HTMLElement>("[data-file-row]")) : []
    const i = rows.indexOf(e.currentTarget)
    const next = rows[i + (e.key === "ArrowDown" ? 1 : -1)]
    if (!next) return
    if (selection && e.shiftKey) {
      // The range starts at the row focus leaves the first time.
      if (selection.paths.size === 0 && e.currentTarget.dataset.path) selection.click(e.currentTarget.dataset.path)
      if (next.dataset.path) selection.range(next.dataset.path)
    }
    next.focus()
  } else if (selection && e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
    e.preventDefault()
    selection.selectAll()
  } else if (selection && e.key === "Escape" && selection.paths.size > 0) {
    e.preventDefault()
    e.stopPropagation()
    selection.clear()
  } else if (dir && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    if ((e.key === "ArrowRight") !== dir.expanded) {
      e.preventDefault()
      dir.toggle()
    }
  }
}

function hasDir(nodes: TreeNode[], path: string): boolean {
  return nodes.some(n => n.type === "dir" && (n.path === path || (path.startsWith(n.path + "/") && hasDir(n.children, path))))
}

export function FileTree(props: FileTreeProps) {
  const pending = props.files?.pending
  // The pending row goes inside its folder; when search filters that folder
  // out it goes at the top, labelled with the folder.
  const orphan = !!pending && pending.dir !== "" && !hasDir(props.nodes, pending.dir)
  return (
    <>
      {orphan && <PendingRow {...props} depth={0} prefix={pending.dir} />}
      <TreeLevel {...props} depth={0} parent="" />
    </>
  )
}

function PendingRow({ files, depth, prefix }: FileTreeProps & { depth: number; prefix?: string }) {
  if (!files?.pending) return null
  const { kind, dir } = files.pending
  return (
    <InlineNameInput
      // A new pending row (other folder or kind) starts fresh.
      key={`${kind}:${dir}`}
      depth={depth}
      prefix={prefix}
      icon={kind === "file" ? <File size={14} /> : <Folder size={14} />}
      validate={files.validateCreate}
      onSubmit={files.submitCreate}
      onCancel={files.cancelCreate}
    />
  )
}

function TreeLevel(props: FileTreeProps & { depth: number; parent: string }) {
  const { nodes, mode, activeFile, expanded, expandAll, busy, depth, files, selection } = props
  const staged = mode === "staged"
  const manage = mode === "all" && files ? files : null

  return (
    <>
      {manage?.pending?.dir === props.parent && <PendingRow {...props} />}
      {nodes.map(node => {
        const isDir = node.type === "dir"
        const isExpanded = isDir && (expandAll || expanded.has(node.path))
        const isActive = !isDir && activeFile === node.path
        const isSelected = !!selection?.paths.has(node.path)
        // What a row action acts on: the whole selection when this row is in it.
        const targets = () => (isSelected && selection && selection.paths.size > 1 ? [...selection.paths] : [node.path])
        const isSelectedDir = !!manage && isDir && manage.selectedDir === node.path
        const isDropTarget = !!manage && isDir && manage.dropTarget === node.path
        const folder = isDir ? node.path : parentDir(node.path)
        const activate = () => {
          if (isDir) props.onToggleDir(node.path)
          else props.onOpenFile(node.path)
          manage?.setSelectedDir(isDir ? node.path : null)
        }
        const dirKeys = isDir ? { expanded: isExpanded, toggle: () => props.onToggleDir(node.path) } : null
        const manageKeys = manage
          ? (e: KeyboardEvent<HTMLDivElement>) => {
              if (e.ctrlKey || e.metaKey || e.altKey) return false
              if (e.key === "F2") manage.startRename(node.path)
              else if (e.key === "Delete") props.onDelete(targets())
              else if (e.key.toLowerCase() === "a") manage.startCreate(e.shiftKey ? "dir" : "file", folder)
              else return false
              return true
            }
          : undefined

        let icon = statusIcon(node.status)
        if (isDir) icon = <Folder size={14} />
        else if (mode === "all") icon = node.status === "untracked" ? <Plus size={14} /> : <File size={14} />

        // All Files only badges untracked files; the git trees badge every
        // file except untracked ones (the icon already says so).
        const showBadge = !isDir && (mode === "all" ? node.status === "untracked" : node.status !== "untracked")

        const children = isExpanded && <TreeLevel {...props} nodes={node.children} depth={depth + 1} parent={node.path} />

        if (manage?.renaming === node.path) {
          return (
            <div key={node.path}>
              <InlineNameInput
                depth={depth}
                icon={icon}
                initial={node.name}
                selection={renameSelection(node.name, isDir)}
                validate={manage.validateRename}
                onSubmit={manage.submitRename}
                onCancel={manage.cancelRename}
              />
              {children}
            </div>
          )
        }

        return (
          <div key={node.path}>
            <div
              data-file-row
              data-path={node.path}
              tabIndex={0}
              role="button"
              data-selected={isSelected || undefined}
              draggable={!!manage}
              onClick={e => {
                if (selection && (e.ctrlKey || e.metaKey)) selection.toggle(node.path)
                else if (selection && e.shiftKey) selection.range(node.path)
                else {
                  selection?.click(node.path)
                  activate()
                }
              }}
              onKeyDown={e => handleRowKeyDown(e, activate, dirKeys, selection, manageKeys)}
              onContextMenu={() => props.onContextNode?.(node)}
              onDragStart={manage ? e => {
                e.dataTransfer.effectAllowed = "move"
                const paths = targets()
                e.dataTransfer.setData("text/plain", paths.join("\n"))
                manage.setDragging(paths)
              } : undefined}
              onDragEnd={manage?.endDrag}
              // Dropping on a file moves into that file's folder.
              onDragOver={manage ? e => {
                if (!manage.canDropInto(folder)) return
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = "move"
                if (manage.dropTarget !== folder) manage.setDropTarget(folder)
              } : undefined}
              onDrop={manage ? e => {
                if (!manage.canDropInto(folder)) return
                e.preventDefault()
                e.stopPropagation()
                manage.drop(folder)
              } : undefined}
              style={{ paddingLeft: 8 + depth * 12 }}
              className={cn(
                "group flex select-none items-center gap-1 rounded-md py-1.5 pr-1 text-xs outline-none transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : isSelected
                    ? "bg-primary/10 text-foreground ring-1 ring-inset ring-primary/30 hover:bg-primary/15 dark:bg-primary/20 dark:hover:bg-primary/25"
                    : isSelectedDir
                    ? "bg-accent/60 text-foreground hover:bg-accent hover:text-accent-foreground"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground",
                isActive && isSelected && "ring-2 ring-inset ring-primary-foreground/50",
                isDropTarget && "bg-accent ring-1 ring-ring"
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                    {isDir ? (
                      <ChevronDown
                        size={14}
                        className={cn("shrink-0 text-muted-foreground transition-transform", !isExpanded && "-rotate-90")}
                      />
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <span className={cn("shrink-0", isActive ? "text-primary-foreground" : "text-muted-foreground")}>{icon}</span>
                    <span className={cn("flex-1 truncate", isDir && "font-medium")}>{node.name}</span>
                    {showBadge && (
                      <span
                        className={cn(
                          "shrink-0 rounded border px-1.5 py-0 text-[10px]",
                          isActive ? "bg-primary-foreground/20 text-primary-foreground border-primary-foreground/30" : statusBadgeColor(node.status)
                        )}
                      >
                        {statusLabel(node.status)}
                      </span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="text-xs">{node.path}</p>
                </TooltipContent>
              </Tooltip>
              {manage && isDir && (
                <>
                  <RowButton title="New file in this folder (A)" className={hoverRevealNeutral} disabled={busy} onClick={() => manage.startCreate("file", node.path)}>
                    <FilePlus size={12} />
                  </RowButton>
                  <RowButton title="New folder in this folder (Shift+A)" className={hoverRevealNeutral} disabled={busy} onClick={() => manage.startCreate("dir", node.path)}>
                    <FolderPlus size={12} />
                  </RowButton>
                </>
              )}
              {manage && !isDir && (
                <RowButton title="Rename (F2)" className={hoverRevealNeutral} disabled={busy} onClick={() => manage.startRename(node.path)}>
                  <Pencil size={12} />
                </RowButton>
              )}
              {mode === "all" && (
                <RowButton title={isDir ? "Delete folder (Del)" : "Delete file (Del)"} className={hoverReveal} disabled={busy} onClick={() => props.onDelete(targets())}>
                  <Trash2 size={12} />
                </RowButton>
              )}
              {mode !== "all" && isDir && (
                <RowButton
                  title={staged ? "Unstage all files in this directory" : "Stage all files in this directory"}
                  className="opacity-100"
                  disabled={busy}
                  onClick={() => props.onStage(collectFilePaths(node), staged)}
                >
                  {staged ? <Minus size={12} /> : <Plus size={12} />}
                </RowButton>
              )}
              {mode !== "all" && (
                <RowButton
                  title={isDir
                    ? staged ? "Discard staged changes in this directory" : "Discard changes in this directory"
                    : staged ? "Discard staged changes" : "Discard changes"}
                  className={hoverReveal}
                  disabled={busy}
                  onClick={() => props.onDiscard(collectFilePaths(node), staged)}
                >
                  <RotateCcw size={12} />
                </RowButton>
              )}
            </div>
            {children}
          </div>
        )
      })}
    </>
  )
}
