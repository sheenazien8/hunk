import type { PermissionOption, PlanEntry, StopReason, ToolCallContent, ToolCallLocation, ToolCallStatus, ToolKind } from "@agentclientprotocol/sdk"
import type { ChatImage } from "./images"
import type { AcpEvent, SeqEvent, SessionConfig, SessionState, ShellResult } from "./types"

// Folds a session's event log into the chat items the panel renders.

export type ChatItem =
  // `images` render after the text. An image starts a new item, so text
  // that follows it stays below it.
  | { kind: "user" | "agent" | "thought"; id: string; text: string; messageId?: string; images?: ChatImage[] }
  | {
      kind: "tool"
      id: string
      toolCallId: string
      title: string
      toolKind?: ToolKind
      status: ToolCallStatus
      content: ToolCallContent[]
      locations: ToolCallLocation[]
      rawInput?: unknown
    }
  | { kind: "plan"; id: string; entries: PlanEntry[]; markdown?: string }
  | {
      kind: "permission"
      id: string
      requestId: string
      title: string
      options: PermissionOption[]
      status: "pending" | "answered" | "auto" | "cancelled"
      optionId: string | null
    }
  | { kind: "turn_end"; id: string; stopReason: StopReason | "error" }
  | { kind: "error"; id: string; message: string }
  | { kind: "notice"; id: string; severity: string; title: string; description?: string }
  | {
      kind: "shell"
      id: string
      shellId: string
      command: string
      // false = `!!`: not sent to the agent
      share: boolean
      lines: string[]
      dropped: number
      // Set once the command has finished
      result: ShellResult | null
    }

export interface Transcript {
  items: ChatItem[]
  state: SessionState
  // Latest agent settings (model, thinking, mode…) and context usage
  config: SessionConfig
  lastSeq: number
}

export function emptyTranscript(): Transcript {
  return {
    items: [],
    state: { title: "", busy: false, autoApprove: false, connected: true, images: false },
    config: { configOptions: [], modes: null, usage: null },
    lastSeq: 0,
  }
}

// Applies a batch of events. Items are replaced, never mutated, so memoized
// rows only re-render when their own item changed.
export function applyEvents(t: Transcript, events: SeqEvent[]): Transcript {
  if (events.length === 0) return t
  let items = t.items.slice()
  let state = t.state
  let config = t.config
  let lastSeq = t.lastSeq

  const last = () => items[items.length - 1]
  const replaceLast = (item: ChatItem) => {
    items[items.length - 1] = item
  }
  const indexWhere = (pred: (item: ChatItem) => boolean) => {
    for (let i = items.length - 1; i >= 0; i--) if (pred(items[i])) return i
    return -1
  }

  // Same kind (and message) as the last item: text joins it unless it ends
  // in images; images join it.
  const appendChunk = (kind: "user" | "agent" | "thought", chunk: { text: string } | { image: ChatImage }, messageId: string | undefined, id: string) => {
    const prev = last()
    const same = prev && prev.kind === kind && (!messageId || !prev.messageId || prev.messageId === messageId)
    if ("image" in chunk) {
      if (same) replaceLast({ ...prev, images: [...(prev.images ?? []), chunk.image], messageId: prev.messageId ?? messageId })
      else items.push({ kind, id, text: "", messageId, images: [chunk.image] })
    } else if (same && !prev.images?.length) {
      replaceLast({ ...prev, text: prev.text + chunk.text, messageId: prev.messageId ?? messageId })
    } else {
      items.push({ kind, id, text: chunk.text, messageId })
    }
  }

  const setPlan = (entries: PlanEntry[], markdown: string | undefined, id: string) => {
    items = items.filter(item => item.kind !== "plan")
    items.push({ kind: "plan", id, entries, markdown })
  }

  for (const { seq, event } of events) {
    if (event.type !== "reset") lastSeq = Math.max(lastSeq, seq)
    const id = `e${seq}`
    switch (event.type) {
      case "reset":
        items = []
        state = emptyTranscript().state
        config = emptyTranscript().config
        lastSeq = 0
        break
      case "state":
        state = event.state
        break
      case "config":
        config = event.config
        break
      case "user_prompt":
        items.push(event.images?.length ? { kind: "user", id, text: event.text, images: event.images } : { kind: "user", id, text: event.text })
        break
      case "turn_end":
        items.push({ kind: "turn_end", id, stopReason: event.stopReason })
        break
      case "error":
        items.push({ kind: "error", id, message: event.message })
        break
      case "shell_start":
        items.push({ kind: "shell", id, shellId: event.shellId, command: event.command, share: event.share, lines: [], dropped: 0, result: null })
        break
      case "shell_output":
      case "shell_end": {
        const i = indexWhere(item => item.kind === "shell" && item.shellId === event.shellId)
        const item = items[i]
        if (item?.kind !== "shell" || item.result) break
        items[i] = event.type === "shell_end"
          ? { ...item, lines: event.result.lines, dropped: event.result.dropped, result: event.result }
          : { ...item, lines: event.lines, dropped: event.dropped }
        break
      }
      case "permission_request":
        items.push({
          kind: "permission",
          id,
          requestId: event.requestId,
          title: event.toolCall.title ?? "Permission requested",
          options: event.options,
          status: "pending",
          optionId: null,
        })
        break
      case "permission_resolved": {
        const i = indexWhere(item => item.kind === "permission" && item.requestId === event.requestId)
        const item = items[i]
        if (item?.kind === "permission") {
          items[i] = {
            ...item,
            optionId: event.optionId,
            status: event.optionId === null ? "cancelled" : event.auto ? "auto" : "answered",
          }
        }
        break
      }
      case "update": {
        const u = event.update
        switch (u.sessionUpdate) {
          case "user_message_chunk":
          case "agent_message_chunk":
          case "agent_thought_chunk": {
            const kind = u.sessionUpdate === "user_message_chunk" ? "user" : u.sessionUpdate === "agent_message_chunk" ? "agent" : "thought"
            const c = u.content
            const chunk = c.type === "image"
              ? { image: { data: c.data, mimeType: c.mimeType } }
              : { text: c.type === "text" ? c.text : c.type === "resource_link" ? `[${c.name}](${c.uri})` : `[${c.type}]` }
            appendChunk(kind, chunk, u.messageId ?? undefined, id)
            break
          }
          case "tool_call": {
            const i = indexWhere(item => item.kind === "tool" && item.toolCallId === u.toolCallId)
            const item: ChatItem = {
              kind: "tool",
              id: i >= 0 ? items[i].id : id,
              toolCallId: u.toolCallId,
              title: u.title,
              toolKind: u.kind,
              status: u.status ?? "pending",
              content: u.content ?? [],
              locations: u.locations ?? [],
              rawInput: u.rawInput,
            }
            if (i >= 0) items[i] = item
            else items.push(item)
            break
          }
          case "tool_call_update": {
            const i = indexWhere(item => item.kind === "tool" && item.toolCallId === u.toolCallId)
            const prev = items[i]
            if (prev?.kind !== "tool") {
              items.push({
                kind: "tool",
                id,
                toolCallId: u.toolCallId,
                title: u.title ?? "Tool call",
                toolKind: u.kind ?? undefined,
                status: u.status ?? "pending",
                content: u.content ?? [],
                locations: u.locations ?? [],
                rawInput: u.rawInput,
              })
              break
            }
            items[i] = {
              ...prev,
              title: u.title ?? prev.title,
              toolKind: u.kind ?? prev.toolKind,
              status: u.status ?? prev.status,
              content: u.content ?? prev.content,
              locations: u.locations ?? prev.locations,
              rawInput: u.rawInput ?? prev.rawInput,
            }
            break
          }
          case "plan":
            setPlan(u.entries, undefined, id)
            break
          case "plan_update":
            if (u.plan.type === "items") setPlan(u.plan.entries, undefined, id)
            else if (u.plan.type === "markdown") setPlan([], u.plan.content, id)
            break
          case "plan_removed":
            items = items.filter(item => item.kind !== "plan")
            break
          case "config_option_update":
            config = { ...config, configOptions: u.configOptions }
            break
          case "current_mode_update":
            if (config.modes) config = { ...config, modes: { ...config.modes, currentModeId: u.currentModeId } }
            break
          case "usage_update":
            config = { ...config, usage: { used: u.used, size: u.size } }
            break
          case "notice":
            items.push({ kind: "notice", id, severity: u.severity, title: u.title, description: u.description ?? undefined })
            break
          default:
            break
        }
        break
      }
    }
  }
  return { items, state, config, lastSeq }
}

export function applyEvent(t: Transcript, event: AcpEvent, seq: number): Transcript {
  return applyEvents(t, [{ seq, event }])
}

// Tool kinds that change files in the working tree.
export function touchesFiles(kind: ToolKind | null | undefined): boolean {
  return kind === "edit" || kind === "delete" || kind === "move"
}

// An agent path (absolute, or relative to the repo) as a repo-relative
// path, or null when it's outside the repo.
export function repoRelative(repo: string, filePath: string): string | null {
  const root = repo.replace(/\/+$/, "")
  let rel: string
  if (filePath.startsWith("/")) {
    if (!filePath.startsWith(root + "/")) return null
    rel = filePath.slice(root.length + 1)
  } else {
    rel = filePath.replace(/^\.\//, "")
  }
  if (!rel || rel.split("/").includes("..")) return null
  return rel
}
