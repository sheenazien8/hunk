import { describe, expect, it } from "vitest"
import { parseShellVars } from "@/server/acp/shell"

describe("parseShellVars", () => {
  it("collects exports and unsets", () => {
    expect(parseShellVars("export API=https://x.com BASE=v2")).toEqual({ set: { API: "https://x.com", BASE: "v2" }, unset: [] })
    expect(parseShellVars('export A="a b"; export B=\'c d\'')).toEqual({ set: { A: "a b", B: "c d" }, unset: [] })
    expect(parseShellVars("unset API BASE")).toEqual({ set: {}, unset: ["API", "BASE"] })
  })

  it("ignores prefixes, env assignments on other commands and non-literals", () => {
    expect(parseShellVars("API=x curl $API")).toEqual({ set: {}, unset: [] })
    expect(parseShellVars("echo export FOO=bar")).toEqual({ set: {}, unset: [] })
    expect(parseShellVars("export BAD=$(id)")).toEqual({ set: {}, unset: [] })
  })

  it("handles && chains", () => {
    expect(parseShellVars("cd x && export A=1 && unset B")).toEqual({ set: { A: "1" }, unset: ["B"] })
  })
})
