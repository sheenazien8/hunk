import type {
  AcpAction,
  AgentsResponse,
  OpenSessionResponse,
  SessionsResponse,
} from "@/lib/acp/types"
import type {
  ActionName,
  ActionPayload,
  ActionResponse,
  AllFilesResponse,
  BlameResponse,
  BranchesResponse,
  CommitResponse,
  ContentResponse,
  DiffResponse,
  LogResponse,
  StashResponse,
  StatusResponse,
  WorktreesResponse,
} from "@/lib/git/types"
import type { PluginsResponse } from "@/lib/plugins/types"

// Typed wrappers around /api/git/* and /api/acp/*. Every call resolves with the success
// payload or throws an Error carrying the server's `error` message.

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json()
  if (data?.error) throw new Error(data.error)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return data as T
}

function query(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, v)
  return qs.toString()
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

export const api = {
  async plugins() {
    return (await request<PluginsResponse>("/api/plugins")).plugins
  },

  status(repo: string) {
    return request<StatusResponse>(`/api/git/status?${query({ repo })}`)
  },

  worktrees(repo: string) {
    return request<WorktreesResponse>(`/api/git/worktrees?${query({ repo })}`)
  },

  allFiles(repo: string) {
    return request<AllFilesResponse>(`/api/git/all-files?${query({ repo })}`)
  },

  async diff(repo: string, file: string, staged: boolean, oldPath?: string) {
    const qs = query({ repo, file, staged: staged ? "1" : "0", oldPath })
    return (await request<DiffResponse>(`/api/git/diff?${qs}`)).diff
  },

  // One file's change in a commit.
  async commitDiff(repo: string, commit: string, file: string, oldPath?: string) {
    return (await request<DiffResponse>(`/api/git/diff?${query({ repo, commit, file, oldPath })}`)).diff
  },

  blame(repo: string, file: string, ref?: string) {
    return request<BlameResponse>(`/api/git/blame?${query({ repo, file, ref })}`)
  },

  log(repo: string, { file, ref, limit, skip }: { file?: string; ref?: string; limit: number; skip: number }) {
    return request<LogResponse>(`/api/git/log?${query({ repo, file, ref, limit: String(limit), skip: String(skip) })}`)
  },

  commit(repo: string, sha: string) {
    return request<CommitResponse>(`/api/git/commit?${query({ repo, sha })}`)
  },

  branches(repo: string) {
    return request<BranchesResponse>(`/api/git/branches?${query({ repo })}`)
  },

  async stashes(repo: string) {
    return (await request<StashResponse>(`/api/git/stash?${query({ repo })}`)).stashes
  },

  async content(repo: string, file: string) {
    return (await request<ContentResponse>(`/api/git/content?${query({ repo, file })}`)).content
  },

  async saveContent(repo: string, file: string, content: string) {
    await request(`/api/git/content?${query({ repo, file })}`, json("PUT", { content }))
  },

  async action(repo: string, action: ActionName, payload?: ActionPayload) {
    return (await request<ActionResponse>("/api/git/action", json("POST", { action, repo, ...payload }))).message
  },

  acp: {
    async agents() {
      return (await request<AgentsResponse>("/api/acp/agents")).agents
    },

    async liveSessions(repo: string, agent: string) {
      return (await request<SessionsResponse>(`/api/acp/sessions?${query({ repo, agent, scope: "live" })}`)).sessions
    },

    pastSessions(repo: string, agent: string, cursor?: string) {
      return request<SessionsResponse>(`/api/acp/sessions?${query({ repo, agent, cursor })}`)
    },

    async open(repo: string, agent: string, resumeId?: string) {
      return (await request<OpenSessionResponse>("/api/acp/sessions", json("POST", { repo, agent, resumeId }))).sessionId
    },

    async action(sessionId: string, action: AcpAction) {
      await request("/api/acp/action", json("POST", { sessionId, ...action }))
    },

    eventsUrl(sessionId: string) {
      return `/api/acp/events?${query({ sessionId })}`
    },
  },
}
