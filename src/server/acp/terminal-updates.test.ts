import { describe, expect, it } from "vitest"
import type { SessionUpdate } from "@agentclientprotocol/sdk"
import { terminalPatches } from "./terminal-updates"

// pi-acp 0.33 sends these exact shapes (verified on its dist):
const piToolCall = {
  sessionUpdate: "tool_call",
  toolCallId: "f",
  title: "echo hi",
  kind: "execute",
  status: "in_progress",
  content: [{ type: "terminal", terminalId: "f" }],
  _meta: { terminal_info: { terminal_id: "f", cwd: "/repo" } },
} as unknown as SessionUpdate

const piOutputUpdate = {
  sessionUpdate: "tool_call_update",
  toolCallId: "f",
  status: "in_progress",
  _meta: { terminal_output: { terminal_id: "f", data: "hi\n" } },
} as unknown as SessionUpdate

const piExitUpdate = {
  sessionUpdate: "tool_call_update",
  toolCallId: "f",
  status: "completed",
  _meta: {
    terminal_output: { terminal_id: "f", data: "bye\n" },
    terminal_exit: { terminal_id: "f", exit_code: 3, signal: null },
  },
} as unknown as SessionUpdate

// claude-agent-acp's delta variant: base64 output on the completion update
const claudeUpdate = {
  sessionUpdate: "tool_call_update",
  toolCallId: "b1",
  status: "completed",
  content: [{ type: "terminal", terminalId: "b1" }],
  _meta: {
    terminal_info: { terminal_id: "b1" },
    terminal_output_delta: { terminal_id: "b1", data: "Y2xlaQ==" },
    terminal_exit: { terminal_id: "b1", exit_code: 0, signal: null },
  },
} as unknown as SessionUpdate

// v2 RFD shapes (no released SDK types yet; matched loosely)
const v2Update = {
  sessionUpdate: "terminal_update",
  terminalId: "v2-1",
  command: "cargo test",
  cwd: "/w",
  output: { data: "cnVubmluZw==" },
  exitStatus: { exitCode: 0, signal: null },
} as unknown as SessionUpdate

const v2Chunk = {
  sessionUpdate: "terminal_output_chunk",
  terminalId: "v2-1",
  data: "IG9r",
} as unknown as SessionUpdate

describe("terminalPatches (v1 metas)", () => {
  it("reads terminal_info, output and exit from tool call updates", () => {
    expect(terminalPatches(piToolCall)).toEqual([{ id: "f", command: undefined, cwd: "/repo" }])
    expect(terminalPatches(piOutputUpdate)).toEqual([{ id: "f", text: "hi\n" }])
    expect(terminalPatches(piExitUpdate)).toEqual([{ id: "f", text: "bye\n", exit: { exitCode: 3, signal: null } }])
  })

  it("merges meta patches for the same terminal in one update", () => {
    const both = {
      sessionUpdate: "tool_call",
      toolCallId: "x",
      title: "echo both",
      _meta: {
        terminal_info: { terminal_id: "x", cwd: "/r" },
        terminal_output: { terminal_id: "x", data: "out" },
      },
    } as unknown as SessionUpdate
    // The command backfill from the title happens in registry.handleSessionUpdate
    expect(terminalPatches(both)).toEqual([{ id: "x", cwd: "/r", text: "out" }])
  })

  it("reads claude's base64 terminal_output_delta", () => {
    expect(terminalPatches(claudeUpdate)).toEqual([{ id: "b1", cwd: undefined, command: undefined, text: "clei", exit: { exitCode: 0, signal: null } }])
  })

  it("ignores updates without terminal metas", () => {
    expect(terminalPatches({ sessionUpdate: "tool_call", toolCallId: "t", title: "Read" } as unknown as SessionUpdate)).toEqual([])
    const otherMeta = { sessionUpdate: "tool_call", toolCallId: "t", _meta: { claudeCode: { a: 1 } } } as unknown as SessionUpdate
    expect(terminalPatches(otherMeta)).toEqual([])
  })
})

describe("terminalPatches (v2 loose shapes)", () => {
  it("parses terminal_update as command + snapshot + exit", () => {
    expect(terminalPatches(v2Update)).toEqual([
      { id: "v2-1", command: "cargo test", cwd: "/w", replace: true, text: "running", exit: { exitCode: 0, signal: null } },
    ])
  })

  it("parses terminal_output_chunk", () => {
    expect(terminalPatches(v2Chunk)).toEqual([{ id: "v2-1", text: " ok" }])
  })

  it("treats a null output snapshot as no bytes, not a merge", () => {
    const clear = { sessionUpdate: "terminal_update", terminalId: "v", output: { data: "" } } as unknown as SessionUpdate
    expect(terminalPatches(clear)).toEqual([{ id: "v", replace: true, text: "" }])
  })

  it("skips v2 updates without a terminalId", () => {
    expect(terminalPatches({ sessionUpdate: "terminal_output_chunk", data: "aGk=" } as unknown as SessionUpdate)).toEqual([])
  })
})