import type { PermissionOption, SessionConfigOption, SessionModeState, SessionUpdate, StopReason, ToolCallUpdate } from "@agentclientprotocol/sdk"

// API contract for /api/acp/* — shared by the routes and the client.

export interface AgentInfo {
  id: string
  name: string
}

export interface AgentsResponse {
  agents: AgentInfo[]
}

// What the agent lets the user change for a session (model, thinking level,
// mode, …) plus how full its context is. `configOptions` is the generic ACP
// form; `modes` is the older mode list some agents also (or only) send.
export interface SessionConfig {
  configOptions: SessionConfigOption[]
  modes: SessionModeState | null
  usage: { used: number; size: number } | null
}

export interface SessionState {
  title: string
  busy: boolean
  autoApprove: boolean
  connected: boolean
}

// A `!` / `!!` command run from the prompt box: the real process output,
// last SHELL_MAX_LINES lines (stdout and stderr interleaved).
export interface ShellResult {
  command: string
  lines: string[]
  // Earlier lines that were cut
  dropped: number
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  durationMs: number
}

// What the server appends to a session's event log and streams over SSE.
// `reset` is stream-only: it tells the client to drop what it has because
// the replay that follows starts from the beginning of the buffer.
export type AcpEvent =
  | { type: "update"; update: SessionUpdate }
  | { type: "user_prompt"; text: string }
  | { type: "permission_request"; requestId: string; toolCall: ToolCallUpdate; options: PermissionOption[] }
  | { type: "permission_resolved"; requestId: string; optionId: string | null; auto: boolean }
  | { type: "turn_end"; stopReason: StopReason | "error" }
  | { type: "error"; message: string }
  | { type: "state"; state: SessionState }
  // Full config snapshot: after new/load, after a change, and first thing
  // after a stream reset (so it survives the event buffer rolling over).
  // Later agent-side changes also arrive as config_option_update /
  // current_mode_update / usage_update updates.
  | { type: "config"; config: SessionConfig }
  | { type: "reset" }
  // `!` / `!!` commands. `share` = the result goes to the agent with the
  // next prompt. shell_output is a snapshot of the output so far, sent live
  // only (never logged; reconnecting clients get the next one).
  | { type: "shell_start"; shellId: string; command: string; share: boolean }
  | { type: "shell_output"; shellId: string; lines: string[]; dropped: number }
  | { type: "shell_end"; shellId: string; result: ShellResult }

export interface SeqEvent {
  seq: number
  event: AcpEvent
}

export interface AgentSessionSummary {
  sessionId: string
  agentId: string
  title: string
  // true = attached in the server right now; false = only known to the
  // agent (session/list) and has to be resumed first.
  live: boolean
  busy: boolean
  updatedAt?: string
}

// `scope=live`: sessions attached in the server (instant, never starts the
// agent). Otherwise one page of past sessions the agent remembers, minus the
// live ones; pass `nextCursor` back to get the next page (null = done).
export interface SessionsResponse {
  sessions: AgentSessionSummary[]
  nextCursor: string | null
}

export interface OpenSessionRequest {
  repo: string
  agent: string
  resumeId?: string
}

export interface OpenSessionResponse {
  sessionId: string
}

export type AcpAction =
  // `files`: repo-relative paths mentioned with @, sent as resource links
  | { action: "prompt"; text: string; files?: string[] }
  | { action: "cancel" }
  | { action: "permission"; requestId: string; optionId: string | null }
  | { action: "autoApprove"; enabled: boolean }
  | { action: "setConfig"; configId: string; value: string | boolean }
  | { action: "setMode"; modeId: string }
  | { action: "close" }
  // Runs `command` in the session's repo; share = !, private = !!
  | { action: "shell"; command: string; share?: boolean }
  | { action: "shellStop"; shellId: string }

export type AcpActionRequest = AcpAction & { sessionId: string }
