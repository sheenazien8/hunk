import { describe, expect, it } from "vitest"
import type { TerminalPatch } from "@/lib/acp/terminal"
import { TERMINAL_MAX_BYTES } from "@/lib/acp/terminal"
import type { AcpEvent, SeqEvent } from "@/lib/acp/types"
import { AgentSession } from "./session"

describe("AgentSession image budget", () => {
  it("caps image payloads across logged and live events", () => {
    const session = new AgentSession("id", "agent", "/repo")
    const streamed: SeqEvent[] = []
    session.subscribe(event => streamed.push(event), () => {})
    const data = "A".repeat(5 * 1024 * 1024)

    for (let i = 0; i < 3; i++) {
      session.push({
        type: "update",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "image", data, mimeType: "image/png" } },
      })
    }
    session.push({
      type: "update",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "image", data: "B".repeat(2 * 1024 * 1024), mimeType: "image/png" } },
    })

    const replay = session.since(0).events
    expect(streamed).toEqual(replay)
    expect(replay.slice(0, 3).every(({ event }) =>
      event.type === "update" && event.update.sessionUpdate === "agent_message_chunk" && event.update.content.type === "image",
    )).toBe(true)
    const capped = replay[3].event as Extract<AcpEvent, { type: "update" }>
    expect(capped.update).toMatchObject({
      content: { type: "text", text: expect.stringContaining("session image budget exceeded") },
    })
  })
})

const session = () => new AgentSession("s1", "fake", "/repo")

const snapshotEvents = (s: AgentSession) => s.since(0).events.filter((e): e is { seq: number; event: Extract<AcpEvent, { type: "terminal_snapshot" }> } => e.event.type === "terminal_snapshot")

describe("AgentSession.trackTerminal", () => {
  it("accumulates output per terminal id and logs a snapshot per patch", () => {
    const s = session()
    s.trackTerminal({ id: "t1", command: "ls", cwd: "/r" })
    s.trackTerminal({ id: "t1", text: "aa\n" })
    s.trackTerminal({ id: "t1", text: "bb\n", exit: { exitCode: 0, signal: null } })
    const snapshots = snapshotEvents(s)
    expect(snapshots.map(e => e.event.terminal.text)).toEqual(["", "aa\n", "aa\nbb\n"])
    expect(snapshots.at(-1)!.event.terminal.exit).toEqual({ exitCode: 0, signal: null })
    expect(snapshots[0].event.terminal.cwd).toBe("/r")
    expect(s.terminals.get("t1")!.text).toBe("aa\nbb\n")
  })

  it("restarts the buffer when a new command arrives (agent reuses ids)", () => {
    const s = session()
    s.trackTerminal({ id: "t", command: "one", text: "old" })
    s.trackTerminal({ id: "t", command: "two", text: "new" })
    expect(s.terminals.get("t")!.text).toBe("new")
  })

  it("a replacement snapshot replaces, not appends", () => {
    const s = session()
    s.trackTerminal({ id: "t", text: "first" })
    s.trackTerminal({ id: "t", text: "second", replace: true })
    expect(s.terminals.get("t")!.text).toBe("second")
  })

  it("keeps the last bytes inside the limit", () => {
    const s = session()
    s.trackTerminal({ id: "t", text: "x".repeat(TERMINAL_MAX_BYTES + 10) })
    expect(s.terminals.get("t")!.text).toHaveLength(TERMINAL_MAX_BYTES)
  })

  it("ignores patches without an id", () => {
    const s = session()
    s.trackTerminal({ id: "", text: "x" } as unknown as TerminalPatch)
    expect(s.terminals.size).toBe(0)
    expect(snapshotEvents(s)).toEqual([])
  })

  it("clearing a command without new text keeps the output", () => {
    const s = session()
    s.trackTerminal({ id: "t", command: "ls", text: "out" })
    s.trackTerminal({ id: "t", command: null })
    expect(s.terminals.get("t")).toMatchObject({ command: null, text: "out" })
  })
})
