import type { ReactNode } from "react"
import {
  CheckSquare,
  ChevronsDownUp,
  FolderInput,
  Copy,
  ExternalLink,
  FilePlus,
  FolderPlus,
  FolderSearch,
  History,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { type NewItemKind, parentDir } from "./file-ops"
import type { TreeMode } from "./file-tree"
import { collectFilePaths, type TreeNode } from "./tree"

export interface TreeMenuActions {
  open: (path: string) => void
  newItem: (kind: NewItemKind, dir: string) => void
  rename: (path: string) => void
  delete: (paths: string[]) => void
  // Opens the Move dialog.
  move: (paths: string[]) => void
  copyPath: (paths: string[], absolute: boolean) => void
  showHistory: (path: string) => void
  // Show the file in the Files tab.
  reveal: (path: string) => void
  stage: (files: string[], staged: boolean) => void
  discard: (files: string[], staged: boolean) => void
  toggleDir: (path: string) => void
  collapseAll: () => void
  refresh: () => void
}

// The tree's multi-select, as the menu needs it.
export interface MenuSelection {
  // The selection when the right-clicked row is part of a multi-selection.
  bulk: string[] | null
  // Bulk Stage/Unstage/Discard in Changes/Staged: the changed files under the
  // selected paths.
  bulkFiles: string[]
  has: (path: string) => boolean
  toggle: (path: string) => void
  clear: () => void
}

// One right-click menu for a whole tree. `target` is the row that was
// right-clicked (set by the row's own contextmenu handler, which runs before
// the menu opens), or null for the empty space around the rows.
export function TreeContextMenu({ mode, target, expanded, busy, actions, selection, children }: {
  mode: TreeMode
  target: TreeNode | null
  expanded: boolean
  busy: boolean
  actions: TreeMenuActions
  selection: MenuSelection
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {/* Don't hand focus back to the tree: a new inline input wants it. */}
      <ContextMenuContent className="w-56" onCloseAutoFocus={e => e.preventDefault()}>
        {selection.bulk && target
          ? <BulkItems mode={mode} paths={selection.bulk} files={selection.bulkFiles} busy={busy} actions={actions} selection={selection} />
          : <MenuItems mode={mode} target={target} expanded={expanded} busy={busy} actions={actions} selection={selection} />}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function Item({ icon, label, shortcut, destructive, disabled, onSelect }: {
  icon: ReactNode
  label: string
  shortcut?: string
  destructive?: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <ContextMenuItem className="text-xs" variant={destructive ? "destructive" : "default"} disabled={disabled} onSelect={onSelect}>
      {icon}
      {label}
      {shortcut && <ContextMenuShortcut>{shortcut}</ContextMenuShortcut>}
    </ContextMenuItem>
  )
}

// Actions on a multi-selection.
function BulkItems({ mode, paths, files, busy, actions: a, selection }: {
  mode: TreeMode
  paths: string[]
  files: string[]
  busy: boolean
  actions: TreeMenuActions
  selection: MenuSelection
}) {
  const staged = mode === "staged"
  return (
    <>
      <ContextMenuLabel className="text-xs text-muted-foreground">{paths.length} selected</ContextMenuLabel>
      <ContextMenuSeparator />
      {mode === "all" ? (
        <>
          <Item icon={<FolderInput />} label="Move to…" disabled={busy} onSelect={() => a.move(paths)} />
          <Item icon={<Trash2 />} label={`Delete ${paths.length} Items`} shortcut="Del" destructive disabled={busy} onSelect={() => a.delete(paths)} />
        </>
      ) : (
        <>
          <Item icon={staged ? <Minus /> : <Plus />} label={`${staged ? "Unstage" : "Stage"} ${files.length} File${files.length === 1 ? "" : "s"}`} disabled={busy || files.length === 0} onSelect={() => a.stage(files, staged)} />
          <Item icon={<RotateCcw />} label="Discard Changes" destructive disabled={busy || files.length === 0} onSelect={() => a.discard(files, staged)} />
        </>
      )}
      <ContextMenuSeparator />
      <Item icon={<Copy />} label="Copy Paths" onSelect={() => a.copyPath(paths, true)} />
      <Item icon={<Copy />} label="Copy Relative Paths" onSelect={() => a.copyPath(paths, false)} />
      <ContextMenuSeparator />
      <Item icon={<X />} label="Clear Selection" shortcut="Esc" onSelect={selection.clear} />
    </>
  )
}

function MenuItems({ mode, target, expanded, busy, actions: a, selection }: {
  mode: TreeMode
  target: TreeNode | null
  expanded: boolean
  busy: boolean
  actions: TreeMenuActions
  selection: MenuSelection
}) {
  const all = mode === "all"
  const staged = mode === "staged"
  const copyItems = (path: string) => (
    <>
      <Item icon={<Copy />} label="Copy Path" onSelect={() => a.copyPath([path], true)} />
      <Item icon={<Copy />} label="Copy Relative Path" onSelect={() => a.copyPath([path], false)} />
    </>
  )
  // Builds a selection without a keyboard (long-press on touch screens).
  const selectItem = (path: string) => (
    <Item
      icon={<CheckSquare />}
      label={selection.has(path) ? "Remove from Selection" : "Add to Selection"}
      shortcut="Ctrl+Click"
      onSelect={() => selection.toggle(path)}
    />
  )

  if (!target) {
    return (
      <>
        {all && (
          <>
            <Item icon={<FilePlus />} label="New File…" disabled={busy} onSelect={() => a.newItem("file", "")} />
            <Item icon={<FolderPlus />} label="New Folder…" disabled={busy} onSelect={() => a.newItem("dir", "")} />
            <ContextMenuSeparator />
          </>
        )}
        <Item icon={<ChevronsDownUp />} label="Collapse All" onSelect={a.collapseAll} />
        <Item icon={<RefreshCw />} label="Refresh" onSelect={a.refresh} />
      </>
    )
  }

  const { path } = target
  if (target.type === "dir") {
    const files = collectFilePaths(target)
    return (
      <>
        {all ? (
          <>
            <Item icon={<FilePlus />} label="New File…" shortcut="A" disabled={busy} onSelect={() => a.newItem("file", path)} />
            <Item icon={<FolderPlus />} label="New Folder…" shortcut="⇧A" disabled={busy} onSelect={() => a.newItem("dir", path)} />
            <ContextMenuSeparator />
            <Item icon={<Pencil />} label="Rename…" shortcut="F2" disabled={busy} onSelect={() => a.rename(path)} />
            <Item icon={<FolderInput />} label="Move to…" disabled={busy} onSelect={() => a.move([path])} />
            <Item icon={<Trash2 />} label="Delete Folder" shortcut="Del" destructive disabled={busy} onSelect={() => a.delete([path])} />
          </>
        ) : (
          <>
            <Item icon={staged ? <Minus /> : <Plus />} label={staged ? "Unstage Folder" : "Stage Folder"} disabled={busy} onSelect={() => a.stage(files, staged)} />
            <Item icon={<RotateCcw />} label="Discard Changes" destructive disabled={busy} onSelect={() => a.discard(files, staged)} />
          </>
        )}
        <ContextMenuSeparator />
        {copyItems(path)}
        {selectItem(path)}
        <ContextMenuSeparator />
        <Item icon={<ChevronsDownUp />} label={expanded ? "Collapse" : "Expand"} onSelect={() => a.toggleDir(path)} />
      </>
    )
  }

  return (
    <>
      <Item icon={<ExternalLink />} label="Open" onSelect={() => a.open(path)} />
      {all ? (
        <>
          <Item icon={<FilePlus />} label="New File Here…" disabled={busy} onSelect={() => a.newItem("file", parentDir(path))} />
          <Item icon={<FolderPlus />} label="New Folder Here…" disabled={busy} onSelect={() => a.newItem("dir", parentDir(path))} />
          <ContextMenuSeparator />
          <Item icon={<Pencil />} label="Rename…" shortcut="F2" disabled={busy} onSelect={() => a.rename(path)} />
          <Item icon={<FolderInput />} label="Move to…" disabled={busy} onSelect={() => a.move([path])} />
          <Item icon={<Trash2 />} label="Delete File" shortcut="Del" destructive disabled={busy} onSelect={() => a.delete([path])} />
        </>
      ) : (
        <>
          <Item icon={<FolderSearch />} label="Reveal in Files" onSelect={() => a.reveal(path)} />
          <ContextMenuSeparator />
          <Item icon={staged ? <Minus /> : <Plus />} label={staged ? "Unstage" : "Stage"} disabled={busy} onSelect={() => a.stage([path], staged)} />
          <Item icon={<RotateCcw />} label="Discard Changes" destructive disabled={busy} onSelect={() => a.discard([path], staged)} />
        </>
      )}
      <ContextMenuSeparator />
      {copyItems(path)}
      <Item icon={<History />} label="Show History" onSelect={() => a.showHistory(path)} />
      {selectItem(path)}
    </>
  )
}
