import { describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS, mergeSettings, parseSettings } from "./types"

describe("parseSettings", () => {
  it("returns the defaults for nothing usable", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings("nope")).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({ agent: "x", viewer: null })).toEqual(DEFAULT_SETTINGS)
  })

  it("keeps valid values", () => {
    const settings = {
      agent: { autoApproveDefault: true, defaultAgent: "pi", shellMaxLines: 400, shellTimeout: 60 },
      viewer: { defaultDiffView: "unified", renderMarkdown: true },
      git: { confirmPush: true },
      files: { ignore: ["node_modules", "*.log"] },
      theme: "dark",
    }
    expect(parseSettings(settings)).toEqual(settings)
  })

  it("falls back per value for invalid ones", () => {
    const parsed = parseSettings({
      agent: { autoApproveDefault: "yes", defaultAgent: 3, shellMaxLines: -1, shellTimeout: 1.5 },
      viewer: { defaultDiffView: "raw", renderMarkdown: 1 },
      theme: "blue",
    })
    expect(parsed).toEqual(DEFAULT_SETTINGS)
  })

  it("clamps numbers and accepts numeric strings", () => {
    const { agent } = parseSettings({ agent: { shellMaxLines: 99_999, shellTimeout: "120" } })
    expect(agent.shellMaxLines).toBe(5_000)
    expect(agent.shellTimeout).toBe(120)
    expect(parseSettings({ agent: { shellTimeout: 10 ** 9 } }).agent.shellTimeout).toBe(86_400)
  })

  it("drops unknown keys", () => {
    const parsed = parseSettings({ extra: 1, agent: { command: ["rm"] }, projects: {} }) as unknown as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(["agent", "files", "git", "theme", "viewer"])
    expect(parsed.agent).toEqual(DEFAULT_SETTINGS.agent)
  })

  it("cleans the ignore list; empty means the defaults", () => {
    expect(parseSettings({ files: { ignore: [" dist ", "", 3, "dist", "*.log"] } }).files.ignore).toEqual(["dist", "*.log"])
    expect(parseSettings({ files: { ignore: [] } }).files.ignore).toBeNull()
    expect(parseSettings({ files: { ignore: "dist" } }).files.ignore).toBeNull()
  })
})

describe("mergeSettings", () => {
  it("merges sections key by key", () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { agent: { autoApproveDefault: true }, theme: "light" })
    expect(next.agent).toEqual({ ...DEFAULT_SETTINGS.agent, autoApproveDefault: true })
    expect(next.theme).toBe("light")
    expect(next.viewer).toEqual(DEFAULT_SETTINGS.viewer)
  })

  it("replaces arrays and resets with null", () => {
    const withList = mergeSettings(DEFAULT_SETTINGS, { files: { ignore: ["a", "b"] } })
    expect(mergeSettings(withList, { files: { ignore: ["c"] } }).files.ignore).toEqual(["c"])
    expect(mergeSettings(withList, { files: { ignore: null } }).files.ignore).toBeNull()
  })

  it("ignores a section of the wrong shape and invalid values", () => {
    const current = mergeSettings(DEFAULT_SETTINGS, { agent: { shellMaxLines: 20 } })
    expect(mergeSettings(current, { agent: true })).toEqual(current)
    expect(mergeSettings(current, { agent: { shellMaxLines: "lots" } }).agent.shellMaxLines).toBe(150)
    expect(mergeSettings(current, null)).toEqual(current)
  })
})
