import "server-only"
import { randomUUID } from "crypto"
import type { PermissionOption, RequestPermissionResponse, SessionConfigOption, SessionModeState, SessionUpdate, ToolCallUpdate } from "@agentclientprotocol/sdk"
import { autoApproveOption } from "@/lib/acp/permissions"
import type { AcpEvent, SeqEvent, SessionConfig, SessionState, ShellResult } from "@/lib/acp/types"

// Older events are dropped past this; a client that reconnects from before
// the oldest one gets a reset + full replay of what's left.
export const MAX_EVENTS = 20_000

export const DEFAULT_TITLE = "New session"

interface Subscriber {
  send: (event: SeqEvent) => void
  close: () => void
}

// The `!` command running in this session (one at a time).
export interface RunningShell {
  id: string
  stop: () => void
}

interface PendingPermission {
  options: PermissionOption[]
  resolve: (response: RequestPermissionResponse) => void
}

// One ACP session: its event log (what the browser replays and streams),
// run state, and the permission requests waiting for an answer.
export class AgentSession {
  title = DEFAULT_TITLE
  busy = false
  autoApprove = false
  connected = true
  updatedAt = new Date()
  config: SessionConfig = { configOptions: [], modes: null, usage: null }
  shell: RunningShell | null = null
  // Shared (`!`) command results not yet sent to the agent; the next
  // prompt carries them.
  sharedShell: ShellResult[] = []
  private events: SeqEvent[] = []
  private seq = 0
  private subscribers = new Set<Subscriber>()
  private pending = new Map<string, PendingPermission>()

  constructor(readonly id: string, readonly agentId: string, readonly repo: string) {}

  get state(): SessionState {
    return { title: this.title, busy: this.busy, autoApprove: this.autoApprove, connected: this.connected }
  }

  get subscriberCount() {
    return this.subscribers.size
  }

  get pendingCount() {
    return this.pending.size
  }

  push(event: AcpEvent) {
    const entry = { seq: ++this.seq, event }
    this.events.push(entry)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    this.updatedAt = new Date()
    for (const sub of this.subscribers) sub.send(entry)
  }

  // Live-only event: streamed to whoever is connected, not logged. It
  // reuses the current seq so Last-Event-ID resumes stay correct.
  broadcast(event: AcpEvent) {
    const entry = { seq: this.seq, event }
    for (const sub of this.subscribers) sub.send(entry)
  }

  pushState() {
    this.push({ type: "state", state: this.state })
  }

  // Replaces the config (from a new/load/resume/set response) and streams it.
  setConfig(configOptions: SessionConfigOption[] | null | undefined, modes: SessionModeState | null | undefined) {
    this.config = { ...this.config, configOptions: configOptions ?? this.config.configOptions, modes: modes ?? this.config.modes }
    this.push({ type: "config", config: this.config })
  }

  // Keeps the config snapshot in step with agent-side updates (the update
  // itself is streamed as is).
  trackConfig(u: SessionUpdate) {
    if (u.sessionUpdate === "config_option_update") this.config = { ...this.config, configOptions: u.configOptions }
    else if (u.sessionUpdate === "current_mode_update" && this.config.modes) this.config = { ...this.config, modes: { ...this.config.modes, currentModeId: u.currentModeId } }
    else if (u.sessionUpdate === "usage_update") this.config = { ...this.config, usage: { used: u.used, size: u.size } }
  }

  setTitle(title: string) {
    if (!title || title === this.title) return
    this.title = title
    this.pushState()
  }

  // Events after `lastSeq`. `reset` = the client must start over, because
  // it's new (lastSeq 0) or has fallen behind the oldest buffered event.
  since(lastSeq: number): { reset: boolean; events: SeqEvent[] } {
    const first = this.events[0]?.seq ?? this.seq + 1
    if (lastSeq <= 0 || lastSeq < first - 1 || lastSeq > this.seq) return { reset: true, events: this.events.slice() }
    return { reset: false, events: this.events.filter(e => e.seq > lastSeq) }
  }

  subscribe(send: Subscriber["send"], close: Subscriber["close"]): () => void {
    const sub = { send, close }
    this.subscribers.add(sub)
    return () => this.subscribers.delete(sub)
  }

  // Called by the agent connection. Auto mode answers right away (still
  // logged, so the transcript shows what was approved).
  requestPermission(toolCall: ToolCallUpdate, options: PermissionOption[]): Promise<RequestPermissionResponse> {
    const requestId = randomUUID()
    this.push({ type: "permission_request", requestId, toolCall, options })
    const auto = this.autoApprove ? autoApproveOption(options) : null
    if (auto) {
      this.push({ type: "permission_resolved", requestId, optionId: auto.optionId, auto: true })
      return Promise.resolve({ outcome: { outcome: "selected", optionId: auto.optionId } })
    }
    return new Promise(resolve => this.pending.set(requestId, { options, resolve }))
  }

  // optionId null = cancelled. Returns false for an unknown/answered request.
  answerPermission(requestId: string, optionId: string | null, auto = false): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false
    if (optionId !== null && !pending.options.some(o => o.optionId === optionId)) return false
    this.pending.delete(requestId)
    this.push({ type: "permission_resolved", requestId, optionId, auto })
    pending.resolve(optionId === null
      ? { outcome: { outcome: "cancelled" } }
      : { outcome: { outcome: "selected", optionId } })
    return true
  }

  setAutoApprove(enabled: boolean) {
    this.autoApprove = enabled
    this.pushState()
    if (!enabled) return
    for (const [requestId, { options }] of [...this.pending]) {
      const option = autoApproveOption(options)
      if (option) this.answerPermission(requestId, option.optionId, true)
    }
  }

  // ACP: when the client cancels a turn it must answer every pending
  // permission request with "cancelled".
  cancelPending() {
    for (const requestId of [...this.pending.keys()]) this.answerPermission(requestId, null)
  }

  // The agent is gone (process exit or session closed): fail what's
  // waiting, tell the browser, and end every open stream.
  disconnect(message?: string) {
    if (!this.connected) return
    this.cancelPending()
    this.shell?.stop()
    if (message) this.push({ type: "error", message })
    this.connected = false
    this.busy = false
    this.pushState()
    for (const sub of this.subscribers) sub.close()
    this.subscribers.clear()
  }
}
