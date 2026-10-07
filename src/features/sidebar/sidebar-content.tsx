import { type ReactNode, useMemo, useState } from "react"
import { ChevronsDownUp, Copy, FilePlus, FolderInput, FolderPlus, Minus, Plus, RefreshCw, RotateCcw, Search, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { CommitActions } from "@/features/history/commit-menu"
import { HistoryList } from "@/features/history/history-list"
import type { History } from "@/features/history/use-history"
import type { GitFile, RepoEntry } from "@/lib/git/types"
import { cn } from "@/lib/utils"
import { existingPaths, isUnder } from "./file-ops"
import { FileTree, type FileTreeProps, type TreeMode, type TreeSelection } from "./file-tree"
import {
  type Selection,
  clickRow,
  emptySelection,
  pruneSelection,
  selectAll,
  selectRange,
  toggleRow,
  visiblePaths,
} from "./selection"
import { type MenuSelection, TreeContextMenu, type TreeMenuActions } from "./tree-context-menu"
import { buildTree, filterTreeNodes, type TreeNode } from "./tree"
import type { FileManager } from "./use-file-manager"

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-2 px-2 py-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="size-4 shrink-0 rounded" />
          <Skeleton className="h-3.5 flex-1" />
        </div>
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="px-2 py-2 text-[11px] text-muted-foreground">{text}</p>
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="ml-0.5 rounded border border-border bg-muted px-1 py-0 text-[10px] tabular-nums text-muted-foreground">{n}</span>
  )
}

type TreeHandlers = Omit<FileTreeProps, "nodes" | "mode" | "expandAll" | "onOpenFile" | "onContextNode" | "files" | "selection">

function ToolbarButton({ title, disabled, onClick, children }: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}

// Files tab header: where new items land, plus New File / New Folder /
// Collapse All / Refresh.
function FilesToolbar({ files, busy, menu }: { files: FileManager; busy: boolean; menu: Omit<TreeMenuActions, "open"> }) {
  const where = files.target ? `${files.target}/` : "repository root"
  return (
    <div className="mb-1 flex items-center gap-0.5 border-b border-border pb-1 pl-2">
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={`New files go in ${where}`}>
        in <span className="font-mono text-foreground">{where}</span>
      </span>
      <ToolbarButton title="New File (Ctrl+Alt+N)" disabled={busy} onClick={() => files.startCreate("file")}>
        <FilePlus size={14} />
      </ToolbarButton>
      <ToolbarButton title="New Folder" disabled={busy} onClick={() => files.startCreate("dir")}>
        <FolderPlus size={14} />
      </ToolbarButton>
      <ToolbarButton title="Collapse All" onClick={menu.collapseAll}>
        <ChevronsDownUp size={14} />
      </ToolbarButton>
      <ToolbarButton title="Refresh" onClick={menu.refresh}>
        <RefreshCw size={14} />
      </ToolbarButton>
    </div>
  )
}

// Shown above a tree while rows are selected: the count, bulk actions, clear.
function SelectionBar({ mode, count, fileCount, busy, actions, onClear }: {
  mode: TreeMode
  count: number
  // Changes/Staged: changed files under the selection.
  fileCount: number
  busy: boolean
  actions: { move: () => void; delete: () => void; stage: () => void; discard: () => void; copy: () => void }
  onClear: () => void
}) {
  const staged = mode === "staged"
  return (
    <div className="mb-1 flex items-center gap-0.5 rounded-md border border-primary/30 bg-primary/10 py-0.5 pl-2 pr-0.5 dark:bg-primary/20" role="toolbar" aria-label="Selection actions">
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">{count} selected</span>
      {mode === "all" ? (
        <>
          <ToolbarButton title="Move to…" disabled={busy} onClick={actions.move}>
            <FolderInput size={14} />
          </ToolbarButton>
          <ToolbarButton title={`Delete ${count} item${count === 1 ? "" : "s"}`} disabled={busy} onClick={actions.delete}>
            <Trash2 size={14} />
          </ToolbarButton>
        </>
      ) : (
        <>
          <ToolbarButton title={`${staged ? "Unstage" : "Stage"} ${fileCount} file${fileCount === 1 ? "" : "s"}`} disabled={busy || fileCount === 0} onClick={actions.stage}>
            {staged ? <Minus size={14} /> : <Plus size={14} />}
          </ToolbarButton>
          <ToolbarButton title="Discard changes" disabled={busy || fileCount === 0} onClick={actions.discard}>
            <RotateCcw size={14} />
          </ToolbarButton>
        </>
      )}
      <ToolbarButton title="Copy paths" onClick={actions.copy}>
        <Copy size={14} />
      </ToolbarButton>
      <ToolbarButton title="Clear selection (Esc)" onClick={onClear}>
        <X size={14} />
      </ToolbarButton>
    </div>
  )
}

export type SidebarTab = TreeMode | "history"

// Sidebar body: file search plus the Changes / Staged / All Files / History
// tabs. `onNavigate` runs after a file or commit is opened (closes the mobile sheet).
export function SidebarContent({ tab, onTabChange, files, allFiles, loading, search, onSearchChange, tree, fileManager, menu, onOpenChange, onOpenTreeFile, history, activeCommit, commitActions, onOpenCommit, onNavigate }: {
  // Controlled so "Show history" can switch to the History tab.
  tab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  files: GitFile[]
  allFiles: RepoEntry[]
  loading: boolean
  // Shared between the desktop sidebar and the mobile sheet.
  search: string
  onSearchChange: (value: string) => void
  tree: TreeHandlers
  fileManager: FileManager
  // Context menu actions ("open" depends on the tree, so it's added here).
  menu: Omit<TreeMenuActions, "open">
  // Open a file from the Changes/Staged trees.
  onOpenChange: (file: string, staged: boolean) => void
  // Open a file from the All Files tree.
  onOpenTreeFile: (file: string) => void
  history: History
  // Sha of the active commit tab, highlighted in History.
  activeCommit: string | undefined
  commitActions: CommitActions
  onOpenCommit: (sha: string, file?: string) => void
  onNavigate: () => void
}) {
  const expandAll = search.trim().length > 0
  // The row last right-clicked; null = empty space.
  const [menuTarget, setMenuTarget] = useState<TreeNode | null>(null)
  // Multi-select of the visible tree (only one tree is visible at a time).
  const [selState, setSelState] = useState<{ mode: TreeMode; sel: Selection }>({ mode: "changes", sel: emptySelection })

  const changesFiles = useMemo(() => files.filter(f => !f.staged), [files])
  const stagedFiles = useMemo(() => files.filter(f => f.staged), [files])
  const trees = useMemo(() => ({
    changes: filterTreeNodes(buildTree(changesFiles), search),
    staged: filterTreeNodes(buildTree(stagedFiles), search),
    all: filterTreeNodes(buildTree(allFiles), search),
  }), [changesFiles, stagedFiles, allFiles, search])
  // Every path each tree knows (selections drop paths that are gone).
  const known = useMemo(() => ({
    changes: existingPaths(changesFiles),
    staged: existingPaths(stagedFiles),
    all: fileManager.existing,
  }), [changesFiles, stagedFiles, fileManager.existing])
  const treeFiles = { changes: changesFiles, staged: stagedFiles }

  const selectionOf = (mode: TreeMode): Selection =>
    selState.mode === mode && tab === mode ? pruneSelection(selState.sel, p => known[mode].has(p)) : emptySelection

  // Functional updates: Shift+arrow sets the anchor and the range in one tick.
  const updateSelection = (mode: TreeMode, f: (sel: Selection) => Selection) =>
    setSelState(prev => ({ mode, sel: f(prev.mode === mode ? prev.sel : emptySelection) }))

  const treeSelection = (mode: TreeMode): TreeSelection => {
    const order = () => visiblePaths(trees[mode], p => expandAll || tree.expanded.has(p))
    return {
      paths: selectionOf(mode).paths,
      click: path => updateSelection(mode, sel => clickRow(sel, path)),
      toggle: path => updateSelection(mode, sel => toggleRow(sel, path, order())),
      range: path => updateSelection(mode, sel => selectRange(sel, path, order())),
      selectAll: () => updateSelection(mode, sel => selectAll(sel, order())),
      clear: () => updateSelection(mode, sel => ({ paths: new Set(), anchor: sel.anchor })),
    }
  }

  // Changes/Staged act on the changed files under the selected rows.
  const filesUnder = (mode: TreeMode, paths: string[]) =>
    mode === "all" ? paths : treeFiles[mode].filter(f => paths.some(p => isUnder(f.path, p))).map(f => f.path)

  const changeTab = (value: SidebarTab) => {
    setSelState(prev => ({ ...prev, sel: emptySelection }))
    onTabChange(value)
  }

  const renderTree = (mode: TreeMode, total: number, emptyText: string, skeletonCount: number) => {
    if (mode === "all" ? total === 0 : loading && total === 0) return <SkeletonRows count={skeletonCount} />
    if (total === 0) return <Empty text={emptyText} />
    if (trees[mode].length === 0) return <Empty text="No matches" />
    const open = (file: string) => {
      if (mode === "all") onOpenTreeFile(file)
      else onOpenChange(file, mode === "staged")
      onNavigate()
    }
    return (
      <div className="pb-1">
        <FileTree
          {...tree}
          nodes={trees[mode]}
          mode={mode}
          expandAll={expandAll}
          onOpenFile={open}
          onContextNode={node => {
            setMenuTarget(node)
            // Right-clicking outside the selection drops it, like VS Code.
            if (!selectionOf(mode).paths.has(node.path)) updateSelection(mode, sel => ({ paths: new Set(), anchor: sel.anchor }))
          }}
          files={mode === "all" ? fileManager : undefined}
          selection={treeSelection(mode)}
        />
      </div>
    )
  }

  // The tree plus the empty space below it, which takes right-clicks (root
  // menu), clicks (select the root as the target folder) and drops (move to root).
  const withMenu = (mode: TreeMode, content: ReactNode) => {
    const fm = mode === "all" ? fileManager : null
    const open = (file: string) => {
      if (mode === "all") onOpenTreeFile(file)
      else onOpenChange(file, mode === "staged")
      onNavigate()
    }
    const sel = selectionOf(mode)
    const selected = [...sel.paths]
    const menuSelection: MenuSelection = {
      bulk: menuTarget && sel.paths.has(menuTarget.path) && sel.paths.size > 1 ? selected : null,
      bulkFiles: filesUnder(mode, selected),
      has: path => sel.paths.has(path),
      toggle: path => treeSelection(mode).toggle(path),
      clear: () => treeSelection(mode).clear(),
    }
    return (
      <TreeContextMenu
        mode={mode}
        target={menuTarget}
        expanded={!!menuTarget && (expandAll || tree.expanded.has(menuTarget.path))}
        busy={tree.busy}
        actions={{ ...menu, open }}
        selection={menuSelection}
      >
        <div
          className={cn("min-h-40 rounded-md pb-10", fm?.dropTarget === "" && "bg-accent/40 ring-1 ring-ring")}
          onContextMenuCapture={() => setMenuTarget(null)}
          onClick={e => {
            if (e.target !== e.currentTarget) return
            fm?.setSelectedDir("")
            if (sel.paths.size > 0) treeSelection(mode).clear()
          }}
          onDragOver={fm ? e => {
            if (!fm.canDropInto("")) return
            e.preventDefault()
            if (fm.dropTarget !== "") fm.setDropTarget("")
          } : undefined}
          onDrop={fm ? e => {
            e.preventDefault()
            fm.drop("")
          } : undefined}
        >
          {content}
        </div>
      </TreeContextMenu>
    )
  }

  const selectionBar = (mode: TreeMode) => {
    const selected = [...selectionOf(mode).paths]
    if (selected.length === 0) return null
    const changed = filesUnder(mode, selected)
    return (
      <SelectionBar
        mode={mode}
        count={selected.length}
        fileCount={changed.length}
        busy={tree.busy}
        onClear={() => treeSelection(mode).clear()}
        actions={{
          move: () => menu.move(selected),
          delete: () => menu.delete(selected),
          stage: () => menu.stage(changed, mode === "staged"),
          discard: () => menu.discard(changed, mode === "staged"),
          copy: () => menu.copyPath(selected, true),
        }}
      />
    )
  }

  return (
    <Tabs value={tab} onValueChange={v => changeTab(v as SidebarTab)} className="flex flex-col">
      <div className="px-2 pt-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder={tab === "history" ? "Search commits…" : "Search files…"}
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <TabsList className="mx-2 mt-2 grid grid-cols-4">
        <TabsTrigger value="changes" className="px-1 text-[11px]">Changes <CountBadge n={changesFiles.length} /></TabsTrigger>
        <TabsTrigger value="staged" className="px-1 text-[11px]">Staged <CountBadge n={stagedFiles.length} /></TabsTrigger>
        <TabsTrigger value="all" className="px-1 text-[11px]">Files <CountBadge n={allFiles.length} /></TabsTrigger>
        <TabsTrigger value="history" className="px-1 text-[11px]">History</TabsTrigger>
      </TabsList>
      <div className="mt-2 space-y-0">
        <TabsContent value="changes" className="mt-0 px-2">
          {selectionBar("changes")}
          {withMenu("changes", renderTree("changes", changesFiles.length, "No changes", 5))}
        </TabsContent>
        <TabsContent value="staged" className="mt-0 px-2">
          {selectionBar("staged")}
          {withMenu("staged", renderTree("staged", stagedFiles.length, "Nothing staged", 3))}
        </TabsContent>
        <TabsContent value="all" className="mt-0 px-2">
          <FilesToolbar files={fileManager} busy={tree.busy} menu={menu} />
          {selectionBar("all")}
          {withMenu("all", renderTree("all", allFiles.length, "", 6))}
        </TabsContent>
        <TabsContent value="history" className="mt-0 px-2">
          <HistoryList
            history={history}
            search={search}
            activeCommit={activeCommit}
            actions={commitActions}
            onOpenCommit={(sha, file) => {
              onOpenCommit(sha, file)
              onNavigate()
            }}
          />
        </TabsContent>
      </div>
    </Tabs>
  )
}
