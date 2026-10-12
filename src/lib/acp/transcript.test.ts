import { describe, expect, it } from "vitest"
import { autoApproveOption } from "./permissions"
import { applyEvents, emptyTranscript, repoRelative, summarizeAnswer, type ChatItem } from "./transcript"
import type { AcpEvent, SeqEvent } from "./types"

const seq = (events: AcpEvent[], from = 1): SeqEvent[] => events.map((event, i) => ({ seq: from + i, event }))
const chunk = (kind: "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk", text: string): AcpEvent =>
  ({ type: "update", update: { sessionUpdate: kind, content: { type: "text", text } } })

function run(events: AcpEvent[]): ChatItem[] {
  return applyEvents(emptyTranscript(), seq(events)).items
}

describe("applyEvents", () => {
  it("merges consecutive chunks of the same kind", () => {
    const items = run([
      { type: "user_prompt", text: "hi" },
      chunk("agent_thought_chunk", "hmm "),
      chunk("agent_thought_chunk", "ok"),
      chunk("agent_message_chunk", "Hel"),
      chunk("agent_message_chunk", "lo"),
    ])
    expect(items.map(i => [i.kind, "text" in i ? i.text : ""])).toEqual([
      ["user", "hi"],
      ["thought", "hmm ok"],
      ["agent", "Hello"],
    ])
  })

  it("keeps images as images in every message kind, never \"[image]\"", () => {
    const img = { data: "AAAA", mimeType: "image/png" }
    const image = (kind: "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk"): AcpEvent =>
      ({ type: "update", update: { sessionUpdate: kind, content: { type: "image", ...img } } })
    for (const [update, kind] of [["agent_message_chunk", "agent"], ["agent_thought_chunk", "thought"], ["user_message_chunk", "user"]] as const) {
      expect(run([image(update)])).toEqual([{ kind, id: "e1", text: "", images: [img] }])
    }
    expect(JSON.stringify(run([image("agent_message_chunk")]))).not.toContain("[image]")
  })

  it("doesn't merge text across an image", () => {
    const img = { data: "AAAA", mimeType: "image/png" }
    const items = run([
      chunk("agent_message_chunk", "Here "),
      chunk("agent_message_chunk", "it is:"),
      { type: "update", update: { sessionUpdate: "agent_message_chunk", content: { type: "image", ...img } } },
      { type: "update", update: { sessionUpdate: "agent_message_chunk", content: { type: "image", ...img } } },
      chunk("agent_message_chunk", "Done"),
    ])
    expect(items.map(i => ("text" in i ? [i.text, i.images?.length ?? 0] : null))).toEqual([["Here it is:", 2], ["Done", 0]])
  })

  it("shows images sent with a prompt", () => {
    const images = [{ data: "AAAA", mimeType: "image/jpeg" }]
    expect(run([{ type: "user_prompt", text: "look", images }])[0]).toEqual({ kind: "user", id: "e1", text: "look", images })
  })

  it("upserts tool calls and keeps their position", () => {
    const items = run([
      { type: "update", update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read", kind: "read", status: "pending" } },
      chunk("agent_message_chunk", "text"),
      { type: "update", update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" } },
    ])
    expect(items[0]).toMatchObject({ kind: "tool", toolCallId: "t1", title: "Read", toolKind: "read", status: "completed" })
    expect(items).toHaveLength(2)
  })

  it("keeps a single plan at the end", () => {
    const entry = (content: string) => ({ content, priority: "medium" as const, status: "pending" as const })
    const items = run([
      { type: "update", update: { sessionUpdate: "plan", entries: [entry("a")] } },
      chunk("agent_message_chunk", "x"),
      { type: "update", update: { sessionUpdate: "plan", entries: [entry("a"), entry("b")] } },
    ])
    expect(items.map(i => i.kind)).toEqual(["agent", "plan"])
    expect(items[1]).toMatchObject({ entries: [{ content: "a" }, { content: "b" }] })
  })

  it("tracks permission requests", () => {
    const request: AcpEvent = { type: "permission_request", requestId: "r1", toolCall: { toolCallId: "t1", title: "Run ls" }, options: [] }
    expect(run([request])[0]).toMatchObject({ kind: "permission", status: "pending", title: "Run ls" })
    expect(run([request, { type: "permission_resolved", requestId: "r1", optionId: "y", auto: false }])[0]).toMatchObject({ status: "answered", optionId: "y" })
    expect(run([request, { type: "permission_resolved", requestId: "r1", optionId: "y", auto: true }])[0]).toMatchObject({ status: "auto" })
    expect(run([request, { type: "permission_resolved", requestId: "r1", optionId: null, auto: false }])[0]).toMatchObject({ status: "cancelled" })
  })

  it("reset drops everything before it", () => {
    const t = applyEvents(emptyTranscript(), seq([{ type: "user_prompt", text: "old" }]))
    const next = applyEvents(t, [{ seq: 0, event: { type: "reset" } }, ...seq([{ type: "user_prompt", text: "new" }])])
    expect(next.items.map(i => ("text" in i ? i.text : ""))).toEqual(["new"])
    expect(next.lastSeq).toBe(1)
  })

  it("does not mutate the previous transcript", () => {
    const t = applyEvents(emptyTranscript(), seq([chunk("agent_message_chunk", "a")]))
    const before = t.items[0]
    applyEvents(t, seq([chunk("agent_message_chunk", "b")], 2))
    expect(t.items[0]).toBe(before)
    expect((before as { text: string }).text).toBe("a")
  })

  it("tracks agent config from snapshots and updates", () => {
    const model = { type: "select" as const, id: "model", name: "Model", category: "model", currentValue: "a", options: [{ value: "a", name: "A" }, { value: "b", name: "B" }] }
    const modes = { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }, { id: "code", name: "Code" }] }
    const t = applyEvents(emptyTranscript(), seq([
      { type: "config", config: { configOptions: [model], modes, usage: null } },
      { type: "update", update: { sessionUpdate: "config_option_update", configOptions: [{ ...model, currentValue: "b" }] } },
      { type: "update", update: { sessionUpdate: "current_mode_update", currentModeId: "code" } },
      { type: "update", update: { sessionUpdate: "usage_update", used: 10, size: 100 } },
    ]))
    expect(t.config.configOptions[0]).toMatchObject({ currentValue: "b" })
    expect(t.config.modes?.currentModeId).toBe("code")
    expect(t.config.usage).toEqual({ used: 10, size: 100 })
    expect(applyEvents(t, [{ seq: 0, event: { type: "reset" } }]).config).toEqual(emptyTranscript().config)
  })

  it("stores the latest state", () => {
    const state = { title: "T", busy: true, autoApprove: false, connected: true, images: false }
    expect(applyEvents(emptyTranscript(), seq([{ type: "state", state }])).state).toEqual(state)
  })

  it("tracks elicitation requests", () => {
    const request: AcpEvent = {
      type: "elicitation_request",
      elicitId: "e1",
      sessionId: "s1",
      toolCallId: null,
      message: "Pick one",
      requestedSchema: {
        type: "object",
        properties: {
          question_0: {
            type: "string",
            oneOf: [{ const: "A", title: "A" }],
          },
          question_0_custom: {
            type: "string",
            _meta: { _askUserQuestionCustomAnswer: { questionId: "question_0", isCustomAnswer: true } },
          },
        },
      },
    }
    const items = run([request])
    const q = items[0]
    expect(q).toMatchObject({ kind: "question", status: "pending", message: "Pick one" })
    expect((q as { fields?: unknown }).fields).toEqual([
      { key: "question_0", type: "single", title: undefined, description: undefined, options: [{ value: "A", title: "A" }], min: undefined, max: undefined, custom: false, customKey: "question_0_custom" },
    ])
    const answered = run([request, { type: "elicitation_resolved", elicitId: "e1", action: "accept", content: { question_0: "A" } }])
    expect((answered[0] as { status: string }).status).toBe("answered")
    expect((answered[0] as { content?: unknown }).content).toEqual({ question_0: "A" })
    expect((run([request, { type: "elicitation_resolved", elicitId: "e1", action: "decline", content: undefined }])[0] as { status: string }).status).toBe("skipped")
    expect((run([request, { type: "elicitation_resolved", elicitId: "e1", action: "cancel", content: undefined }])[0] as { status: string }).status).toBe("cancelled")
  })

  it("summarizes question answers", () => {
    expect(summarizeAnswer({ key: "q", type: "single", options: [], customKey: "q_custom" }, { q: "A", q_custom: "note" })).toBe("note")
    expect(summarizeAnswer({ key: "q", type: "multi", options: [] }, { q: ["A", "B"] })).toBe("A, B")
    expect(summarizeAnswer({ key: "q", type: "boolean", options: [] }, { q: true })).toBe("Yes")
    expect(summarizeAnswer({ key: "q", type: "text", options: [] }, { q: "hi" })).toBe("hi")
    expect(summarizeAnswer({ key: "q", type: "number", options: [] }, { q: 42 })).toBe("42")
  })
})

describe("autoApproveOption", () => {
  const opt = (optionId: string, kind: "allow_once" | "allow_always" | "reject_once" | "reject_always") => ({ optionId, name: optionId, kind })

  it("prefers allow_once, then allow_always", () => {
    expect(autoApproveOption([opt("a", "allow_always"), opt("o", "allow_once")])?.optionId).toBe("o")
    expect(autoApproveOption([opt("r", "reject_once"), opt("a", "allow_always")])?.optionId).toBe("a")
  })

  it("returns null without an allow option", () => {
    expect(autoApproveOption([opt("r", "reject_once")])).toBeNull()
  })
})

describe("repoRelative", () => {
  it("strips the repo prefix", () => {
    expect(repoRelative("/r/repo", "/r/repo/src/a.ts")).toBe("src/a.ts")
    expect(repoRelative("/r/repo/", "/r/repo/a")).toBe("a")
  })

  it("rejects paths outside the repo", () => {
    expect(repoRelative("/r/repo", "/r/repo2/a")).toBeNull()
    expect(repoRelative("/r/repo", "/r/repo")).toBeNull()
    expect(repoRelative("/r/repo", "../other/a")).toBeNull()
  })

  it("accepts paths relative to the repo", () => {
    expect(repoRelative("/r/repo", "smoke.txt")).toBe("smoke.txt")
    expect(repoRelative("/r/repo", "./src/a.ts")).toBe("src/a.ts")
  })
})

describe("shell items", () => {
  const result = { command: "ls", lines: ["a", "b"], dropped: 3, exitCode: 0, signal: null, timedOut: false, durationMs: 5 }

  it("follows a command from start to end", () => {
    let t = applyEvents(emptyTranscript(), seq([{ type: "shell_start", shellId: "x", command: "ls", share: false }]))
    expect(t.items).toEqual([{ kind: "shell", id: "e1", shellId: "x", command: "ls", share: false, lines: [], dropped: 0, result: null }])
    t = applyEvents(t, seq([{ type: "shell_output", shellId: "x", lines: ["a"], dropped: 0 }], 1))
    expect(t.items[0]).toMatchObject({ lines: ["a"], result: null })
    t = applyEvents(t, seq([{ type: "shell_end", shellId: "x", result }], 2))
    expect(t.items[0]).toMatchObject({ lines: ["a", "b"], dropped: 3, result })
  })

  it("ignores output that arrives after the end", () => {
    const items = run([
      { type: "shell_start", shellId: "x", command: "ls", share: true },
      { type: "shell_end", shellId: "x", result },
      { type: "shell_output", shellId: "x", lines: ["late"], dropped: 0 },
    ])
    expect(items[0]).toMatchObject({ lines: ["a", "b"] })
  })
})
