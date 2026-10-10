import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { trustProject } from "./trust"

let tmp: string
let repo: string

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "hunk-trust-"))
  repo = path.join(tmp, "repo")
  mkdirSync(repo)
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude")
  process.env.PI_CODING_AGENT_DIR = path.join(tmp, "pi")
})

afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.PI_CODING_AGENT_DIR
  rmSync(tmp, { recursive: true, force: true })
})

const read = (file: string) => JSON.parse(readFileSync(file, "utf-8"))

describe("trustProject", () => {
  it("sets claude's trust flag and keeps the rest", async () => {
    const file = path.join(tmp, "claude", ".claude.json")
    mkdirSync(path.dirname(file))
    writeFileSync(file, JSON.stringify({ numStartups: 3, projects: { [repo]: { allowedTools: ["x"] } } }))
    await trustProject({ id: "claude", name: "Claude", command: ["claude-agent-acp"] }, repo)
    expect(read(file)).toEqual({ numStartups: 3, projects: { [repo]: { allowedTools: ["x"], hasTrustDialogAccepted: true } } })
  })

  it("creates pi's trust.json keyed by the real path", async () => {
    await trustProject({ id: "pi", name: "Pi", command: ["npx", "-y", "pi-acp"] }, repo)
    expect(read(path.join(tmp, "pi", "trust.json"))).toEqual({ [realpathSync(repo)]: true })
  })

  it("never overwrites a file it can't parse", async () => {
    const file = path.join(tmp, "pi", "trust.json")
    writeFileSync(file, "{broken")
    await expect(trustProject({ id: "pi", name: "Pi", command: ["pi-acp"] }, repo)).rejects.toThrow(/Can't parse/)
    expect(readFileSync(file, "utf-8")).toBe("{broken")
  })

  it("rejects agents it doesn't know", async () => {
    await expect(trustProject({ id: "x", name: "X", command: ["other"] }, repo)).rejects.toThrow(/no project trust/)
  })
})
