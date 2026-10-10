import "server-only"
import { pathToFileURL } from "url"
import type { ContentBlock, SessionInfo } from "@agentclientprotocol/sdk"
import { base64Bytes, capUpdateImages, formatBytes, isImageType, MAX_IMAGE_BYTES, MAX_PROMPT_IMAGE_CHARS, MAX_PROMPT_IMAGES, sniffImageType, type ChatImage } from "@/lib/acp/images"
import type { AcpAction, AgentSessionSummary } from "@/lib/acp/types"
import { HttpError } from "../http"
import { pluginAgentEnv, pluginMcpServers } from "../plugins/mcp"
import { resolveInRepo } from "../repo"
import { AgentProcess } from "./agent-process"
import { findAgent, type AgentConfig } from "./config"
import { AgentSession, DEFAULT_TITLE } from "./session"
import { runShell, shellContext, stopShell } from "./shell"

const IDLE_MS = 30 * 60_000
const REAP_INTERVAL_MS = 60_000
const TITLE_MAX = 60
const PAGE_SIZE = 30
const MAX_PROMPT_FILES = 50
// A first-page request re-reads the agent's list; later pages reuse it
// unless it is older than this.
const LIST_CACHE_MS = 60_000

interface PastList {
  items: SessionInfo[]
  // The agent's own cursor for its next page; null once it has none left.
  agentCursor: string | null
  done: boolean
  fetchedAt: number
}

interface Registry {
  // "<agentId>\0<repo>" → the (starting) agent process
  processes: Map<string, Promise<AgentProcess>>
  sessions: Map<string, AgentSession>
  // Same key → what session/list returned so far (paged out to the browser)
  pastLists?: Map<string, PastList>
  reaper?: NodeJS.Timeout
}

// Lives on globalThis so dev HMR (which re-evaluates modules) doesn't lose
// track of running agent processes.
const g = globalThis as typeof globalThis & { __hunkAcp?: Registry }
const registry: Registry = (g.__hunkAcp ??= { processes: new Map(), sessions: new Map() })
registry.pastLists ??= new Map()
const pastLists = registry.pastLists

if (!registry.reaper) {
  registry.reaper = setInterval(reapIdle, REAP_INTERVAL_MS)
  registry.reaper.unref()
}

const processKey = (agentId: string, repo: string) => `${agentId}\0${repo}`

function sessionsOf(proc: AgentProcess) {
  return [...registry.sessions.values()].filter(s => s.agentId === proc.agent.id && s.repo === proc.repo)
}

async function getProcess(agent: AgentConfig, repo: string): Promise<AgentProcess> {
  const key = processKey(agent.id, repo)
  const existing = registry.processes.get(key)
  if (existing) {
    const proc = await existing.catch(() => null)
    if (proc?.alive) return proc
    if (registry.processes.get(key) === existing) registry.processes.delete(key)
  }
  const starting = pluginAgentEnv(repo).then(env => AgentProcess.start(agent, repo, {
    sessionUpdate: params => {
      const session = registry.sessions.get(params.sessionId)
      if (!session) return
      const u = capUpdateImages(params.update)
      if (u.sessionUpdate === "session_info_update" && u.title) session.setTitle(u.title)
      session.trackConfig(u)
      session.push({ type: "update", update: u })
    },
    requestPermission: async params => {
      const session = registry.sessions.get(params.sessionId)
      if (!session) return { outcome: { outcome: "cancelled" } }
      return session.requestPermission(params.toolCall, params.options)
    },
    exit: reason => {
      if (registry.processes.get(key) === starting) registry.processes.delete(key)
      for (const session of [...registry.sessions.values()]) {
        if (session.agentId !== agent.id || session.repo !== repo) continue
        session.disconnect(reason)
        registry.sessions.delete(session.id)
      }
    },
  }, env))
  registry.processes.set(key, starting)
  starting.catch(() => {
    if (registry.processes.get(key) === starting) registry.processes.delete(key)
  })
  return starting
}

// Kills agent processes nobody has used for IDLE_MS: no busy turn, no open
// stream, no pending permission.
function reapIdle() {
  const now = Date.now()
  for (const p of registry.processes.values()) {
    void p.then(proc => {
      const sessions = sessionsOf(proc)
      if (sessions.some(s => s.busy || s.shell || s.subscriberCount > 0 || s.pendingCount > 0)) {
        proc.touch()
        return
      }
      if (now - proc.lastActive > IDLE_MS) proc.kill()
    }, () => {})
  }
}

export function getSession(sessionId: string | null | undefined): AgentSession {
  const session = sessionId ? registry.sessions.get(sessionId) : undefined
  if (!session) throw new HttpError(404, "Session not found (the agent may have stopped). Resume it or start a new one.")
  return session
}

function summary(s: AgentSession): AgentSessionSummary {
  return { sessionId: s.id, agentId: s.agentId, title: s.title, live: true, busy: s.busy, updatedAt: s.updatedAt.toISOString() }
}

// Sessions attached here for the repo, newest first. Never starts the agent.
export async function listLiveSessions(repo: string, agentId: string | null): Promise<AgentSessionSummary[]> {
  const agent = await findAgent(agentId)
  return [...registry.sessions.values()]
    .filter(s => s.repo === repo && s.agentId === agent.id)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map(summary)
}

// One page of the sessions the agent remembers (session/list), minus live
// ones. `cursor` is our own offset into the agent's list. Agents page
// differently (claude returns everything at once, pi 50 at a time), so the
// list is cached per agent+repo and agent pages are fetched only as far as
// the requested page needs.
export async function listPastSessions(repo: string, agentId: string | null, cursor?: string | null): Promise<{ sessions: AgentSessionSummary[]; nextCursor: string | null }> {
  const agent = await findAgent(agentId)
  const proc = await getProcess(agent, repo)
  if (!proc.capabilities.sessionCapabilities?.list) return { sessions: [], nextCursor: null }
  proc.touch()

  const key = processKey(agent.id, repo)
  const offset = Math.max(0, Number(cursor) || 0)
  let list = pastLists.get(key)
  if (!list || offset === 0 || Date.now() - list.fetchedAt > LIST_CACHE_MS) {
    list = { items: [], agentCursor: null, done: false, fetchedAt: Date.now() }
    pastLists.set(key, list)
  }
  while (!list.done && list.items.length < offset + PAGE_SIZE) {
    const res = await proc.connection.listSessions({ cwd: repo, cursor: list.agentCursor ?? undefined })
    list.items.push(...res.sessions)
    list.agentCursor = res.nextCursor ?? null
    list.done = !res.nextCursor || res.sessions.length === 0
  }

  const end = offset + PAGE_SIZE
  const sessions = list.items
    .slice(offset, end)
    .filter(s => !registry.sessions.has(s.sessionId))
    .map(s => ({ sessionId: s.sessionId, agentId: agent.id, title: s.title || s.sessionId.slice(0, 8), live: false, busy: false, updatedAt: s.updatedAt ?? undefined }))
  const nextCursor = end < list.items.length || !list.done ? String(end) : null
  return { sessions, nextCursor }
}

// New session, or reattach one the agent knows (session/load replays its
// history as updates into the fresh event log; session/resume doesn't).
export async function openSession(repo: string, agentId: string | null, resumeId?: string): Promise<string> {
  const agent = await findAgent(agentId)
  if (resumeId) {
    const live = registry.sessions.get(resumeId)
    if (live && live.repo === repo && live.agentId === agent.id) return live.id
  }
  const proc = await getProcess(agent, repo)
  proc.touch()
  if (!resumeId) {
    const mcpServers = await pluginMcpServers(repo, proc.capabilities)
    const res = await proc.connection.newSession({ cwd: repo, mcpServers })
    const session = new AgentSession(res.sessionId, agent.id, repo)
    session.images = !!proc.capabilities.promptCapabilities?.image
    registry.sessions.set(session.id, session)
    session.setConfig(res.configOptions, res.modes)
    session.pushState()
    return session.id
  }

  const caps = proc.capabilities
  if (!caps.loadSession && !caps.sessionCapabilities?.resume) {
    throw new HttpError(400, `${agent.name} can't resume sessions`)
  }
  // Registered before loading so replayed updates land in its log.
  const session = new AgentSession(resumeId, agent.id, repo)
  session.images = !!caps.promptCapabilities?.image
  registry.sessions.set(resumeId, session)
  try {
    const mcpServers = await pluginMcpServers(repo, caps)
    const res = caps.loadSession
      ? await proc.connection.loadSession({ sessionId: resumeId, cwd: repo, mcpServers })
      : await proc.connection.resumeSession({ sessionId: resumeId, cwd: repo, mcpServers })
    session.setConfig(res?.configOptions, res?.modes)
  } catch (e) {
    registry.sessions.delete(resumeId)
    throw e
  }
  const known = caps.sessionCapabilities?.list
    ? (await proc.connection.listSessions({ cwd: repo }).catch(() => null))?.sessions.find(s => s.sessionId === resumeId)
    : undefined
  if (known?.title) session.title = known.title
  session.pushState()
  return session.id
}

async function processOf(session: AgentSession): Promise<AgentProcess> {
  const proc = await registry.processes.get(processKey(session.agentId, session.repo))?.catch(() => null)
  if (!proc?.alive) throw new HttpError(409, "The agent process has stopped")
  proc.touch()
  return proc
}

function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0].trim()
  return line.length > TITLE_MAX ? line.slice(0, TITLE_MAX - 1) + "…" : line
}

// Attached images from a request: user-supplied bytes, so the check is on
// the format (allowlisted type that matches the bytes) and size. They go
// straight to the agent, never to disk.
export function promptImages(images: unknown): ChatImage[] {
  if (images === undefined || images === null) return []
  if (!Array.isArray(images)) throw new HttpError(400, "Invalid images")
  if (images.length > MAX_PROMPT_IMAGES) throw new HttpError(400, `At most ${MAX_PROMPT_IMAGES} images per prompt`)
  let total = 0
  return images.map((image: unknown, i) => {
    const { data, mimeType } = (image ?? {}) as Partial<ChatImage>
    const label = `Image ${i + 1}`
    if (typeof data !== "string" || typeof mimeType !== "string") throw new HttpError(400, `${label} is invalid`)
    if (!isImageType(mimeType)) throw new HttpError(400, `${label}: ${mimeType} isn't supported (PNG, JPEG, GIF or WebP)`)
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw new HttpError(400, `${label} isn't valid base64`)
    const bytes = base64Bytes(data)
    if (bytes > MAX_IMAGE_BYTES) throw new HttpError(400, `${label} is ${formatBytes(bytes)} (max ${formatBytes(MAX_IMAGE_BYTES)})`)
    total += data.length
    if (total > MAX_PROMPT_IMAGE_CHARS) throw new HttpError(400, "The attached images are too large together")
    if (sniffImageType(Buffer.from(data.slice(0, 24), "base64")) !== mimeType) throw new HttpError(400, `${label} isn't really ${mimeType}`)
    return { data, mimeType }
  })
}

// The prompt text, one resource link per mentioned file and one image
// block per attached image. Every ACP agent must accept resource links;
// paths are checked to stay in the repo.
export function promptBlocks(repo: string, text: string, files: unknown, images: ChatImage[] = []): ContentBlock[] {
  const list = Array.isArray(files) ? files : []
  if (list.length > MAX_PROMPT_FILES) throw new HttpError(400, `At most ${MAX_PROMPT_FILES} files per prompt`)
  const blocks: ContentBlock[] = text.trim() || images.length === 0 ? [{ type: "text", text }] : []
  const seen = new Set<string>()
  for (const file of list) {
    if (typeof file !== "string" || seen.has(file)) continue
    seen.add(file)
    blocks.push({ type: "resource_link", name: file, uri: pathToFileURL(resolveInRepo(repo, file)).href })
  }
  for (const image of images) blocks.push({ type: "image", data: image.data, mimeType: image.mimeType })
  return blocks
}

async function prompt(session: AgentSession, text: string, files?: unknown, rawImages?: unknown) {
  const images = promptImages(rawImages)
  if (!text.trim() && images.length === 0) throw new HttpError(400, "Prompt is empty")
  if (images.length > 0 && !session.images) {
    const agent = await findAgent(session.agentId)
    throw new HttpError(400, `${agent.name} doesn't accept images`)
  }
  const blocks = promptBlocks(session.repo, text, files, images)
  if (session.busy) throw new HttpError(409, "The agent is still working on the previous prompt")
  const proc = await processOf(session)
  // `!` commands run since the last prompt go first, once.
  if (session.sharedShell.length > 0) {
    blocks.unshift({ type: "text", text: shellContext(session.sharedShell) })
    session.sharedShell = []
  }
  session.busy = true
  if (session.title === DEFAULT_TITLE) session.title = titleFrom(text) || "Image"
  session.push(images.length > 0 ? { type: "user_prompt", text, images } : { type: "user_prompt", text })
  session.pushState()
  // The turn runs in the background; the browser follows it over SSE.
  proc.connection.prompt({ sessionId: session.id, prompt: blocks })
    .then(res => session.push({ type: "turn_end", stopReason: res.stopReason }))
    .catch((e: unknown) => {
      if (!session.connected) return
      session.push({ type: "error", message: e instanceof Error ? e.message : String(e) })
      session.push({ type: "turn_end", stopReason: "error" })
    })
    .finally(() => {
      proc.touch()
      if (!session.connected) return
      session.busy = false
      session.pushState()
    })
}

async function setConfig(session: AgentSession, configId: string, value: string | boolean) {
  const option = session.config.configOptions.find(o => o.id === configId)
  if (!option) throw new HttpError(400, `Unknown setting: ${configId}`)
  if (option.type !== (typeof value === "boolean" ? "boolean" : "select")) throw new HttpError(400, `Wrong value type for ${option.name}`)
  const proc = await processOf(session)
  const res = typeof value === "boolean"
    ? await proc.connection.setSessionConfigOption({ sessionId: session.id, configId, type: "boolean", value })
    : await proc.connection.setSessionConfigOption({ sessionId: session.id, configId, value })
  session.setConfig(res.configOptions, null)
}

async function setMode(session: AgentSession, modeId: string) {
  const modes = session.config.modes
  if (!modes?.availableModes.some(m => m.id === modeId)) throw new HttpError(400, `Unknown mode: ${modeId}`)
  const proc = await processOf(session)
  await proc.connection.setSessionMode({ sessionId: session.id, modeId })
  session.setConfig(null, { ...modes, currentModeId: modeId })
}

async function close(session: AgentSession) {
  if (session.busy) await cancel(session)
  registry.sessions.delete(session.id)
  session.disconnect()
  const proc = await registry.processes.get(processKey(session.agentId, session.repo))?.catch(() => null)
  if (proc?.alive && proc.capabilities.sessionCapabilities?.close) {
    await proc.connection.closeSession({ sessionId: session.id }).catch(() => {})
  }
}

async function cancel(session: AgentSession) {
  session.cancelPending()
  const proc = await processOf(session)
  await proc.connection.cancel({ sessionId: session.id })
}

export async function runAction(session: AgentSession, action: AcpAction): Promise<void> {
  switch (action.action) {
    case "prompt":
      return prompt(session, action.text, action.files, action.images)
    case "cancel":
      return cancel(session)
    case "permission":
      if (!session.answerPermission(action.requestId, action.optionId)) {
        throw new HttpError(409, "That permission request was already answered")
      }
      return
    case "autoApprove":
      session.setAutoApprove(action.enabled)
      return
    case "setConfig":
      return setConfig(session, action.configId, action.value)
    case "setMode":
      return setMode(session, action.modeId)
    case "close":
      return close(session)
    case "shell":
      // A missing `share` is private: never leak output by accident.
      return runShell(session, String(action.command ?? ""), action.share === true)
    case "shellStop":
      return stopShell(session, action.shellId)
    default:
      throw new HttpError(400, `Unknown action: ${(action as { action: string }).action}`)
  }
}

// Kills every agent process (tests, shutdown).
export async function stopAll() {
  const procs = await Promise.all([...registry.processes.values()].map(p => p.catch(() => null)))
  for (const proc of procs) proc?.kill()
}
