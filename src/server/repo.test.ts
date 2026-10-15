import path from "path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { listProjects } from "./config"
import { HttpError } from "./http"
import { resolveInRepo, resolveRepo } from "./repo"

describe("resolveInRepo", () => {
  const repo = "/srv/repo"

  it("resolves paths inside the repo", () => {
    expect(resolveInRepo(repo, "src/a.ts")).toBe(path.join(repo, "src/a.ts"))
    expect(resolveInRepo(repo, "src/../b.ts")).toBe(path.join(repo, "b.ts"))
  })

  it.each(["../etc/passwd", "/etc/passwd", ".", "", "../repo2/x", "src/../../x"])("rejects %j", rel => {
    expect(() => resolveInRepo(repo, rel)).toThrow(HttpError)
  })
})

describe("resolveRepo", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("defaults to the first project", async () => {
    expect(await resolveRepo(null)).toBe(listProjects()[0].dir)
  })

  it("accepts listed projects, including an equivalent spelling", async () => {
    expect(await resolveRepo(listProjects()[0].dir + "/")).toBe(listProjects()[0].dir + "/")
  })

  it("rejects unlisted repos with 403", async () => {
    await expect(resolveRepo("/etc")).rejects.toSatisfy(e => e instanceof HttpError && e.status === 403)
  })

  it("allows any repo when HUNK_ALLOW_ANY_REPO=1", async () => {
    vi.stubEnv("HUNK_ALLOW_ANY_REPO", "1")
    expect(await resolveRepo("/etc")).toBe("/etc")
  })
})
