import { useCallback, useEffect, useMemo, useReducer, useRef } from "react"
import { api } from "@/lib/api-client"
import {
  type BufferEntry,
  type TabKey,
  bufferReducer,
  emptyBuffer,
  makeTabId,
  newEntry,
  readPersistedBuffer,
  writePersistedBuffer,
} from "./buffer"

// Open-tabs state for one repo: the entries, the active tab, content loading
// and per-repo persistence to localStorage.
export function useBuffer(repoPath: string, statusLoading: boolean) {
  const [state, dispatch] = useReducer(bufferReducer, emptyBuffer)
  const { entries, activeId } = state

  // The repo whose localStorage slot the buffer is persisted to. Persistence
  // only starts after the first restore() so the empty seed state never
  // clobbers stored tabs.
  const persistedRepoRef = useRef<string | null>(null)
  useEffect(() => {
    if (persistedRepoRef.current !== null) writePersistedBuffer(persistedRepoRef.current, state)
  }, [state])

  // Tracks ids whose diff fetch is currently in flight. This is a *synchronous*
  // mirror of BufferEntry.diffLoading — React state updates batched inside a
  // single event tick can't be observed by sibling clicks, so rapid clicks on
  // the same file would all see diffLoading=false and queue duplicate fetches.
  const inFlightRef = useRef<Set<string>>(new Set())

  const active = useMemo(
    () => (activeId ? entries.find(b => b.id === activeId) ?? null : null),
    [entries, activeId]
  )

  const update = useCallback((id: string, patch: Partial<BufferEntry>) => {
    dispatch({ type: "update", id, patch })
  }, [])

  const activate = useCallback((id: string) => dispatch({ type: "activate", id }), [])
  const close = useCallback((id: string) => dispatch({ type: "close", id }), [])
  // A file/dir was moved or deleted: tabs follow it or close. A moved active
  // tab gets a new id, so the active-tab effect below re-fetches it.
  const remap = useCallback((from: string, to: string, keyFor: (file: string, entry: BufferEntry) => TabKey) => {
    dispatch({ type: "remap", repo: repoPath, from, to, keyFor })
  }, [repoPath])
  const closeUnder = useCallback((path: string) => dispatch({ type: "closeUnder", path }), [])

  // Replaces the buffer with the tabs persisted for `repo` and persists
  // there from now on.
  const restore = useCallback((repo: string) => {
    persistedRepoRef.current = repo
    dispatch({ type: "reset", state: readPersistedBuffer(repo) })
  }, [])

  // Reads the file's raw content into the entry and returns it.
  const fetchRaw = useCallback(async (entry: BufferEntry): Promise<string> => {
    try {
      const content = await api.content(repoPath, entry.file)
      update(entry.id, { rawError: "", raw: content ?? "" })
      return content ?? ""
    } catch (e) {
      update(entry.id, { rawError: e instanceof Error ? e.message : "Failed to read file", raw: "" })
      return ""
    }
  }, [repoPath, update])

  const fetchBlame = useCallback(async (entry: BufferEntry) => {
    try {
      update(entry.id, { blame: await api.blame(repoPath, entry.file), blameError: "" })
    } catch (e) {
      update(entry.id, { blame: null, blameError: e instanceof Error ? e.message : "Failed to load blame" })
    }
  }, [repoPath, update])

  const fetchCommit = useCallback(async (entry: BufferEntry, sha: string) => {
    try {
      update(entry.id, { commitData: await api.commit(repoPath, sha), commitError: "" })
    } catch (e) {
      update(entry.id, { commitData: null, commitError: e instanceof Error ? e.message : "Failed to load commit" })
    }
  }, [repoPath, update])

  // Fetches the diff and (when needed) raw content for the entry. Entries
  // opened from All Files always pull raw content; entries with a diff only
  // pull raw when the user has switched to raw view mode, or when the file is
  // unmerged (a combined diff) — the conflict view works on the file itself.
  // Commit tabs load the commit instead.
  const fetchEntry = useCallback(async (entry: BufferEntry) => {
    inFlightRef.current.add(entry.id)
    update(entry.id, { diffLoading: true })
    try {
      if (entry.commit) {
        await fetchCommit(entry, entry.commit)
        return
      }
      const diff = entry.fromAll ? "" : await api.diff(repoPath, entry.file, entry.staged, entry.oldPath)
      update(entry.id, { diff })
      if (entry.fromAll || entry.viewMode === "raw" || isUnmergedDiff(diff)) {
        await fetchRaw(entry)
      }
      if (entry.viewMode === "blame") await fetchBlame(entry)
    } catch {
      update(entry.id, { diff: "" })
    } finally {
      inFlightRef.current.delete(entry.id)
      update(entry.id, { diffLoading: false })
    }
  }, [repoPath, fetchRaw, fetchBlame, fetchCommit, update])

  const loadMarkdown = useCallback(async (entry: BufferEntry) => {
    try {
      update(entry.id, { md: await api.content(repoPath, entry.file) ?? "" })
    } catch {
      update(entry.id, { md: "" })
    }
  }, [repoPath, update])

  // Opens a new tab or activates the existing one; either way the content is
  // re-fetched so the user always sees the file's current state.
  const open = useCallback((key: TabKey) => {
    const id = makeTabId(repoPath, key)
    const existing = entries.find(b => b.id === id)
    // In-flight guard: the ref covers rapid clicks within one event tick, the
    // entry flag covers clicks separated by a render.
    if (inFlightRef.current.has(id) || existing?.diffLoading) {
      activate(id)
      return
    }
    const target = existing ?? newEntry(repoPath, key)
    dispatch({ type: "open", entry: target })
    // Re-opening a commit from another file's history focuses that file.
    if (existing && key.commitFile && existing.commitFile !== key.commitFile) update(id, { commitFile: key.commitFile })
    void fetchEntry(target)
  }, [entries, repoPath, activate, fetchEntry, update])

  // Re-fetches an entry's content (the tab's refresh button).
  const refresh = useCallback((entry: BufferEntry) => {
    if (inFlightRef.current.has(entry.id) || entry.diffLoading) return
    activate(entry.id)
    void fetchEntry(entry)
  }, [activate, fetchEntry])

  // Once git status has loaded (so rename hints are known), fetch the active
  // tab's content — on first load, after a repo switch, and whenever another
  // tab becomes active.
  const activeRefetchedRef = useRef(false)
  useEffect(() => {
    if (activeRefetchedRef.current) return
    if (!active || active.diffLoading) return
    if (statusLoading) return
    activeRefetchedRef.current = true
    void fetchEntry(active)
  }, [active, statusLoading, fetchEntry])

  useEffect(() => {
    activeRefetchedRef.current = false
  }, [repoPath, activeId])

  return {
    entries,
    activeId,
    active,
    open,
    activate,
    close,
    remap,
    closeUnder,
    refresh,
    update,
    restore,
    fetchRaw,
    fetchBlame,
    fetchEntry,
    loadMarkdown,
  }
}

// `git diff` of an unmerged path is a combined diff ("diff --cc"), or just
// "* Unmerged path <file>" when one side deleted it.
function isUnmergedDiff(diff: string) {
  return /^(diff --cc |\* Unmerged path )/m.test(diff)
}

export type Buffer = ReturnType<typeof useBuffer>
