import type {
  ElicitationContentValue,
  ElicitationSchema,
  PermissionOption,
  SessionConfigOption,
  SessionModeState,
  SessionUpdate,
  StopReason,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk"
import type { ChatImage } from "./images"

export type ElicitationAnswer = string | string[] | number | boolean | null

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
  // The agent accepts image prompts (promptCapabilities.image)
  images: boolean
}

// An agent-owned command output (the agent runs it, Hunk only displays it).
// Identified by the terminalId of the tool call's `terminal` content; the
// text is the last chunk of output (decoded, ANSI kept), cut to 64 KB.
export interface TerminalSnapshot {
  terminalId: string
  // The command being run, when the agent reported one
  command: string | null
  // Working directory of the command, when reported (absolute)
  cwd: string | null
  text: string
  // true = the command exited
  exit: { exitCode: number | null; signal: string | null } | null
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
  | { type: "user_prompt"; text: string; images?: ChatImage[] }
  | { type: "permission_request"; requestId: string; toolCall: ToolCallUpdate; options: PermissionOption[] }
  | { type: "permission_resolved"; requestId: string; optionId: string | null; auto: boolean }
  | {
      type: "elicitation_request"
      elicitId: string
      sessionId: string
      toolCallId: string | null
      message: string
      requestedSchema: ElicitationSchema
    }
  | {
      type: "elicitation_resolved"
      elicitId: string
      action: "accept" | "decline" | "cancel"
      content: Record<string, ElicitationContentValue> | undefined
    }
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
  // Latest known output of an agent terminal (one event per output update,
  // replacing the previous snapshot for that terminalId in the transcript).
  | { type: "terminal_snapshot"; terminal: TerminalSnapshot }

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
  // `files`: repo-relative paths mentioned with @, sent as resource links;
  // `images`: attached images, sent as image blocks
  | { action: "prompt"; text: string; files?: string[]; images?: ChatImage[] }
  | { action: "cancel" }
  | { action: "permission"; requestId: string; optionId: string | null }
  | {
      action: "elicitation"
      elicitId: string
      response: "accept" | "decline" | "cancel"
      answers?: Record<string, ElicitationAnswer>
    }
  | { action: "autoApprove"; enabled: boolean }
  | { action: "setConfig"; configId: string; value: string | boolean }
  | { action: "setMode"; modeId: string }
  | { action: "close" }
  // Runs `command` in the session's repo; share = !, private = !!
  | { action: "shell"; command: string; share?: boolean }
  | { action: "shellStop"; shellId: string }

export type AcpActionRequest = AcpAction & { sessionId: string }
