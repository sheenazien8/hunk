import { useCallback, useState } from "react"
import { api } from "@/lib/api-client"
import type { GitFile, RepoEntry, StatusResponse } from "@/lib/git/types"

// Everything in a status response besides the files and branch name.
export type RepoState = Omit<StatusResponse, "files" | "branch">

const NO_STATE: RepoState = { ahead: 0, behind: 0 }

// Git status (changed files, branch, HEAD, upstream, operation in progress)
// and the All Files listing for a repo.
export function useGitStatus(repoPath: string) {
  const [files, setFiles] = useState<GitFile[]>([])
  const [branch, setBranch] = useState("")
  const [state, setState] = useState<RepoState>(NO_STATE)
  const [allFiles, setAllFiles] = useState<RepoEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const loadAllFiles = useCallback(async (repo?: string) => {
    try {
      setAllFiles((await api.allFiles(repo ?? repoPath)).files || [])
    } catch {
      // silently fail — this is auxiliary
    }
  }, [repoPath])

  // Returns the fresh file list, or null when loading failed.
  const loadStatus = useCallback(async (repo?: string): Promise<GitFile[] | null> => {
    const target = repo ?? repoPath
    setLoading(true)
    setError("")
    try {
      const { files: fresh, branch: name, ...rest } = await api.status(target)
      setFiles(fresh || [])
      setBranch(name || "")
      setState(rest)
      await loadAllFiles(target)
      return fresh || []
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load git status")
      return null
    } finally {
      setLoading(false)
    }
  }, [repoPath, loadAllFiles])

  // Drops the previous repo's lists while switching repos.
  const clear = useCallback(() => {
    setFiles([])
    setAllFiles([])
    setState(NO_STATE)
  }, [])

  return { files, branch, state, allFiles, loading, error, loadStatus, loadAllFiles, clear }
}
