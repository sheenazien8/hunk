"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AgentFrame, useAgentPanel } from "@/features/agent/agent-frame"
import { AgentPanel } from "@/features/agent/agent-panel"
import { useAgent } from "@/features/agent/use-agent"
import { DeleteBranchDialog } from "@/features/branches/branch-dialogs"
import { BranchPicker } from "@/features/branches/branch-picker"
import { localNameOf, useBranches } from "@/features/branches/use-branches"
import { type BufferEntry, type TabKey, commitTabKey, committedStagedTabs, makeTabId } from "@/features/buffer/buffer"
import { TabBar } from "@/features/buffer/tab-bar"
import { useBuffer } from "@/features/buffer/use-buffer"
import { useEditing } from "@/features/buffer/use-editing"
import { DeletePathDialog, type DeleteRequest, DiscardDialog, type DiscardRequest, useDialog } from "@/features/changes/dialogs"
import { isDiscardAction, useGitActions } from "@/features/changes/use-git-actions"
import { useGitStatus } from "@/features/changes/use-git-status"
import { copyText } from "@/features/clipboard/use-copy-range"
import { isBinaryFile } from "@/features/files/file-types"
import { focusFindInput } from "@/features/find/highlight-segments"
import { useFind } from "@/features/find/use-find"
import type { CommitActionKind, CommitActions } from "@/features/history/commit-menu"
import { useHistory } from "@/features/history/use-history"
import { QuickOpen } from "@/features/quick-open/quick-open"
import { useQuickOpen } from "@/features/quick-open/use-quick-open"
import { defaultRepo, selectionFromUrl, syncRepoToUrl } from "@/features/projects/projects"
import { countFilesUnder, isUnder, moveTargets, topLevelPaths } from "@/features/sidebar/file-ops"
import { MoveDialog } from "@/features/sidebar/move-dialog"
import { SidebarContent, type SidebarTab } from "@/features/sidebar/sidebar-content"
import { SidebarFrame } from "@/features/sidebar/sidebar-frame"
import { useFileManager } from "@/features/sidebar/use-file-manager"
import { useExpandedDirs, useSidebar } from "@/features/sidebar/use-sidebar"
import { StashMenu } from "@/features/stash/stash-menu"
import { useStash } from "@/features/stash/use-stash"
import { ForcePushDialog } from "@/features/sync/sync-dialogs"
import { SyncMenu } from "@/features/sync/sync-menu"
import { useTheme } from "@/features/theme/theme"
import { ViewerPanel, type ViewerHandlers } from "@/features/viewer/viewer-panel"
import { useWorktrees } from "@/features/worktrees/use-worktrees"
import { AddWorktreeDialog, type NewWorktree, RemoveWorktreeDialog } from "@/features/worktrees/worktree-dialogs"
import { samePath } from "@/features/worktrees/worktrees"
import { mentionableFiles } from "@/lib/acp/mentions"
import { countConflicts, parseConflicts, resolveConflict } from "@/lib/git/parse-conflict"
import { type ActionName, type ActionPayload, type Commit, type GitFile, PUSH_REJECTED, type Worktree } from "@/lib/git/types"
import { AppHeader } from "./app-header"
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts"

// Actions that move HEAD (and usually change files with it).
const COMMIT_ACTIONS: ActionName[] = ["pull", "amend", "undoCommit", "revert", "cherryPick", "continueOperation", "abortOperation"]
// Actions that rewrite the working tree: open tabs show stale content after them.
const TREE_ACTIONS = new Set<ActionName>(["switchBranch", "createBranch", "stash", "stashPop", "stashApply", ...COMMIT_ACTIONS])
// Actions after which the branch list / stash list / history may differ.
const BRANCH_ACTIONS = new Set<ActionName>(["commit", "push", "fetch", "switchBranch", "createBranch", "deleteBranch", "addWorktree", "removeWorktree", ...COMMIT_ACTIONS])
const STASH_ACTIONS = new Set<ActionName>(["switchBranch", "stash", "stashPop", "stashApply", "stashDrop", "pull"])
const HISTORY_ACTIONS = new Set<ActionName>(["commit", "fetch", "switchBranch", "createBranch", ...COMMIT_ACTIONS])
// Actions that can fail half-way and leave the repo changed (stopped on
// conflicts): the UI must catch up even though they "failed".
const PARTIAL_ACTIONS = new Set<ActionName>(["pull", "revert", "cherryPick", "continueOperation", "abortOperation"])

// The tab key for a file a tab followed to a new path: the side git status
// now shows it on (a `git mv` stages the rename), else its raw content.
function movedTabKey(file: string, entry: BufferEntry, fresh: GitFile[] | null): TabKey {
  const raw = { file, staged: false, fromAll: true }
  if (entry.fromAll || !fresh) return raw
  const match = fresh.find(f => f.path === file && f.staged === entry.staged) ?? fresh.find(f => f.path === file)
  return match ? { file, staged: match.staged, fromAll: false, oldPath: match.oldPath } : raw
}

export function HunkApp() {
  const { isDark, toggleTheme } = useTheme()
  // Seed with the first project so the client always knows the active repo,
  // keeping the copy path:line action's full path honest from first load.
  // `projectDir` is the projects.json entry; `repoPath` is the worktree of it
  // every git call runs in (the project dir itself unless one is picked).
  const [projectDir, setProjectDir] = useState(defaultRepo)
  const [repoPath, setRepoPath] = useState(defaultRepo)
  const worktrees = useWorktrees(projectDir)
  const status = useGitStatus(repoPath)
  const buffer = useBuffer(repoPath, status.loading)
  const { active } = buffer
  const sidebar = useSidebar()
  const dirs = useExpandedDirs()
  const find = useFind(active, buffer.update)
  const [fileSearch, setFileSearch] = useState("")
  const deleteDialog = useDialog<DeleteRequest>()
  const confirm = useConfirm()
  const askConfirm = confirm.ask
  const moveDialog = useDialog<string[]>()
  const discardDialog = useDialog<DiscardRequest>()
  const [addWorktreeOpen, setAddWorktreeOpen] = useState(false)
  const removeWorktreeDialog = useDialog<Worktree>()
  const history = useHistory(repoPath)
  const branches = useBranches(repoPath)
  const stash = useStash(repoPath)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("changes")
  const deleteBranchDialog = useDialog<string>()
  const [forcePushOpen, setForcePushOpen] = useState(false)
  const repoState = status.state
  const currentBranch = status.branch || branches.current
  // HEAD is already on the upstream: amending or undoing it rewrites
  // published history.
  const headPushed = !!repoState.head && !!repoState.upstream && !repoState.gone && repoState.ahead === 0

  // The active tab is an unmerged file: the viewer shows conflict resolution.
  const conflicted = !!active && !active.commit && !active.fromAll && !active.staged
    && status.files.some(f => f.path === active.file && f.status === "conflicted")

  // --- Opening files --------------------------------------------------------

  // From the All Files tree: files with uncommitted changes open their diff so
  // the view matches the Changes/Staged sections; others open raw content.
  const openFromTree = useCallback((file: string) => {
    dirs.expandAncestors(file)
    const matched = status.files.find(f => f.path === file)
    buffer.open(matched
      ? { file, staged: matched.staged, fromAll: false, oldPath: matched.oldPath }
      : { file, staged: false, fromAll: true })
  }, [status.files, buffer, dirs])

  // From the Changes/Staged trees.
  const openChange = useCallback((file: string, staged: boolean) => {
    dirs.expandAncestors(file)
    const matched = status.files.find(f => f.path === file && f.staged === staged)
    buffer.open({ file, staged, fromAll: false, oldPath: matched?.oldPath })
  }, [status.files, buffer, dirs])

  // From Quick Open. With a line, open the file itself (not its diff) so the
  // line can be scrolled to, like an editor would.
  const openFromQuickOpen = useCallback((file: string, line?: number) => {
    if (line === undefined) {
      openFromTree(file)
      return
    }
    dirs.expandAncestors(file)
    const key = { file, staged: false, fromAll: true }
    const existing = buffer.entries.find(b => b.id === makeTabId(repoPath, key))
    buffer.open(key)
    buffer.update(makeTabId(repoPath, key), {
      gotoLine: { line },
      mdRender: false,
      ...(existing?.viewMode === "blame" ? { viewMode: "split" as const } : {}),
    })
  }, [openFromTree, dirs, buffer, repoPath])

  const openCommit = useCallback((sha: string, file?: string) => {
    buffer.open(commitTabKey(sha, file))
  }, [buffer])

  // Switches the sidebar to `tab` and makes sure it's on screen.
  const revealSidebar = useCallback((tab: SidebarTab) => {
    setSidebarTab(tab)
    if (window.matchMedia("(min-width: 768px)").matches) {
      if (!sidebar.open) sidebar.toggle()
    } else {
      sidebar.setMobileOpen(true)
    }
  }, [sidebar])
  const revealHistory = useCallback(() => revealSidebar("history"), [revealSidebar])

  // A file just created from the sidebar: open it straight in the editor.
  const openNewFile = useCallback((file: string) => {
    dirs.expandAncestors(file)
    const key = { file, staged: false, fromAll: true }
    buffer.open(key)
    if (!isBinaryFile(file)) {
      buffer.update(makeTabId(repoPath, key), { editMode: true, editContent: "", dirty: false, viewMode: "split", mdRender: false })
    }
    sidebar.setMobileOpen(false)
  }, [dirs, buffer, repoPath, sidebar])

  // Scopes the History tab to one file and brings it into view.
  const showHistory = useCallback((file: string) => {
    history.showFile(file)
    revealHistory()
  }, [history, revealHistory])

  // Lists another branch's commits (to cherry-pick from) in the History tab.
  const showBranchHistory = (branch: string) => {
    history.showFile(null)
    history.showRef(branch === currentBranch ? null : branch)
    revealHistory()
  }

  // --- Git actions ----------------------------------------------------------

  // Reconciles the open tabs with the repo after a successful action.
  const afterAction = useCallback(async (action: ActionName, payload?: ActionPayload) => {
    // Worktree add/remove don't touch this worktree's files; the caller
    // switches repos itself, which reloads status.
    if (BRANCH_ACTIONS.has(action)) void branches.load()
    if (STASH_ACTIONS.has(action)) void stash.load()
    if (HISTORY_ACTIONS.has(action)) history.reload()
    if (action === "addWorktree" || action === "removeWorktree") {
      await worktrees.load()
      return
    }
    const fresh = await status.loadStatus()
    // A commit / amend took the staged changes: their staged tabs would keep
    // showing the old diff, so close them (the unstaged side stays open).
    const committed = fresh && (action === "commit" || action === "amend") ? committedStagedTabs(buffer.entries, fresh) : []
    for (const e of committed) buffer.close(e.id)
    const activeClosed = !!active && committed.some(e => e.id === active.id)
    // Switching branches / stashing changed files under every open tab.
    if (TREE_ACTIONS.has(action) && active && !activeClosed && !active.commit && !active.dirty && !active.editMode) {
      void buffer.fetchEntry(active)
    }
    if (action === "switchBranch" || (action === "createBranch" && payload?.checkout)) void worktrees.load()
    const discard = isDiscardAction(action)
    const touchesActive = !!active && (payload?.files?.includes(active.file) ?? false)
    if (fresh && active && discard) {
      const gone = !fresh.some(f => f.path === active.file)
      if (action === "discardAll" || touchesActive || gone) buffer.close(active.id)
    }
    // Staging/unstaging the active file flips which side of it we're looking
    // at — keep the tab and update its staged flag in place.
    if (fresh && active && !discard && action !== "delete" && action !== "move" && (action === "addAll" || action === "unstageAll" || touchesActive)) {
      const staged = fresh.some(f => f.path === active.file && f.staged)
      const oldPath = fresh.find(f => f.path === active.file && f.staged === staged)?.oldPath
      buffer.update(active.id, { staged, oldPath })
      void buffer.fetchEntry({ ...active, staged, oldPath })
    }
    // (loadStatus above also reloaded All Files.)
    if (action === "create" && payload?.path) openNewFile(payload.path)
    // Open tabs follow moved files; the tree shows where they went.
    const moved: [string, string][] = action === "rename" && payload?.path && payload.to
      ? [[payload.path, payload.to]]
      : action === "move" && payload?.files ? moveTargets(payload.files, payload.to ?? "") : []
    for (const [from, to] of moved) {
      buffer.remap(from, to, (file, entry) => movedTabKey(file, entry, fresh))
      dirs.expandAncestors(to)
      if (dirs.expanded.has(from)) dirs.expandAncestors(`${to}/-`)
    }
  }, [status, active, buffer, openNewFile, worktrees, branches, stash, history, dirs])

  // A failed action may still have changed the repo (conflicts); a rejected
  // push offers to force it.
  const afterFailure = useCallback((action: ActionName, payload: ActionPayload | undefined, message: string) => {
    if (PARTIAL_ACTIONS.has(action)) {
      void branches.load()
      history.reload()
      void status.loadStatus().then(() => {
        if (active && !active.commit && !active.dirty && !active.editMode) void buffer.fetchEntry(active)
      })
    }
    if (action === "push" && !payload?.force && message.startsWith(PUSH_REJECTED)) setForcePushOpen(true)
  }, [branches, history, status, active, buffer])

  const { busyAction, actionResult, setActionResult, runAction } = useGitActions(repoPath, afterAction, afterFailure)

  // --- File manager (sidebar Files tab) ---------------------------------------

  const expandDir = useCallback((dir: string) => {
    if (dir) dirs.expandAncestors(`${dir}/-`)
  }, [dirs])
  const fileManager = useFileManager({
    entries: status.allFiles,
    activeFile: active && !active.commit ? active.file : undefined,
    runAction,
    expandDir,
  })

  const requestDelete = (paths: string[]) => {
    const top = topLevelPaths(paths)
    const dirs = new Set(status.allFiles.filter(e => e.type === "dir").map(e => e.path))
    const dirCount = top.filter(p => dirs.has(p)).length
    const fileCount = top.reduce((n, p) => n + (dirs.has(p) ? countFilesUnder(status.allFiles, p) : 1), 0)
    const changed = new Set(status.files.filter(f => top.some(p => isUnder(f.path, p))).map(f => f.path))
    deleteDialog.show({ paths: top, dirCount, fileCount, changedCount: changed.size })
  }

  const confirmDelete = async () => {
    const request = deleteDialog.value
    if (!request) return
    deleteDialog.setOpen(false)
    if (!(await runAction("delete", { files: request.paths }))) return
    for (const p of request.paths) {
      buffer.closeUnder(p)
      fileManager.forget(p)
    }
  }

  const moveFolders = useMemo(() => status.allFiles.filter(e => e.type === "dir").map(e => e.path), [status.allFiles])

  const confirmMove = async (paths: string[], dest: string) => {
    moveDialog.setOpen(false)
    await fileManager.moveInto(paths, dest)
  }

  // Shows a file in the Files tab, scrolled into view.
  const revealInFiles = (path: string) => {
    revealSidebar("all")
    dirs.expandAncestors(path)
    setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
      row?.scrollIntoView({ block: "nearest" })
      row?.focus()
    }, 50)
  }

  const newFile = () => {
    revealSidebar("all")
    fileManager.startCreate("file")
  }

  // --- Agent -----------------------------------------------------------------

  // The agent edited files: refresh the change lists and the open tab (unless
  // the user is editing it).
  const agentChangedFiles = useCallback(async () => {
    const fresh = await status.loadStatus()
    if (fresh && active && !active.dirty && !active.editMode) void buffer.fetchEntry(active)
  }, [status, active, buffer])

  const agentPanel = useAgentPanel()
  const repoFiles = useMemo(() => mentionableFiles(status.allFiles), [status.allFiles])
  const changedFiles = useMemo(() => [...new Set(status.files.map(f => f.path))], [status.files])
  const quickOpen = useQuickOpen()
  // Open file tabs, most recent first, the active one left out.
  const recentFiles = useMemo(
    () => [...new Set(buffer.entries.filter(b => !b.commit && b.id !== buffer.activeId).map(b => b.file).reverse())],
    [buffer.entries, buffer.activeId],
  )
  const agent = useAgent(repoPath, agentPanel.visible, agentChangedFiles)
  const editing = useEditing({ repoPath, buffer, files: status.files, loadStatus: status.loadStatus, setActionResult })

  const requestDiscard = (files: string[], staged: boolean) =>
    discardDialog.show({ action: staged ? "discardStaged" : "discard", files })

  const confirmDiscard = async () => {
    const request = discardDialog.value
    if (!request) return
    discardDialog.setOpen(false)
    await runAction(request.action, request.files ? { files: request.files } : undefined)
  }

  // --- Branches & stash ---------------------------------------------------

  // A remote branch with a local counterpart switches to the local one.
  const requestSwitchBranch = async (name: string) => {
    let target = name
    if (branches.branches.find(b => b.name === name)?.remote) {
      const local = localNameOf(name)
      if (branches.branches.some(b => !b.remote && b.name === local)) target = local
    }
    const dirty = buffer.entries.some(b => b.dirty)
    if (dirty && !(await confirm.ask({
      title: "Switch branch?",
      description: "Open tabs have unsaved changes. Switching branches will discard them.",
      confirmLabel: "Switch anyway",
      destructive: true,
    }))) return
    // git would carry tracked changes over (or refuse) — offer to stash them.
    if (status.files.some(f => f.status !== "untracked")) {
      if (await confirm.ask({
        title: `Uncommitted changes`,
        description: `${status.files.filter(f => f.status !== "untracked").length} tracked file(s) have uncommitted changes. Stash them and switch to ${target}?`,
        confirmLabel: "Stash & switch",
      })) await runAction("switchBranch", { branch: target, stash: true })
    } else void runAction("switchBranch", { branch: target })
  }

  const confirmDeleteBranch = async (force: boolean) => {
    const branch = deleteBranchDialog.value
    if (!branch) return
    deleteBranchDialog.setOpen(false)
    await runAction("deleteBranch", { branch, force })
  }

  // --- Sync & commit tools ---------------------------------------------------

  const requestPull = async (rebase: boolean) => {
    setForcePushOpen(false)
    if (buffer.entries.some(b => b.dirty) && !(await confirm.ask({
      title: "Pull?",
      description: "Open tabs have unsaved changes. They'll be lost when the working tree updates.",
      confirmLabel: "Pull anyway",
      destructive: true,
    }))) return
    // git refuses to pull over tracked changes — offer to stash them.
    if (status.files.some(f => f.status !== "untracked")) {
      if (await confirm.ask({
        title: "Uncommitted changes",
        description: `Stash your changes and ${rebase ? "rebase onto" : "fast-forward to"} the upstream?`,
        confirmLabel: "Stash & pull",
      })) await runAction("pull", { rebase, stash: true })
    } else void runAction("pull", { rebase })
  }

  const forcePush = async () => {
    setForcePushOpen(false)
    await runAction("push", { force: true })
  }

  const amend = async (message: string) => {
    if (headPushed && !(await confirm.ask({
      title: "Amend a pushed commit?",
      description: `"${repoState.headSubject}" is already pushed to ${repoState.upstream}. Amending rewrites it, so you'd have to force push.`,
      confirmLabel: "Amend anyway",
      destructive: true,
    }))) return false
    return runAction("amend", { message })
  }

  const runCommitAction = async (kind: CommitActionKind, commit: Commit) => {
    const label = `${commit.shortSha} "${commit.subject}"`
    if (kind === "undoCommit") {
      const pushed = headPushed ? ` It's already pushed to ${repoState.upstream} — undoing it rewrites published history.` : ""
      if (!(await confirm.ask({
        title: "Undo the last commit?",
        description: `Undo ${label}? Its changes stay staged.${pushed}`,
        confirmLabel: "Undo commit",
        destructive: headPushed,
      }))) return
      void runAction("undoCommit", { sha: commit.sha })
    } else if (kind === "revert") {
      if (!(await confirm.ask({
        title: "Revert this commit?",
        description: `Revert ${label}? This adds a new commit that undoes its changes.`,
        confirmLabel: "Revert",
      }))) return
      void runAction("revert", { sha: commit.sha })
    } else {
      if (!(await confirm.ask({
        title: "Cherry-pick this commit?",
        description: `Cherry-pick ${label} onto ${currentBranch}?`,
        confirmLabel: "Cherry-pick",
      }))) return
      void runAction("cherryPick", { sha: commit.sha })
    }
  }

  const commitActions: CommitActions = {
    head: repoState.head,
    branch: currentBranch,
    busy: !!busyAction,
    run: runCommitAction,
    isOnBranch: sha => sha === repoState.head || (!history.ref && history.commits.some(c => c.sha === sha)),
  }

  const abortOperation = async () => {
    const op = repoState.operation
    if (!op) return
    if (!(await confirm.ask({
      title: `Abort the ${op}?`,
      description: "Your branch and files go back to how they were before it started — conflict resolutions are lost.",
      confirmLabel: "Abort",
      destructive: true,
    }))) return
    void runAction("abortOperation")
  }

  // --- Tabs, find, repo switching ------------------------------------------

  const requestClose = useCallback(async (entry: BufferEntry) => {
    if (entry.dirty && !(await askConfirm({
      title: "Discard unsaved changes?",
      description: `Close ${entry.commit ? `commit ${entry.commit.slice(0, 7)}` : entry.file} without saving?`,
      confirmLabel: "Discard & close",
      destructive: true,
    }))) return
    buffer.close(entry.id)
  }, [buffer, askConfirm])

  // Close All / Others / to the Right: one confirmation for all unsaved tabs.
  const requestCloseMany = useCallback(async (entries: BufferEntry[]) => {
    const dirty = entries.filter(e => e.dirty).length
    if (dirty > 0 && !(await askConfirm({
      title: "Discard unsaved changes?",
      description: `${dirty} of the tabs being closed ${dirty === 1 ? "has" : "have"} unsaved changes. Close without saving?`,
      confirmLabel: "Discard & close",
      destructive: true,
    }))) return
    buffer.closeMany(entries.map(e => e.id))
  }, [buffer, askConfirm])

  const openFind = useCallback(() => {
    if (!active || active.commit || conflicted) return
    find.open()
    focusFindInput()
  }, [find, active, conflicted])

  // Points the app at another worktree (of the current project by default).
  // Resolves to false when the user kept their unsaved tabs instead.
  const switchRepo = async (next: string, project = projectDir): Promise<boolean> => {
    if (next === repoPath && project === projectDir) return true
    if (buffer.entries.some(b => b.dirty) && !(await confirm.ask({
      title: "Switch repository?",
      description: "Open tabs have unsaved changes. They'll be lost.",
      confirmLabel: "Discard & switch",
      destructive: true,
    }))) return false
    setProjectDir(project)
    setRepoPath(next)
    // Branch names belong to the old repo.
    history.showRef(null)
    status.clear()
    dirs.reset()
    buffer.restore(next)
    syncRepoToUrl({ project, repo: next })
    void status.loadStatus(next)
    return true
  }

  const addWorktree = async (w: NewWorktree) => {
    if (!(await runAction("addWorktree", { ...w }))) return false
    switchRepo(w.path)
    return true
  }

  // Step out of the worktree before it disappears.
  const confirmRemoveWorktree = async (force: boolean) => {
    const target = removeWorktreeDialog.value
    const main = worktrees.worktrees.find(w => w.main)
    if (!target || !main) return
    if (samePath(target.path, repoPath) && !(await switchRepo(main.path))) return
    removeWorktreeDialog.setOpen(false)
    await runAction("removeWorktree", { path: target.path, force })
  }

  // First load: apply ?project=<name>&worktree=<path>, restore that repo's
  // tabs, load status.
  const didInitialLoadRef = useRef(false)
  useEffect(() => {
    if (didInitialLoadRef.current) return
    didInitialLoadRef.current = true
    const selection = selectionFromUrl() ?? { project: projectDir, repo: repoPath }
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot URL → state hydration on mount */
    if (selection.project !== projectDir) setProjectDir(selection.project)
    if (selection.repo !== repoPath) setRepoPath(selection.repo)
    /* eslint-enable react-hooks/set-state-in-effect */
    buffer.restore(selection.repo)
    void status.loadStatus(selection.repo)
  }, [projectDir, repoPath, buffer, status])

  useKeyboardShortcuts({
    active,
    entries: buffer.entries,
    activate: buffer.activate,
    requestClose,
    openFind,
    closeFind: find.close,
    toggleSidebar: sidebar.toggle,
    toggleAgent: agentPanel.toggle,
    save: editing.saveFile,
    quickOpenOpen: quickOpen.open,
    openQuickOpen: quickOpen.show,
    newFile,
  })

  const viewerHandlers: ViewerHandlers = {
    save: editing.saveFile,
    toggleEdit: editing.toggleEditMode,
    editChange: content => {
      if (active) buffer.update(active.id, { editContent: content, dirty: content !== active.raw })
    },
    discard: entry => requestDiscard([entry.file], entry.staged),
    toggleStaged: entry => runAction(entry.staged ? "unstage" : "add", { files: [entry.file] }),
    toggleMarkdown: entry => {
      if (!entry.mdRender) void buffer.loadMarkdown(entry)
      buffer.update(entry.id, { mdRender: !entry.mdRender })
    },
    setViewMode: (entry, mode) => {
      buffer.update(entry.id, { viewMode: mode })
      if (mode === "raw" && (!entry.raw || entry.rawError)) void buffer.fetchRaw(entry)
    },
    delete: file => requestDelete([file]),
    toggleFind: () => (active?.findOpen ? find.close() : openFind()),
    toggleBlame: entry => {
      const blame = entry.viewMode !== "blame"
      buffer.update(entry.id, { viewMode: blame ? "blame" : "split" })
      if (blame && (!entry.blame || entry.blameError)) void buffer.fetchBlame(entry)
      if (!blame && entry.fromAll && !entry.raw) void buffer.fetchRaw(entry)
    },
    showHistory,
    openCommit,
    openFile: openFromTree,
    resolveConflict: (index, choice) => {
      if (!active) return
      const next = resolveConflict(active.dirty ? active.editContent : active.raw, index, choice)
      buffer.update(active.id, { editContent: next, dirty: next !== active.raw })
    },
    revertResolutions: entry => buffer.update(entry.id, { editContent: "", dirty: false }),
    markResolved: async entry => {
      const left = countConflicts(parseConflicts(entry.raw))
      if (left > 0 && !(await confirm.ask({
        title: "Mark as resolved?",
        description: `This file still has ${left} conflict${left > 1 ? "s" : ""}. Mark it as resolved anyway?`,
        confirmLabel: "Mark resolved",
      }))) return
      void runAction("add", { files: [entry.file] })
    },
  }

  const renderSidebar = (onNavigate: () => void) => (
    <SidebarContent
      tab={sidebarTab}
      onTabChange={setSidebarTab}
      history={history}
      activeCommit={active?.commit}
      commitActions={commitActions}
      onOpenCommit={openCommit}
      files={status.files}
      allFiles={status.allFiles}
      loading={status.loading}
      search={fileSearch}
      onSearchChange={setFileSearch}
      onOpenChange={openChange}
      onOpenTreeFile={openFromTree}
      onNavigate={onNavigate}
      fileManager={fileManager}
      menu={{
        newItem: fileManager.startCreate,
        rename: fileManager.startRename,
        delete: requestDelete,
        move: moveDialog.show,
        copyPath: (paths, absolute) => void copyText(paths.map(p => (absolute ? `${repoPath}/${p}` : p)).join("\n")),
        showHistory,
        reveal: revealInFiles,
        stage: (files, staged) => void runAction(staged ? "unstage" : "add", { files }),
        discard: requestDiscard,
        toggleDir: dirs.toggle,
        collapseAll: dirs.reset,
        refresh: () => void status.loadStatus(),
      }}
      tree={{
        activeFile: active?.file,
        expanded: dirs.expanded,
        busy: !!busyAction,
        onToggleDir: dirs.toggle,
        onStage: (files, staged) => runAction(staged ? "unstage" : "add", { files }),
        onDiscard: requestDiscard,
        onDelete: requestDelete,
      }}
    />
  )

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <AppHeader
          branchControls={
            <>
              <BranchPicker
                current={branches.current || status.branch}
                branches={branches.branches}
                repoPath={repoPath}
                busy={!!busyAction}
                onOpen={() => void branches.load()}
                onSwitch={requestSwitchBranch}
                onCreate={branch => void runAction("createBranch", { branch, checkout: true })}
                onDelete={deleteBranchDialog.show}
                onHistory={showBranchHistory}
              />
              <SyncMenu
                branch={currentBranch}
                state={repoState}
                busyAction={busyAction}
                onFetch={() => void runAction("fetch")}
                onPull={requestPull}
                onPush={() => void runAction("push")}
              />
              <StashMenu
                stashes={stash.stashes}
                busy={!!busyAction}
                onOpen={() => void stash.load()}
                onStash={(message, includeUntracked) => runAction("stash", { message, includeUntracked })}
                onView={s => openCommit(s.sha)}
                onApply={s => void runAction("stashApply", { index: s.index })}
                onPop={s => void runAction("stashPop", { index: s.index })}
                onDrop={async s => {
                  if (await confirm.ask({
                    title: "Drop stash?",
                    description: `Drop stash@{${s.index}}? This can't be undone.`,
                    confirmLabel: "Drop stash",
                    destructive: true,
                  })) void runAction("stashDrop", { index: s.index })
                }}
              />
            </>
          }
          error={status.error}
          loading={status.loading}
          actionResult={actionResult}
          busyAction={busyAction}
          isDark={isDark}
          projectDir={projectDir}
          repoPath={repoPath}
          worktrees={worktrees.worktrees}
          onToggleTheme={toggleTheme}
          onToggleSidebar={sidebar.toggle}
          agentOpen={agentPanel.visible}
          onToggleAgent={agentPanel.toggle}
          onOpenMobileSidebar={() => sidebar.setMobileOpen(true)}
          onQuickOpen={quickOpen.show}
          onDiscardAll={() => discardDialog.show({ action: "discardAll" })}
          onProjectChange={dir => switchRepo(dir, dir)}
          onWorktreeChange={path => switchRepo(path)}
          onAddWorktree={() => setAddWorktreeOpen(true)}
          onRemoveWorktree={removeWorktreeDialog.show}
          onRefresh={() => void status.loadStatus()}
          onCommit={message => runAction("commit", { message })}
          headSubject={repoState.headSubject}
          onAmend={amend}
          onPush={() => void runAction("push")}
          operation={repoState.operation}
          onContinueOperation={() => void runAction("continueOperation")}
          onAbortOperation={abortOperation}
        />

        <div className="flex min-h-0 flex-1">
          <SidebarFrame sidebar={sidebar} render={renderSidebar} />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden p-2 sm:p-4">
            <TabBar
              entries={buffer.entries}
              activeId={buffer.activeId}
              files={status.files}
              onActivate={buffer.activate}
              onRefresh={buffer.refresh}
              onClose={requestClose}
              onCloseMany={entries => void requestCloseMany(entries)}
            />
            <ViewerPanel
              active={active}
              repoPath={repoPath}
              conflicted={conflicted}
              fullPath={active ? (repoPath ? `${repoPath}/${active.file}` : active.file) : ""}
              busyAction={busyAction}
              isSaving={editing.isSaving}
              canEdit={!!active && !active.commit && editing.canEdit(active.file)}
              commitActions={commitActions}
              find={find}
              on={viewerHandlers}
            />
          </main>
          <AgentFrame
            panel={agentPanel}
            render={onNavigate => (
              <AgentPanel
                agent={agent}
                repo={repoPath}
                files={repoFiles}
                changedFiles={changedFiles}
                activeFile={active && !active.commit ? active.file : null}
                onClose={agentPanel.close}
                onOpenFile={file => {
                  openFromTree(file)
                  onNavigate()
                }}
              />
            )}
          />
        </div>

        <QuickOpen
          open={quickOpen.open}
          onOpenChange={quickOpen.setOpen}
          files={repoFiles}
          recent={recentFiles}
          changed={status.files}
          onOpen={openFromQuickOpen}
        />
        <MoveDialog
          open={moveDialog.open}
          onOpenChange={moveDialog.setOpen}
          paths={moveDialog.value}
          folders={moveFolders}
          existing={fileManager.existing}
          busy={busyAction === "move"}
          onMove={confirmMove}
        />
        <DeletePathDialog
          open={deleteDialog.open}
          onOpenChange={deleteDialog.setOpen}
          request={deleteDialog.value}
          busy={busyAction === "delete"}
          onConfirm={confirmDelete}
        />
        <ConfirmDialog open={confirm.open} request={confirm.request} onConfirm={confirm.confirm} onOpenChange={confirm.onOpenChange} />
        <DiscardDialog
          open={discardDialog.open}
          onOpenChange={discardDialog.setOpen}
          request={discardDialog.value}
          busyAction={busyAction}
          onConfirm={confirmDiscard}
        />
        <AddWorktreeDialog
          open={addWorktreeOpen}
          onOpenChange={setAddWorktreeOpen}
          mainDir={worktrees.worktrees.find(w => w.main)?.path ?? projectDir}
          branches={worktrees.branches}
          busy={busyAction === "addWorktree"}
          onCreate={addWorktree}
        />
        <DeleteBranchDialog
          open={deleteBranchDialog.open}
          onOpenChange={deleteBranchDialog.setOpen}
          branch={deleteBranchDialog.value}
          busy={busyAction === "deleteBranch"}
          onConfirm={confirmDeleteBranch}
        />
        <ForcePushDialog
          open={forcePushOpen}
          onOpenChange={setForcePushOpen}
          branch={currentBranch}
          upstream={repoState.upstream}
          busy={busyAction === "push"}
          onPullRebase={() => requestPull(true)}
          onForcePush={forcePush}
        />
        <RemoveWorktreeDialog
          open={removeWorktreeDialog.open}
          onOpenChange={removeWorktreeDialog.setOpen}
          worktree={removeWorktreeDialog.value}
          busy={busyAction === "removeWorktree"}
          onConfirm={confirmRemoveWorktree}
        />
      </div>
    </TooltipProvider>
  )
}
