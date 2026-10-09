import { useCallback, useEffect, useRef, useState } from "react"
import type { ToolKind } from "@agentclientprotocol/sdk"
import { api } from "@/lib/api-client"
import { applyEvents, emptyTranscript, touchesFiles, type Transcript } from "@/lib/acp/transcript"
import type { AcpAction, AcpEvent, AgentInfo, SeqEvent } from "@/lib/acp/types"

const AGENT_KEY = "hunk-agent"
const SESSION_PREFIX = "hunk-agent-session-"
const FILES_CHANGED_DEBOUNCE_MS = 400

export type StreamStatus = "connecting" | "open" | "closed"

function sessionKey(repo: string) {
  try {
    return SESSION_PREFIX + btoa(repo)
  } catch {
    return SESSION_PREFIX + encodeURIComponent(repo)
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Agent chat for the active repo: agent + session selection (session
// persisted per repo), the transcript fed by the session's SSE stream, and
// the prompt/permission actions. Does nothing until `enabled` (the panel
// is open). The session list itself is loaded by the picker, on demand.
export function useAgent(repo: string, enabled: boolean, onFilesChanged: () => void) {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [agentId, setAgentId] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<Transcript>(emptyTranscript)
  // Bumped on every select so re-selecting the same session (Resume)
  // still opens a fresh stream.
  const [connection, setConnection] = useState(0)
  const [stream, setStream] = useState<{ connection: number; status: StreamStatus } | null>(null)
  const [pending, setPending] = useState<"open" | "send" | null>(null)
  // Id of the setting being changed (the control shows a spinner)
  const [configPending, setConfigPending] = useState<string | null>(null)
  const [error, setError] = useState("")

  const onFilesChangedRef = useRef(onFilesChanged)
  useEffect(() => {
    onFilesChangedRef.current = onFilesChanged
  })

  // --- Agents + sessions -----------------------------------------------------

  useEffect(() => {
    if (!enabled || agents.length > 0) return
    api.acp.agents().then(list => {
      setAgents(list)
      const stored = readStorage(AGENT_KEY)
      setAgentId(list.find(a => a.id === stored)?.id ?? list[0]?.id ?? "")
    }, e => setError(errorText(e)))
  }, [enabled, agents.length])

  // The repo's last session comes back when switching repos.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- restoring the repo's persisted session from localStorage (client-only) */
    setSessionId(readStorage(sessionKey(repo)))
    setConnection(c => c + 1)
    setTranscript(emptyTranscript())
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [repo])

  const select = useCallback((id: string | null) => {
    setSessionId(id)
    setConnection(c => c + 1)
    setTranscript(emptyTranscript())
    setError("")
    writeStorage(sessionKey(repo), id)
  }, [repo])

  const selectAgent = useCallback((id: string) => {
    setAgentId(id)
    writeStorage(AGENT_KEY, id)
    select(null)
  }, [select])

  const openSession = useCallback(async (resumeId?: string) => {
    if (!agentId) return
    setPending("open")
    setError("")
    try {
      const id = await api.acp.open(repo, agentId, resumeId)
      select(id)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setPending(null)
    }
  }, [repo, agentId, select])

  const startTask = useCallback(async (text: string, files: string[] = []) => {
    setPending("open")
    setError("")
    try {
      let agent = agentId
      if (!agent) {
        const list = agents.length > 0 ? agents : await api.acp.agents()
        if (agents.length === 0) setAgents(list)
        agent = list.find(a => a.id === readStorage(AGENT_KEY))?.id ?? list[0]?.id ?? ""
        if (!agent) throw new Error("No agent is configured")
        setAgentId(agent)
      }
      const id = await api.acp.open(repo, agent)
      await api.acp.action(id, { action: "prompt", text, files })
      select(id)
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    } finally {
      setPending(null)
    }
  }, [repo, agentId, agents, select])

  // The server returns a live session as is and asks the agent to load
  // any other one (so this also revives a session whose agent exited).
  const resume = useCallback((id: string) => void openSession(id), [openSession])

  // --- Event stream ----------------------------------------------------------

  useEffect(() => {
    if (!enabled || !sessionId) return
    const source = new EventSource(api.acp.eventsUrl(sessionId))
    const queue: SeqEvent[] = []
    const toolKinds = new Map<string, ToolKind>()
    let frame = 0
    let filesTimer: ReturnType<typeof setTimeout> | undefined

    const filesChanged = () => {
      clearTimeout(filesTimer)
      filesTimer = setTimeout(() => onFilesChangedRef.current(), FILES_CHANGED_DEBOUNCE_MS)
    }
    const watchFiles = (event: AcpEvent) => {
      // A finished `!` command may have changed the tree too (checkout, format…)
      if (event.type === "turn_end" || event.type === "shell_end") return filesChanged()
      if (event.type !== "update") return
      const u = event.update
      if (u.sessionUpdate === "tool_call" && u.kind) toolKinds.set(u.toolCallId, u.kind)
      if (u.sessionUpdate === "tool_call_update" && u.status === "completed" && touchesFiles(u.kind ?? toolKinds.get(u.toolCallId))) {
        filesChanged()
      }
    }
    // Chunks can arrive hundreds per second; apply them once per frame.
    const flush = () => {
      frame = 0
      const batch = queue.splice(0)
      setTranscript(t => applyEvents(t, batch))
    }

    source.onopen = () => setStream({ connection, status: "open" })
    source.onmessage = msg => {
      const event = JSON.parse(msg.data) as AcpEvent
      queue.push({ seq: Number(msg.lastEventId) || 0, event })
      watchFiles(event)
      if (!frame) frame = requestAnimationFrame(flush)
    }
    // CONNECTING = EventSource is retrying on its own (resuming from
    // Last-Event-ID); CLOSED = the server refused (session is gone).
    source.onerror = () => {
      setStream({ connection, status: source.readyState === EventSource.CLOSED ? "closed" : "connecting" })
    }
    return () => {
      source.close()
      cancelAnimationFrame(frame)
      clearTimeout(filesTimer)
    }
  }, [enabled, sessionId, connection])

  const streamStatus: StreamStatus = stream?.connection === connection ? stream.status : "connecting"

  // --- Actions ---------------------------------------------------------------

  const act = useCallback(async (action: AcpAction) => {
    if (!sessionId) return false
    try {
      await api.acp.action(sessionId, action)
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    }
  }, [sessionId])

  const send = useCallback(async (text: string, files: string[] = []) => {
    setPending("send")
    setError("")
    try {
      return await act({ action: "prompt", text, files })
    } finally {
      setPending(null)
    }
  }, [act])

  // `!` (share) / `!!` command, run by the server, not the agent
  const runShell = useCallback(async (command: string, share: boolean) => {
    setPending("send")
    setError("")
    try {
      return await act({ action: "shell", command, share })
    } finally {
      setPending(null)
    }
  }, [act])

  const changeSetting = useCallback(async (id: string, action: AcpAction) => {
    setConfigPending(id)
    setError("")
    try {
      return await act(action)
    } finally {
      setConfigPending(null)
    }
  }, [act])

  const closeSession = useCallback(async () => {
    if (await act({ action: "close" })) select(null)
  }, [act, select])

  return {
    agents,
    agentId,
    sessionId,
    transcript,
    streamStatus,
    pending,
    error,
    clearError: () => setError(""),
    selectAgent,
    newSession: () => openSession(),
    startTask,
    resume,
    send,
    cancel: () => act({ action: "cancel" }),
    runShell,
    stopShell: (shellId: string) => act({ action: "shellStop", shellId }),
    answer: (requestId: string, optionId: string | null) => act({ action: "permission", requestId, optionId }),
    setAutoApprove: (enabled: boolean) => act({ action: "autoApprove", enabled }),
    configPending,
    setConfig: (configId: string, value: string | boolean) => changeSetting(configId, { action: "setConfig", configId, value }),
    setMode: (modeId: string) => changeSetting("mode", { action: "setMode", modeId }),
    closeSession,
  }
}

export type Agent = ReturnType<typeof useAgent>
