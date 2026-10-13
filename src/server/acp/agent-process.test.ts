import { describe, expect, it } from "vitest"
import { CLIENT_TERMINAL_META } from "./agent-process"

// Hunk shows agent terminals; the init capabilities say so.
describe("terminal client capabilities", () => {
  it("advertising metas for the agents that gate on them", () => {
    expect(CLIENT_TERMINAL_META).toMatchObject({ terminal_output: true })
  })
})