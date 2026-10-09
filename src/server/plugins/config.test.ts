import { mkdtemp, realpath, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect, it } from "vitest"
import { loadPlugins } from "./config"

async function configFile(content: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hunk-plugins-"))
  const file = path.join(dir, "plugins.json")
  await writeFile(file, content)
  return { dir, file }
}

describe("loadPlugins", () => {
  it("keeps valid entries, drops invalid and duplicate ids, resolves cwd against the file", async () => {
    const { dir, file } = await configFile(JSON.stringify({
      plugins: [
        { id: "plans", name: "Plans", url: "http://127.0.0.1:4100", command: ["node", "server.mjs"], cwd: "plugins/plans" },
        { id: "plans", name: "Again", url: "http://127.0.0.1:4101" },
        { id: "Bad Id", name: "x", url: "http://127.0.0.1:1" },
        { id: "ftp", name: "x", url: "ftp://host" },
        { id: "cmd", name: "x", url: "http://127.0.0.1:1", command: [] },
      ],
    }))
    expect(await loadPlugins(file)).toEqual([
      { id: "plans", name: "Plans", url: "http://127.0.0.1:4100", command: ["node", "server.mjs"], cwd: path.join(await realpath(dir), "plugins/plans") },
    ])
  })

  it("returns no plugins for a missing or malformed file", async () => {
    expect(await loadPlugins("/nonexistent/plugins.json")).toEqual([])
    expect(await loadPlugins((await configFile("{")).file)).toEqual([])
  })
})
