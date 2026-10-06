import { useMemo } from "react"
import { Search } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { CommitActions } from "@/features/history/commit-menu"
import { HistoryList } from "@/features/history/history-list"
import type { History } from "@/features/history/use-history"
import type { GitFile, RepoEntry } from "@/lib/git/types"
import { FileTree, type FileTreeProps, type TreeMode } from "./file-tree"
import { buildTree, filterTreeNodes } from "./tree"

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

type TreeHandlers = Omit<FileTreeProps, "nodes" | "mode" | "expandAll" | "onOpenFile">

export type SidebarTab = TreeMode | "history"

// Sidebar body: file search plus the Changes / Staged / All Files / History
// tabs. `onNavigate` runs after a file or commit is opened (closes the mobile sheet).
export function SidebarContent({ tab, onTabChange, files, allFiles, loading, search, onSearchChange, tree, onOpenChange, onOpenTreeFile, history, activeCommit, commitActions, onOpenCommit, onNavigate }: {
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

  const changesFiles = useMemo(() => files.filter(f => !f.staged), [files])
  const stagedFiles = useMemo(() => files.filter(f => f.staged), [files])
  const trees = useMemo(() => ({
    changes: filterTreeNodes(buildTree(changesFiles), search),
    staged: filterTreeNodes(buildTree(stagedFiles), search),
    all: filterTreeNodes(buildTree(allFiles), search),
  }), [changesFiles, stagedFiles, allFiles, search])

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
        <FileTree {...tree} nodes={trees[mode]} mode={mode} expandAll={expandAll} onOpenFile={open} />
      </div>
    )
  }

  return (
    <Tabs value={tab} onValueChange={v => onTabChange(v as SidebarTab)} className="flex flex-col">
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
        <TabsContent value="changes" className="mt-0 px-2">{renderTree("changes", changesFiles.length, "No changes", 5)}</TabsContent>
        <TabsContent value="staged" className="mt-0 px-2">{renderTree("staged", stagedFiles.length, "Nothing staged", 3)}</TabsContent>
        <TabsContent value="all" className="mt-0 px-2">{renderTree("all", allFiles.length, "", 6)}</TabsContent>
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
