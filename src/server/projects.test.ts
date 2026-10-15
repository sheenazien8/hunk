import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTempRepo, type TempRepo } from "../../test/git-repo"
import { HttpError } from "./http"

// Temp repos + a temp projects.json; the module reads both at call time.
let tmp: string
let repos: TempRepo[]
let file: string

function repo() {
  const r = createTempRepo()
  repos.push(r)
  return r
}

function setFile(projects: unknown[]) {
  writeFileSync(file, JSON.stringify({ projects }, null, 2))
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "hunk-projects-"))
  repos = []
  file = path.join(tmp, "projects.json")
  process.env.HUNK_PROJECTS_PATH = file
})

afterEach(() => {
  delete process.env.HUNK_PROJECTS_PATH
  for (const r of repos) r.cleanup()
  rmSync(tmp, { recursive: true, force: true })
})

async function store() {
  const config = await import("./config")
  const projects = await import("./projects")
  const repoModule = await import("./repo")
  return { ...config, ...projects, ...repoModule }
}

describe("project store", () => {
  it("adds a project and lets resolveRepo open it", async () => {
    const { addProject, listProjects, resolveRepo } = await store()
    setFile([])
    const target = repo()
    await expect(resolveRepo(target.dir)).rejects.toMatchObject({ status: 403 })

    const list = await addProject({ name: "Temp", dir: target.dir })
    expect(list).toHaveLength(1)
    expect(listProjects()[0].name).toBe("Temp")
    expect(await resolveRepo(target.dir)).toBe(target.dir)
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual({ projects: [{ name: "Temp", dir: target.dir }] })
  })

  it("rejects a duplicate directory and a non-repo directory", async () => {
    const { addProject } = await store()
    setFile([])
    const target = repo()
    await addProject({ name: "A", dir: target.dir })
    await expect(addProject({ name: "B", dir: target.dir })).rejects.toMatchObject({ status: 409 })

    const plain = mkdtempSync(path.join(tmp, "plain-"))
    await expect(addProject({ name: "C", dir: plain })).rejects.toMatchObject({ status: 400 })
    await expect(addProject({ name: "D", dir: path.join(tmp, "missing") })).rejects.toMatchObject({ status: 400 })
  })

  it("renames in place and follows a dir move in the allowlist", async () => {
    const { addProject, updateProject, listProjects, resolveRepo } = await store()
    setFile([])
    const a = repo()
    const b = repo()
    const c = repo()
    await addProject({ name: "A", dir: a.dir })
    await addProject({ name: "B", dir: b.dir })

    await updateProject(a.dir, { name: "A renamed", dir: a.dir })
    expect(listProjects().map(p => p.name)).toEqual(["A renamed", "B"])

    await updateProject(a.dir, { name: "A renamed", dir: c.dir, ignore: ["dist"] })
    await expect(resolveRepo(a.dir)).rejects.toMatchObject({ status: 403 })
    expect(await resolveRepo(c.dir)).toBe(c.dir)
    expect(listProjects()).toEqual([
      { name: "A renamed", dir: c.dir, ignore: ["dist"] },
      { name: "B", dir: b.dir },
    ])
  })

  it("rejects an unknown dir and a duplicate target", async () => {
    const { addProject, updateProject } = await store()
    setFile([])
    const a = repo()
    const b = repo()
    await addProject({ name: "A", dir: a.dir })
    await addProject({ name: "B", dir: b.dir })

    await expect(updateProject(path.join(tmp, "nope"), { name: "X", dir: a.dir }))
      .rejects.toMatchObject({ status: 404 })
    await expect(updateProject(a.dir, { name: "X", dir: b.dir }))
      .rejects.toMatchObject({ status: 409 })
    // An update may keep its own dir.
    await expect(updateProject(a.dir, { name: "A", dir: a.dir })).resolves.toHaveLength(2)
  })

  it("removes a project and restores the 403", async () => {
    const { addProject, removeProject, listProjects, resolveRepo } = await store()
    setFile([])
    const target = repo()
    await addProject({ name: "A", dir: target.dir })
    expect(await resolveRepo(target.dir)).toBe(target.dir)

    await removeProject(target.dir)
    expect(listProjects()).toEqual([])
    await expect(resolveRepo(target.dir)).rejects.toMatchObject({ status: 403 })
    await expect(removeProject(target.dir)).rejects.toMatchObject({ status: 404 })
  })

  it("keeps concurrent mutations", async () => {
    const { addProject, listProjects } = await store()
    setFile([])
    const a = repo()
    const b = repo()
    await Promise.all([addProject({ name: "A", dir: a.dir }), addProject({ name: "B", dir: b.dir })])
    expect(listProjects().map(p => p.name).sort()).toEqual(["A", "B"])
  })

  it("throws HttpError for bad names and ignore values", async () => {
    const { addProject } = await store()
    setFile([])
    const target = repo()
    await expect(addProject({ name: "  ", dir: target.dir })).rejects.toBeInstanceOf(HttpError)
    await expect(addProject({ name: "A", dir: target.dir, ignore: [1 as unknown as string] }))
      .rejects.toBeInstanceOf(HttpError)
  })
})
