import { useCallback, useRef, useState } from "react"
import { api } from "@/lib/api-client"
import type { Commit } from "@/lib/git/types"

const PAGE = 50

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Failed to load history")

// Commit history for the History sidebar tab: the current branch or another
// one (`ref`), optionally only one file's history (`file`). Loads lazily
// (ensureLoaded, called when the list is shown) and page by page as it scrolls.
export function useHistory(repoPath: string) {
  const [file, setFile] = useState<string | null>(null)
  const [ref, setRef] = useState<string | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  // The (repo, ref, file) the list holds or is loading; answers for another
  // key are dropped.
  const key = `${repoPath}\0${ref ?? ""}\0${file ?? ""}`
  const keyRef = useRef<string | null>(null)
  const inFlightRef = useRef(false)

  const fetchPage = useCallback(async (forKey: string, skip: number) => {
    inFlightRef.current = true
    setLoading(true)
    try {
      const page = await api.log(repoPath, { file: file ?? undefined, ref: ref ?? undefined, limit: PAGE, skip })
      if (keyRef.current !== forKey) return
      setCommits(prev => (skip === 0 ? page.commits : [...prev, ...page.commits]))
      setHasMore(page.hasMore)
      setError("")
    } catch (e) {
      if (keyRef.current !== forKey) return
      setError(errorText(e))
      setHasMore(false)
    } finally {
      if (keyRef.current === forKey) {
        inFlightRef.current = false
        setLoading(false)
      }
    }
  }, [repoPath, file, ref])

  // Loads the first page unless the list already holds this (repo, file).
  const ensureLoaded = useCallback(() => {
    if (keyRef.current === key) return
    keyRef.current = key
    setCommits([])
    setHasMore(false)
    setError("")
    void fetchPage(key, 0)
  }, [key, fetchPage])

  // Refreshes a list that has been loaded (e.g. after a commit).
  const reload = useCallback(() => {
    if (keyRef.current === key) void fetchPage(key, 0)
  }, [key, fetchPage])

  const loadMore = useCallback(() => {
    if (inFlightRef.current || !hasMore || keyRef.current !== key) return
    void fetchPage(key, commits.length)
  }, [hasMore, key, commits.length, fetchPage])

  // Scopes the list to one file's history, or back to everything (null).
  const showFile = useCallback((next: string | null) => setFile(next), [])
  // Shows another branch's commits, or the current branch's again (null).
  const showRef = useCallback((next: string | null) => setRef(next), [])

  return { file, ref, commits, hasMore, loading, error, ensureLoaded, reload, loadMore, showFile, showRef }
}

export type History = ReturnType<typeof useHistory>
