#!/usr/bin/env node
// Minimal ACP agent over stdio for tests. Behaviour depends on the prompt:
//   "hello"  streams two chunks        "edit"  tool call + permission request
//   "wait"   runs until cancelled      "crash" exits the process
//   "bash"   tool call with pi-style terminal metas + streamed output
//   ...+"echo" (last text block) replies with the earlier text blocks
//   "image"  replies with each image block it got, then a screenshot
//   "huge"   replies with an image too large to keep
// A repo dir named "noimg" (or FAKE_NO_IMAGES=1) gets an agent without image prompts.
import { Readable, Writable } from "node:stream"
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"

let nextId = 1
const running = new Map()
// Per-session settings: a model select, a boolean, and a legacy mode list.
const settings = new Map()

function configOptions(s) {
  return [
    { type: "select", id: "model", name: "Model", category: "model", currentValue: s.model, options: [{ value: "small", name: "Small" }, { value: "big", name: "Big" }] },
    { type: "boolean", id: "fast", name: "Fast", currentValue: s.fast },
  ]
}

const MODES = [{ id: "ask", name: "Ask" }, { id: "code", name: "Code" }]
// 1x1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="

const agent = conn => ({
  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} }, promptCapabilities: { image: !process.cwd().endsWith("/noimg") && !process.env.FAKE_NO_IMAGES } },
    }
  },
  async authenticate() {
    return {}
  },
  async newSession() {
    const sessionId = `s${nextId++}`
    const s = { model: "small", fast: false, mode: "ask" }
    settings.set(sessionId, s)
    return { sessionId, configOptions: configOptions(s), modes: { currentModeId: s.mode, availableModes: MODES } }
  },
  async setSessionConfigOption({ sessionId, configId, value }) {
    const s = settings.get(sessionId)
    if (configId === "model") s.model = value
    else if (configId === "fast") s.fast = value
    else throw new Error(`unknown config ${configId}`)
    return { configOptions: configOptions(s) }
  },
  async setSessionMode({ sessionId, modeId }) {
    settings.get(sessionId).mode = modeId
    return {}
  },
  // A repo dir named "many" has 45 sessions, paged 20 at a time.
  async listSessions({ cwd, cursor }) {
    if (!cwd.endsWith("/many")) return { sessions: [{ sessionId: "old-1", cwd, title: "Old session" }] }
    const start = Number(cursor ?? 0)
    const all = Array.from({ length: 45 }, (_, i) => ({ sessionId: `m${i}`, cwd, title: `Session ${i}` }))
    const end = start + 20
    return { sessions: all.slice(start, end), nextCursor: end < all.length ? String(end) : null }
  },
  async loadSession({ sessionId }) {
    const update = (u) => conn.sessionUpdate({ sessionId, update: u })
    await update({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "earlier question" } })
    await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "earlier answer" } })
    return {}
  },
  async prompt({ sessionId, prompt }) {
    const text = prompt.map(b => b.text ?? "").join("")
    const update = (u) => conn.sessionUpdate({ sessionId, update: u })
    if (text === "crash") process.exit(3)
    const texts = prompt.filter(b => b.type === "text").map(b => b.text)
    if (texts.at(-1) === "echo") {
      await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: texts.slice(0, -1).join("\n---\n") } })
      return { stopReason: "end_turn" }
    }
    if (texts.at(-1) === "image") {
      for (const b of prompt.filter(b => b.type === "image")) {
        await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `got ${b.mimeType} ${b.data.length}` } })
      }
      await update({ sessionUpdate: "agent_message_chunk", content: { type: "image", mimeType: "image/png", data: PNG } })
      return { stopReason: "end_turn" }
    }
    if (text === "huge") {
      await update({ sessionUpdate: "agent_message_chunk", content: { type: "image", mimeType: "image/png", data: "A".repeat(8 * 1024 * 1024) } })
      return { stopReason: "end_turn" }
    }
    if (text === "wait") {
      return new Promise(resolve => running.set(sessionId, () => resolve({ stopReason: "cancelled" })))
    }
    if (text === "bash") {
      // pi-style bash: terminal content + metas on the tool call, output
      // deltas on updates, exit on the last one.
      const t = "bash-1"
      await update({
        sessionUpdate: "tool_call",
        toolCallId: t,
        title: "echo hello",
        kind: "execute",
        status: "in_progress",
        content: [{ type: "terminal", terminalId: t }],
        _meta: { terminal_info: { terminal_id: t, cwd: process.cwd() } },
      })
      await update({
        sessionUpdate: "tool_call_update",
        toolCallId: t,
        status: "in_progress",
        _meta: { terminal_output: { terminal_id: t, data: "hello\n" } },
      })
      await update({
        sessionUpdate: "tool_call_update",
        toolCallId: t,
        status: "completed",
        _meta: {
          terminal_output: { terminal_id: t, data: "world\n" },
          terminal_exit: { terminal_id: t, exit_code: 0, signal: null },
        },
      })
      return { stopReason: "end_turn" }
    }
    if (text === "v2terminal") {
      // v2 RFD shapes, which the SDK schema does not know yet: sent as raw
      // JSON-RPC notifications so newer agents are covered too.
      const notify = (p) => {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: p } }) + "\n")
      }
      notify({ sessionUpdate: "terminal_update", terminalId: "v2-1", command: "cargo test", cwd: process.cwd() })
      notify({ sessionUpdate: "terminal_output_chunk", terminalId: "v2-1", data: Buffer.from("passed\n").toString("base64") })
      notify({
        sessionUpdate: "terminal_update",
        terminalId: "v2-1",
        exitStatus: { exitCode: 0, signal: null },
      })
      await update({ sessionUpdate: "tool_call", toolCallId: "v2-call", title: "cargo test", kind: "execute", status: "completed", content: [{ type: "terminal", terminalId: "v2-1" }] })
      return { stopReason: "end_turn" }
    }
    if (text === "edit") {
      const toolCall = {
        toolCallId: "t1",
        title: "Edit a.txt",
        kind: "edit",
        status: "pending",
        content: [{ type: "diff", path: `${process.cwd()}/a.txt`, oldText: "one\n", newText: "two\n" }],
      }
      await update({ sessionUpdate: "tool_call", ...toolCall })
      const res = await conn.requestPermission({
        sessionId,
        toolCall,
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ],
      })
      const ok = res.outcome.outcome === "selected" && res.outcome.optionId === "yes"
      await update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: ok ? "completed" : "failed" })
      return { stopReason: "end_turn" }
    }
    if (text === "question") {
      const toolCall = {
        toolCallId: "q1",
        title: "Ask a question",
        kind: "other",
        status: "pending",
      }
      await update({ sessionUpdate: "tool_call", ...toolCall })
      const res = await conn.createElicitation({
        mode: "form",
        sessionId,
        toolCallId: "q1",
        message: "What is your favorite color?",
        requestedSchema: {
          type: "object",
          properties: {
            question_0: {
              type: "string",
              title: "Color",
              oneOf: [
                { const: "Red", title: "Red" },
                { const: "Blue", title: "Blue", description: "The sky" },
              ],
            },
            question_0_custom: {
              type: "string",
              title: "Other",
              description: "Or type your own",
              _meta: { _askUserQuestionCustomAnswer: { questionId: "question_0", isCustomAnswer: true } },
            },
          },
        },
      })
      await update({ sessionUpdate: "tool_call_update", toolCallId: "q1", status: res.action === "accept" ? "completed" : "failed" })
      return { stopReason: "end_turn" }
    }
    await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } })
    await update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } })
    return { stopReason: "end_turn" }
  },
  async cancel({ sessionId }) {
    running.get(sessionId)?.()
    running.delete(sessionId)
  },
})

new AgentSideConnection(agent, ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
