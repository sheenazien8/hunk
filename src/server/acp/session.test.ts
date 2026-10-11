import { describe, expect, it } from "vitest"
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
