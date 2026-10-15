import { mkdtempSync, rmSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTempRepo, type TempRepo } from "../../test/git-repo"

let tmp: string
let repos: TempRepo[]
let file: string

function repo() {
  const r = createTempRepo()
  repos.push(r)
  return r
}

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  })

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "hunk-projects-route-"))
  repos = []
  file = path.join(tmp, "projects.json")
  writeFileSync(file, JSON.stringify({ projects: [] }, null, 2))
  process.env.HUNK_PROJECTS_PATH = file
})

afterEach(() => {
  delete process.env.HUNK_PROJECTS_PATH
  for (const r of repos) r.cleanup()
  rmSync(tmp, { recursive: true, force: true })
})

async function routes() {
  return await import("../app/api/projects/route")
}

describe("/api/projects", () => {
  it("GET lists, POST adds and rejects bad dirs", async () => {
    const { GET, POST } = await routes()
    const target = repo()

    expect(await (await GET(json("/api/projects", "GET"))).json()).toEqual({ projects: [] })

    const added = await POST(json("/api/projects", "POST", { name: "Temp", dir: target.dir }))
    expect(added.status).toBe(200)
    expect((await added.json()).projects).toHaveLength(1)

    const duplicate = await POST(json("/api/projects", "POST", { name: "Dup", dir: target.dir }))
    expect(duplicate.status).toBe(409)

    const bad = await POST(json("/api/projects", "POST", { name: "Bad", dir: path.join(tmp, "missing") }))
    expect(bad.status).toBe(400)

    const plain = mkdtempSync(path.join(tmp, "plain-"))
    const nonRepo = await POST(json("/api/projects", "POST", { name: "Plain", dir: plain }))
    expect(nonRepo.status).toBe(400)
  })

  it("PATCH edits, 404s an unknown dir and 409s a duplicate target", async () => {
    const { PATCH } = await routes()
    const a = repo()
    const b = repo()
    const { POST } = await routes()
    await POST(json("/api/projects", "POST", { name: "A", dir: a.dir }))
    await POST(json("/api/projects", "POST", { name: "B", dir: b.dir }))

    const renamed = await PATCH(json("/api/projects", "PATCH", { dir: a.dir, next: { name: "A2", dir: a.dir } }))
    expect(renamed.status).toBe(200)
    expect((await renamed.json()).projects[0].name).toBe("A2")

    const unknown = await PATCH(json("/api/projects", "PATCH", { dir: path.join(tmp, "nope"), next: { name: "X", dir: a.dir } }))
    expect(unknown.status).toBe(404)

    const duplicate = await PATCH(json("/api/projects", "PATCH", { dir: a.dir, next: { name: "X", dir: b.dir } }))
    expect(duplicate.status).toBe(409)
  })

  it("DELETE removes and 404s an unknown dir", async () => {
    const { DELETE, POST } = await routes()
    const a = repo()
    await POST(json("/api/projects", "POST", { name: "A", dir: a.dir }))

    const removed = await DELETE(json(`/api/projects?dir=${encodeURIComponent(a.dir)}`, "DELETE"))
    expect(removed.status).toBe(200)
    expect((await removed.json()).projects).toEqual([])

    expect((await DELETE(json(`/api/projects?dir=${encodeURIComponent(a.dir)}`, "DELETE"))).status).toBe(404)
  })
})
