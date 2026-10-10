import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { AcpEvent } from "@/lib/acp/types"
import { loadAgents } from "./config"
import { getSession, listLiveSessions, listPastSessions, openSession, promptBlocks, promptImages, runAction, stopAll } from "./registry"
import type { AgentSession } from "./session"

const fakeAgent = path.resolve(__dirname, "../../../test/fake-acp-agent.mjs")
let tmp: string

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "hunk-acp-"))
  const config = path.join(tmp, "acp.config.json")
  writeFileSync(config, JSON.stringify({ agents: [{ id: "fake", name: "Fake", command: [process.execPath, fakeAgent] }] }))
  process.env.HUNK_ACP_CONFIG = config
})

afterAll(async () => {
  await stopAll()
  rmSync(tmp, { recursive: true, force: true })
})

function repoDir(name: string) {
  const dir = path.join(tmp, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

// Resolves with every event up to (and including) the first that matches.
function waitFor(session: AgentSession, match: (e: AcpEvent) => boolean, timeout = 5000): Promise<AcpEvent[]> {
  const seen: AcpEvent[] = []
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`timed out; saw ${JSON.stringify(seen.map(e => e.type))}`))
    }, timeout)
    const unsubscribe = session.subscribe(({ event }) => {
      seen.push(event)
      if (match(event)) {
        clearTimeout(timer)
        unsubscribe()
        resolve(seen)
      }
    }, () => {})
  })
}

const isTurnEnd = (e: AcpEvent) => e.type === "turn_end"

// 1x1 PNG / the start of a JPEG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString("base64")

describe("config", () => {
  it("falls back to claude-agent-acp for a missing file", async () => {
    expect(await loadAgents(path.join(tmp, "nope.json"))).toEqual([{ id: "claude", name: "Claude", command: ["claude-agent-acp"] }])
  })

  it("drops malformed entries", async () => {
    const file = path.join(tmp, "bad.json")
    writeFileSync(file, JSON.stringify({ agents: [{ id: "x", name: "X", command: [] }, { id: "ok", name: "OK", command: ["a"] }] }))
    expect((await loadAgents(file)).map(a => a.id)).toEqual(["ok"])
  })
})

describe("promptBlocks", () => {
  it("adds one resource link per mentioned file", () => {
    expect(promptBlocks("/r/repo", "fix @a.ts", ["a.ts", "src/b.ts", "a.ts"])).toEqual([
      { type: "text", text: "fix @a.ts" },
      { type: "resource_link", name: "a.ts", uri: "file:///r/repo/a.ts" },
      { type: "resource_link", name: "src/b.ts", uri: "file:///r/repo/src/b.ts" },
    ])
  })

  it("rejects paths outside the repo", () => {
    expect(() => promptBlocks("/r/repo", "x", ["../etc/passwd"])).toThrow(/Invalid file path/)
  })

  it("adds one image block per attached image, and no empty text", () => {
    const image = { data: PNG, mimeType: "image/png" }
    expect(promptBlocks("/r/repo", "look", [], [image])).toEqual([{ type: "text", text: "look" }, { type: "image", ...image }])
    expect(promptBlocks("/r/repo", "  ", [], [image])).toEqual([{ type: "image", ...image }])
  })
})

describe("promptImages", () => {
  it("accepts allowlisted types whose bytes match", () => {
    expect(promptImages(undefined)).toEqual([])
    expect(promptImages([{ data: PNG, mimeType: "image/png" }, { data: JPEG, mimeType: "image/jpeg" }])).toHaveLength(2)
  })

  it("rejects anything else", () => {
    expect(() => promptImages("x")).toThrow(/Invalid images/)
    expect(() => promptImages([{ data: PNG }])).toThrow(/invalid/)
    expect(() => promptImages([{ data: PNG, mimeType: "image/svg+xml" }])).toThrow(/isn't supported/)
    expect(() => promptImages([{ data: PNG, mimeType: "image/jpeg" }])).toThrow(/isn't really image\/jpeg/)
    expect(() => promptImages([{ data: "not base64!", mimeType: "image/png" }])).toThrow(/base64/)
    expect(() => promptImages([{ data: "A".repeat(8 * 1024 * 1024), mimeType: "image/png" }])).toThrow(/max 5\.0 MB/)
    expect(() => promptImages(Array(5).fill({ data: PNG, mimeType: "image/png" }))).toThrow(/At most 4/)
  })
})

describe("registry with a fake agent", () => {
  it("streams a prompt turn in order", async () => {
    const repo = repoDir("stream")
    const session = getSession(await openSession(repo, "fake"))
    const done = waitFor(session, isTurnEnd)
    await runAction(session, { action: "prompt", text: "hello" })
    const events = await done
    const texts = events.flatMap(e => (e.type === "update" && e.update.sessionUpdate === "agent_message_chunk" && e.update.content.type === "text" ? [e.update.content.text] : []))
    expect(events[0]).toEqual({ type: "user_prompt", text: "hello" })
    expect(texts).toEqual(["Hel", "lo"])
    expect(events.at(-1)).toEqual({ type: "turn_end", stopReason: "end_turn" })
    expect(session.title).toBe("hello")
    await waitFor(session, e => e.type === "state" && !e.state.busy).catch(() => {})
    expect(session.busy).toBe(false)
  })

  it("rejects a second prompt while busy", async () => {
    const session = getSession(await openSession(repoDir("busy"), "fake"))
    await runAction(session, { action: "prompt", text: "wait" })
    await expect(runAction(session, { action: "prompt", text: "hello" })).rejects.toThrow(/still working/)
    const done = waitFor(session, isTurnEnd)
    await runAction(session, { action: "cancel" })
    expect((await done).at(-1)).toEqual({ type: "turn_end", stopReason: "cancelled" })
  })

  it("waits for a permission answer", async () => {
    const session = getSession(await openSession(repoDir("perm"), "fake"))
    const asked = waitFor(session, e => e.type === "permission_request")
    await runAction(session, { action: "prompt", text: "edit" })
    const request = (await asked).at(-1) as Extract<AcpEvent, { type: "permission_request" }>
    expect(session.pendingCount).toBe(1)
    const done = waitFor(session, isTurnEnd)
    await runAction(session, { action: "permission", requestId: request.requestId, optionId: "yes" })
    const events = await done
    expect(events).toContainEqual({ type: "permission_resolved", requestId: request.requestId, optionId: "yes", auto: false })
    expect(events.some(e => e.type === "update" && e.update.sessionUpdate === "tool_call_update" && e.update.status === "completed")).toBe(true)
    await expect(runAction(session, { action: "permission", requestId: request.requestId, optionId: "yes" })).rejects.toThrow(/already answered/)
  })

  it("auto mode answers without a pending request", async () => {
    const session = getSession(await openSession(repoDir("auto"), "fake"))
    await runAction(session, { action: "autoApprove", enabled: true })
    const done = waitFor(session, isTurnEnd)
    await runAction(session, { action: "prompt", text: "edit" })
    const events = await done
    expect(events.some(e => e.type === "permission_resolved" && e.auto && e.optionId === "yes")).toBe(true)
    expect(session.pendingCount).toBe(0)
  })

  it("replays the log after a Last-Event-ID", async () => {
    const session = getSession(await openSession(repoDir("replay"), "fake"))
    const done = waitFor(session, isTurnEnd)
    await runAction(session, { action: "prompt", text: "hello" })
    await done
    const all = session.since(0)
    expect(all.reset).toBe(true)
    const tail = session.since(all.events[2].seq)
    expect(tail.reset).toBe(false)
    expect(tail.events).toEqual(all.events.slice(3))
  })

  it("lists and resumes sessions the agent knows", async () => {
    const repo = repoDir("resume")
    expect(await listLiveSessions(repo, "fake")).toEqual([])
    const listed = await listPastSessions(repo, "fake")
    expect(listed.sessions).toContainEqual(expect.objectContaining({ sessionId: "old-1", live: false, title: "Old session" }))
    expect(listed.nextCursor).toBeNull()
    const session = getSession(await openSession(repo, "fake", "old-1"))
    expect(session.title).toBe("Old session")
    const replayed = session.since(0).events.flatMap(({ event }) => (event.type === "update" ? [event.update.sessionUpdate] : []))
    expect(replayed).toEqual(["user_message_chunk", "agent_message_chunk"])
    expect((await listLiveSessions(repo, "fake")).map(s => s.sessionId)).toEqual(["old-1"])
    expect((await listPastSessions(repo, "fake")).sessions.some(s => s.sessionId === "old-1")).toBe(false)
  })

  it("pages past sessions across the agent's own pages", async () => {
    const repo = repoDir("many")
    const ids: string[] = []
    let cursor: string | null | undefined
    let pages = 0
    do {
      const page = await listPastSessions(repo, "fake", cursor)
      ids.push(...page.sessions.map(s => s.sessionId))
      cursor = page.nextCursor
      pages++
    } while (cursor)
    expect(pages).toBe(2)
    expect(ids).toEqual(Array.from({ length: 45 }, (_, i) => `m${i}`))
  })

  it("disconnects sessions when the agent exits", async () => {
    const session = getSession(await openSession(repoDir("crash"), "fake"))
    const gone = waitFor(session, e => e.type === "state" && !e.state.connected)
    await runAction(session, { action: "prompt", text: "crash" })
    const events = await gone
    expect(events.some(e => e.type === "error" && /exited/.test(e.message))).toBe(true)
    expect(() => getSession(session.id)).toThrow(/not found/)
  })

  it("tracks and changes the agent's settings", async () => {
    const session = getSession(await openSession(repoDir("config"), "fake"))
    expect(session.config.configOptions.map(o => o.id)).toEqual(["model", "fast"])
    expect(session.config.modes?.currentModeId).toBe("ask")
    expect(session.since(0).events.some(e => e.event.type === "config")).toBe(true)

    await runAction(session, { action: "setConfig", configId: "model", value: "big" })
    await runAction(session, { action: "setConfig", configId: "fast", value: true })
    await runAction(session, { action: "setMode", modeId: "code" })
    expect(session.config.configOptions.find(o => o.id === "model")?.currentValue).toBe("big")
    expect(session.config.configOptions.find(o => o.id === "fast")?.currentValue).toBe(true)
    expect(session.config.modes?.currentModeId).toBe("code")
    const last = session.since(0).events.at(-1)?.event
    expect(last).toMatchObject({ type: "config", config: { modes: { currentModeId: "code" } } })

    await expect(runAction(session, { action: "setConfig", configId: "nope", value: "x" })).rejects.toThrow(/Unknown setting/)
    await expect(runAction(session, { action: "setConfig", configId: "fast", value: "yes" })).rejects.toThrow(/Wrong value type/)
    await expect(runAction(session, { action: "setMode", modeId: "nope" })).rejects.toThrow(/Unknown mode/)
  })

  it("sends attached images to the agent and logs them with the prompt", async () => {
    const session = getSession(await openSession(repoDir("images"), "fake"))
    expect(session.state.images).toBe(true)
    const done = waitFor(session, isTurnEnd)
    await runAction(session, { action: "prompt", text: "image", images: [{ data: PNG, mimeType: "image/png" }] })
    const events = await done
    expect(events[0]).toEqual({ type: "user_prompt", text: "image", images: [{ data: PNG, mimeType: "image/png" }] })
    const contents = events.flatMap(e => (e.type === "update" && e.update.sessionUpdate === "agent_message_chunk" ? [e.update.content] : []))
    expect(contents).toEqual([
      { type: "text", text: `got image/png ${PNG.length}` },
      { type: "image", mimeType: "image/png", data: expect.any(String) },
    ])
  })

  it("replaces an oversized agent image with a placeholder", async () => {
    const session = getSession(await openSession(repoDir("huge"), "fake"))
    const done = waitFor(session, isTurnEnd)
    await runAction(session, { action: "prompt", text: "huge" })
    const chunk = (await done).find(e => e.type === "update" && e.update.sessionUpdate === "agent_message_chunk")
    expect(chunk).toMatchObject({ update: { content: { type: "text", text: expect.stringMatching(/^\[image: image\/png, 6\.0 MB — too large to show\]$/) } } })
  })

  it("refuses images for an agent without image prompts", async () => {
    const session = getSession(await openSession(repoDir("noimg"), "fake"))
    expect(session.state.images).toBe(false)
    await expect(runAction(session, { action: "prompt", text: "x", images: [{ data: PNG, mimeType: "image/png" }] })).rejects.toThrow(/Fake doesn't accept images/)
    expect(session.busy).toBe(false)
  })

  it("close removes the session", async () => {
    const session = getSession(await openSession(repoDir("close"), "fake"))
    await runAction(session, { action: "close" })
    expect(() => getSession(session.id)).toThrow(/not found/)
  })
})

describe("shell commands", () => {
  const ended = (e: AcpEvent) => e.type === "shell_end"
  const resultOf = (events: AcpEvent[]) => (events.at(-1) as Extract<AcpEvent, { type: "shell_end" }>).result

  async function shell(session: AgentSession, command: string, share?: boolean) {
    const done = waitFor(session, ended)
    await runAction(session, { action: "shell", command, share })
    return done
  }

  it("runs in the repo and reports the real output", async () => {
    const repo = repoDir("shell-run")
    const session = getSession(await openSession(repo, "fake"))
    const events = await shell(session, "pwd; echo err >&2; exit 3", true)
    expect(events[0]).toMatchObject({ type: "shell_start", command: "pwd; echo err >&2; exit 3", share: true })
    expect(resultOf(events)).toMatchObject({ lines: [repo, "err"], dropped: 0, exitCode: 3, signal: null, timedOut: false })
    expect(session.shell).toBeNull()
  })

  it("keeps the last 150 lines", async () => {
    const session = getSession(await openSession(repoDir("shell-tail"), "fake"))
    const result = resultOf(await shell(session, "seq 1 1000"))
    expect(result.lines).toHaveLength(150)
    expect(result.lines[0]).toBe("851")
    expect(result.dropped).toBe(850)
  })

  it("runs while the agent is busy, one command at a time", async () => {
    const session = getSession(await openSession(repoDir("shell-busy"), "fake"))
    await runAction(session, { action: "prompt", text: "wait" })
    const started = waitFor(session, e => e.type === "shell_start")
    await runAction(session, { action: "shell", command: "sleep 30", share: true })
    const start = (await started).at(-1) as Extract<AcpEvent, { type: "shell_start" }>
    await expect(runAction(session, { action: "shell", command: "ls" })).rejects.toThrow(/still running/)
    const done = waitFor(session, ended)
    await runAction(session, { action: "shellStop", shellId: start.shellId })
    expect(resultOf(await done)).toMatchObject({ signal: "SIGTERM", exitCode: null })
    await expect(runAction(session, { action: "shellStop", shellId: start.shellId })).rejects.toThrow(/not running/)
    const turn = waitFor(session, isTurnEnd)
    await runAction(session, { action: "cancel" })
    await turn
  })

  it("sends ! output with the next prompt only, never !! output", async () => {
    const session = getSession(await openSession(repoDir("shell-share"), "fake"))
    await shell(session, "echo shared-a", true)
    await shell(session, "echo private-b", false)
    await shell(session, "echo default-private")
    await shell(session, "echo shared-c", true)

    const reply = async () => {
      const done = waitFor(session, e => e.type === "state" && !e.state.busy)
      await runAction(session, { action: "prompt", text: "echo" })
      const events = await done
      return events.flatMap(e => (e.type === "update" && e.update.sessionUpdate === "agent_message_chunk" && e.update.content.type === "text" ? [e.update.content.text] : [])).join("")
    }
    const first = await reply()
    expect(first).toContain("$ echo shared-a\nshared-a")
    expect(first).toContain("$ echo shared-c\nshared-c")
    expect(first).not.toContain("private-b")
    expect(first).not.toContain("default-private")
    expect(await reply()).toBe("")
  })

  it("close kills a running command", async () => {
    const session = getSession(await openSession(repoDir("shell-close"), "fake"))
    const pidFile = path.join(tmp, "shell-close.pid")
    const started = waitFor(session, e => e.type === "shell_start")
    await runAction(session, { action: "shell", command: `sleep 30 & echo $! > ${pidFile}; wait` })
    await started
    await new Promise(r => setTimeout(r, 200))
    const pid = Number(readFileSync(pidFile, "utf-8"))
    await runAction(session, { action: "close" })
    await new Promise(r => setTimeout(r, 200))
    expect(() => process.kill(pid, 0)).toThrow()
    expect(session.since(0).events.some(e => e.event.type === "shell_end")).toBe(true)
  })

  it("takes its line limit and timeout from the env", async () => {
    const session = getSession(await openSession(repoDir("shell-env"), "fake"))
    process.env.HUNK_SHELL_MAX_LINES = "10"
    process.env.HUNK_SHELL_TIMEOUT = "1"
    try {
      const lines = resultOf(await shell(session, "seq 1 100"))
      expect(lines.lines).toEqual(Array.from({ length: 10 }, (_, i) => String(91 + i)))
      expect(lines.dropped).toBe(90)
      expect(resultOf(await shell(session, "sleep 30"))).toMatchObject({ timedOut: true, signal: "SIGTERM" })
      process.env.HUNK_SHELL_MAX_LINES = "nope"
      expect(resultOf(await shell(session, "seq 1 200")).lines).toHaveLength(150)
    } finally {
      delete process.env.HUNK_SHELL_MAX_LINES
      delete process.env.HUNK_SHELL_TIMEOUT
    }
  })

  it("can be turned off", async () => {
    const session = getSession(await openSession(repoDir("shell-off"), "fake"))
    process.env.HUNK_SHELL_DISABLED = "1"
    try {
      await expect(runAction(session, { action: "shell", command: "ls", share: true })).rejects.toThrow(/disabled/)
    } finally {
      delete process.env.HUNK_SHELL_DISABLED
    }
  })
})
