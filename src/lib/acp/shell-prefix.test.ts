import { describe, expect, it } from "vitest"
import { parsePromptInput } from "./shell-prefix"

describe("parsePromptInput", () => {
  it("! runs a shared command, !! a private one", () => {
    expect(parsePromptInput("!git status")).toEqual({ kind: "shell", command: "git status", share: true })
    expect(parsePromptInput("  !!ls -la ")).toEqual({ kind: "shell", command: "ls -la", share: false })
    expect(parsePromptInput("!! ls")).toEqual({ kind: "shell", command: "ls", share: false })
  })

  it("leaves an empty command empty", () => {
    expect(parsePromptInput("!")).toEqual({ kind: "shell", command: "", share: true })
    expect(parsePromptInput("!!  ")).toEqual({ kind: "shell", command: "", share: false })
  })

  it("\\! sends a literal ! to the agent", () => {
    expect(parsePromptInput("\\!important")).toEqual({ kind: "prompt", text: "!important" })
  })

  it("only counts ! at the start", () => {
    expect(parsePromptInput("hi !ls")).toEqual({ kind: "prompt", text: "hi !ls" })
  })
})
