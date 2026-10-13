import type { SessionUpdate } from "@agentclientprotocol/sdk"
import { decodeTerminalBase64, decodeTerminalChunk, type TerminalPatch } from "@/lib/acp/terminal"

// Terminal wire forms, folded into one buffer per terminal id by the session:
//
// - v1 metas (pi-acp, claude-agent-acp): `tool_call`/`tool_call_update` with
//   `_meta.terminal_info` ({terminal_id, cwd}), `_meta.terminal_output`
//   (plain-text delta) and `_meta.terminal_exit` ({terminal_id, exit_code,
//   signal}). claude also sends `_meta.terminal_output_delta` (base64).
//   Both adapters' `terminal_info` carries no command — the tool call's
//   title does — so `command` is only set when the meta itself has one and
//   the caller may backfill it otherwise.
// - v2 (RFD, agentclientprotocol.com/rfds/v2/terminal-output.md):
//   `terminal_update` (command/cwd/output snapshot/exitStatus) and
//   `terminal_output_chunk` (base64 bytes) as their own session updates.
//   Not in any released SDK yet; matched loosely so newer agents parse, and
//   unit-tested here since SDK 1.5's zod validation drops such notifications
//   in transport.
//
// Every form is display-only: the agent runs the command, Hunk renders it.
// One update yields at most one patch per terminal id (its fields merged).

export function terminalPatches(u: SessionUpdate): TerminalPatch[] {
  const byId = new Map<string, TerminalPatch>()
  const patchFor = (id: string): TerminalPatch => {
    let p = byId.get(id)
    if (!p) byId.set(id, (p = { id }))
    return p
  }

  // v1 tool-call metas
  const meta = record((u as { _meta?: unknown })._meta)
  if (meta) {
    const info = record(meta["terminal_info"])
    if (info) {
      const id = metaId(info)
      if (id) {
        const p = patchFor(id)
        // command only when the meta really reports one (keep-prev otherwise)
        if (typeof info["command"] === "string") p.command = info["command"]
        const cwd = str(info["cwd"])
        if (cwd !== undefined) p.cwd = cwd
      }
    }

    // claude's delta-first variant (base64), then pi's plain-text output
    const delta = record(meta["terminal_output_delta"])
    if (delta) {
      const id = metaId(delta)
      const data = str(delta["data"])
      if (id && data != null) patchFor(id).text = decodeTerminalBase64(data)
    }
    const output = record(meta["terminal_output"])
    if (output) {
      const id = metaId(output)
      const data = str(output["data"])
      if (id && data) {
        // both forms in one update are the same bytes stream
        const p = patchFor(id)
        p.text = (p.text ?? "") + data
      }
    }

    const exit = record(meta["terminal_exit"])
    if (exit) {
      const id = metaId(exit)
      if (id) {
        const code = exit["exit_code"] ?? exit["exitCode"]
        patchFor(id).exit = { exitCode: typeof code === "number" ? code : null, signal: str(exit["signal"]) ?? null }
      }
    }
  }

  // v2 loose shapes, matched by the literal update kind
  const kind = (u as { sessionUpdate?: unknown }).sessionUpdate
  const rawId = (u as { terminalId?: unknown }).terminalId
  const id0 = typeof rawId === "string" ? rawId : undefined
  if (id0) {
    const p = patchFor(id0)
    if (kind === "terminal_update") {
      const command = str((u as { command?: unknown }).command)
      if (command !== undefined) p.command = command
      const cwd = str((u as { cwd?: unknown }).cwd)
      if (cwd !== undefined) p.cwd = cwd
      const snapshot = record((u as { output?: unknown }).output)
      const data = snapshot ? str(snapshot["data"]) : undefined
      if (data != null) {
        p.replace = true
        p.text = decodeTerminalChunk(data, true)
      }
      const exitStatus = record((u as { exitStatus?: unknown }).exitStatus)
      if (exitStatus) {
        p.exit = {
          exitCode: typeof exitStatus["exitCode"] === "number" ? exitStatus["exitCode"] : null,
          signal: str(exitStatus["signal"]) ?? null,
        }
      }
    } else if (kind === "terminal_output_chunk") {
      const data = str((u as { data?: unknown }).data)
      if (data != null) p.text = decodeTerminalChunk(data, true)
    }
  }

  return [...byId.values()]
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

// `_meta.terminal_*` objects spell the id `terminal_id` (pi and claude both
// do); `terminalId` is accepted for hand-rolled agents.
function metaId(o: Record<string, unknown>): string | undefined {
  return str(o["terminal_id"]) ?? str(o["terminalId"])
}