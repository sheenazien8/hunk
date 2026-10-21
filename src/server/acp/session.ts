import "server-only"
import { randomUUID } from "crypto"
import { capEventImages, MAX_SESSION_IMAGE_BYTES } from "@/lib/acp/images"
import {
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationPropertySchema,
  ElicitationSchema,
  MultiSelectItems,
  PermissionOption,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState,
  SessionUpdate,
  ToolCallUpdate,
  type ElicitationContentValue,
  type EnumOption,
} from "@agentclientprotocol/sdk"
import { autoApproveOption } from "@/lib/acp/permissions"
import { tailBytes, type TerminalBuffer, type TerminalPatch } from "@/lib/acp/terminal"
import type { AcpEvent, ElicitationAnswer, SeqEvent, SessionConfig, SessionState, ShellResult, TerminalSnapshot } from "@/lib/acp/types"

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

interface PendingElicitation {
  requestedSchema: ElicitationSchema
  resolve: (response: CreateElicitationResponse) => void
}

// One ACP session: its event log (what the browser replays and streams),
// run state, the terminal buffers the agent reports, and the permission
// requests waiting for an answer.
export class AgentSession {
  title = DEFAULT_TITLE
  busy = false
  autoApprove = false
  connected = true
  // The agent takes image prompt blocks (set from its capabilities)
  images = false
  updatedAt = new Date()
  config: SessionConfig = { configOptions: [], modes: null, usage: null }
  shell: RunningShell | null = null
  // Variables exported by the user's `!export NAME=...` commands, carried
  // into every later command in this session.
  shellVars: Record<string, string> = {}
  // Shared (`!`) command results not yet sent to the agent; the next
  // prompt carries them.
  sharedShell: ShellResult[] = []
  // Agent terminal output so far, by terminalId.
  terminals = new Map<string, TerminalBuffer>()
  private events: SeqEvent[] = []
  private retainedImageBytes = 0
  private seq = 0
  private subscribers = new Set<Subscriber>()
  private pending = new Map<string, PendingPermission>()
  private pendingElicitations = new Map<string, PendingElicitation>()

  constructor(readonly id: string, readonly agentId: string, readonly repo: string) {}

  get state(): SessionState {
    return { title: this.title, busy: this.busy, autoApprove: this.autoApprove, connected: this.connected, images: this.images }
  }

  get subscriberCount() {
    return this.subscribers.size
  }

  get pendingCount() {
    return this.pending.size + this.pendingElicitations.size
  }

  push(event: AcpEvent) {
    const bounded = capEventImages(event, MAX_SESSION_IMAGE_BYTES - this.retainedImageBytes)
    this.retainedImageBytes += bounded.retainedBytes
    const entry = { seq: ++this.seq, event: bounded.event }
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

  // Merges an agent terminal patch (info/output/exit) into the buffer for
  // `patch.id` and logs the new snapshot. A `command` different from the
  // previous one restarts the buffer (agents reuse ids for retries).
  trackTerminal(patch: TerminalPatch) {
    const id = patch.id
    if (!id) return
    const prev = this.terminals.get(id) ?? { command: null, cwd: null, text: "" }
    const restart = patch.command !== undefined && patch.command !== null && patch.command !== prev.command
    const text = restart
      ? (patch.text ?? "")
      : patch.replace
        ? (patch.text ?? "")
        : tailBytes(prev.text + (patch.text ?? ""))
    const next: TerminalBuffer = {
      command: patch.command !== undefined ? patch.command : prev.command,
      cwd: patch.cwd !== undefined ? patch.cwd : prev.cwd,
      text,
    }
    this.terminals.set(id, next)
    const snapshot: TerminalSnapshot = { terminalId: id, command: next.command, cwd: next.cwd, text: next.text, exit: patch.exit ?? null }
    this.push({ type: "terminal_snapshot", terminal: snapshot })
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

  createElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    if (params.mode !== "form" || "requestId" in params) {
      return Promise.resolve({ action: "cancel", _meta: {} })
    }
    const elicitId = randomUUID()
    const requestedSchema = params.requestedSchema ?? { type: "object", properties: {} }
    this.push({
      type: "elicitation_request",
      elicitId,
      sessionId: params.sessionId,
      toolCallId: params.toolCallId ?? null,
      message: params.message,
      requestedSchema,
    })
    return new Promise(resolve => this.pendingElicitations.set(elicitId, { requestedSchema, resolve }))
  }

  answerElicitation(elicitId: string, action: "accept" | "decline" | "cancel", answers?: Record<string, ElicitationAnswer>): boolean {
    const pending = this.pendingElicitations.get(elicitId)
    if (!pending) return false
    this.pendingElicitations.delete(elicitId)
    const content: Record<string, ElicitationContentValue> | undefined = action === "accept" ? validateElicitationAnswers(pending.requestedSchema, answers) : undefined
    this.push({ type: "elicitation_resolved", elicitId, action, content })
    if (action === "accept") pending.resolve({ action: "accept", content })
    else if (action === "decline") pending.resolve({ action: "decline", _meta: {} })
    else pending.resolve({ action: "cancel", _meta: {} })
    return true
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
  // permission request with "cancelled" and every elicitation with "cancel".
  cancelPending() {
    for (const requestId of [...this.pending.keys()]) this.answerPermission(requestId, null)
    for (const elicitId of [...this.pendingElicitations.keys()]) this.answerElicitation(elicitId, "cancel")
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

function validateElicitationAnswers(
  schema: ElicitationSchema,
  answers: Record<string, ElicitationAnswer> | undefined,
): Record<string, ElicitationContentValue> {
  const out: Record<string, ElicitationContentValue> = {}
  if (!answers || typeof answers !== "object") return out
  const properties = schema.properties ?? {}
  for (const [key, raw] of Object.entries(answers)) {
    const prop = properties[key]
    if (!prop || raw === undefined || raw === null) continue
    if (ElicitationPropertySchema.isBoolean(prop) && typeof raw === "boolean") {
      out[key] = raw
      continue
    }
    if ((ElicitationPropertySchema.isNumber(prop) || ElicitationPropertySchema.isInteger(prop)) && typeof raw === "number") {
      if (ElicitationPropertySchema.isInteger(prop) && !Number.isInteger(raw)) continue
      if (prop.minimum != null && raw < prop.minimum) continue
      if (prop.maximum != null && raw > prop.maximum) continue
      out[key] = raw
      continue
    }
    if (ElicitationPropertySchema.isString(prop) && typeof raw === "string") {
      if (prop.minLength != null && raw.length < prop.minLength) continue
      if (prop.maxLength != null && raw.length > prop.maxLength) continue
      if (prop.enum && !prop.enum.includes(raw)) continue
      if (prop.oneOf && !prop.oneOf.some(o => o.const === raw)) continue
      out[key] = raw
      continue
    }
    if (ElicitationPropertySchema.isArray(prop) && Array.isArray(raw)) {
      const items = prop.items
      if (!isStringEnumItems(items) && !isTitledItems(items)) continue
      const allowed = isStringEnumItems(items)
        ? new Set(items.enum)
        : new Set((items as { anyOf: EnumOption[] }).anyOf.map(o => o.const))
      const cleaned = raw.filter((v): v is string => typeof v === "string" && allowed.has(v))
      if (isStringEnumItems(items) && cleaned.length === 0 && raw.length > 0) continue
      if (prop.minItems != null && cleaned.length < prop.minItems) continue
      if (prop.maxItems != null && cleaned.length > prop.maxItems) continue
      out[key] = cleaned
    }
  }
  return out
}

function isStringEnumItems(items: MultiSelectItems): items is { type: "string"; enum: string[] } {
  return typeof items === "object" && (items as { type?: string }).type === "string" && Array.isArray((items as { enum?: unknown }).enum)
}

function isTitledItems(items: MultiSelectItems): items is { anyOf: EnumOption[] } {
  return typeof items === "object" && Array.isArray((items as { anyOf?: unknown }).anyOf)
}

export const MAX_ELICITATION_FIELDS = 50
export const MAX_ELICITATION_OPTIONS = 100
export const MAX_ELICITATION_MESSAGE = 5000
export const MAX_ELICITATION_LABEL = 2000
