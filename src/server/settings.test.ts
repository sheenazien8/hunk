import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "@/lib/settings/types"
import { loadSettings, updateSettings } from "./settings"

const tmp = mkdtempSync(path.join(os.tmpdir(), "hunk-settings-"))

afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function dir(name: string) {
  return mkdtempSync(path.join(tmp, `${name}-`))
}

describe("settings store", () => {
  it("reads defaults for a missing or malformed file", async () => {
    expect(await loadSettings(path.join(tmp, "missing.json"))).toEqual(DEFAULT_SETTINGS)
    const bad = path.join(tmp, "bad.json")
    writeFileSync(bad, "{ nope")
    expect(await loadSettings(bad)).toEqual(DEFAULT_SETTINGS)
  })

  it("merges a patch, writes it atomically and reads it back", async () => {
    const d = dir("write")
    const file = path.join(d, "settings.json")
    const saved = await updateSettings({ agent: { autoApproveDefault: true } }, file)
    expect(saved.agent.autoApproveDefault).toBe(true)
    expect(await loadSettings(file)).toEqual(saved)
    expect(readdirSync(d)).toEqual(["settings.json"])

    const next = await updateSettings({ viewer: { defaultDiffView: "unified" } }, file)
    expect(next.agent.autoApproveDefault).toBe(true)
    expect(JSON.parse(readFileSync(file, "utf-8")).viewer.defaultDiffView).toBe("unified")
  })

  it("keeps concurrent patches", async () => {
    const file = path.join(dir("race"), "settings.json")
    await Promise.all([
      updateSettings({ git: { confirmPush: true } }, file),
      updateSettings({ theme: "dark" }, file),
      updateSettings({ viewer: { renderMarkdown: true } }, file),
    ])
    const settings = await loadSettings(file)
    expect([settings.git.confirmPush, settings.theme, settings.viewer.renderMarkdown]).toEqual([true, "dark", true])
  })

  it("writes through a symlink instead of replacing it", async () => {
    const d = dir("link")
    const real = path.join(d, "real.json")
    const link = path.join(d, "settings.json")
    writeFileSync(real, "{}")
    symlinkSync(real, link)
    await updateSettings({ theme: "light" }, link)
    expect(JSON.parse(readFileSync(real, "utf-8")).theme).toBe("light")
    expect(await loadSettings(link)).toMatchObject({ theme: "light" })
  })
})

describe("ignore patterns", () => {
  it("come from files.ignore when set, else the old config", async () => {
    const { loadIgnorePatterns } = await import("./config")
    const prev = process.env.HUNK_SETTINGS_PATH
    try {
      expect(await loadIgnorePatterns("/not/a/project")).toContain("node_modules")
      const file = path.join(dir("ignore"), "settings.json")
      await updateSettings({ files: { ignore: ["only-this"] } }, file)
      process.env.HUNK_SETTINGS_PATH = file
      expect(await loadIgnorePatterns("/not/a/project")).toEqual(["only-this"])
    } finally {
      process.env.HUNK_SETTINGS_PATH = prev
    }
  })
})
