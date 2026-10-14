import { mkdirSync, writeFileSync } from "fs"
import path from "path"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createTempRepo, type TempRepo } from "../../../test/git-repo"
import { HttpError } from "../http"

// Only the temp repo counts as a listed project (same pattern as
// src/server/git/worktree.test.ts).
const listed = vi.hoisted(() => ({ dir: "" }))
vi.mock("../config", async importOriginal => ({
  ...(await importOriginal<typeof import("../config")>()),
  findProject: (repo: string) =>
    path.resolve(repo) === path.resolve(listed.dir) ? { name: "tmp", dir: listed.dir } : undefined,
}))

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
  "01f15c4890000000d4944415478da63fcffff3f030005fe02fea72d0e470000000049454e44ae426082",
  "hex",
)
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>')

let repo: TempRepo
let readRepoFileRaw: typeof import("../fs/files").readRepoFileRaw
let RAW_FILE_MAX_BYTES: typeof import("../fs/files").RAW_FILE_MAX_BYTES
let resolveRepo: typeof import("../repo").resolveRepo

beforeAll(async () => {
  ;({ readRepoFileRaw, RAW_FILE_MAX_BYTES } = await import("../fs/files"))
  ;({ resolveRepo } = await import("../repo"))
})

beforeEach(() => {
  repo = createTempRepo()
  listed.dir = repo.dir
  mkdirSync(path.join(repo.dir, "assets"))
  writeFileSync(path.join(repo.dir, "assets", "pixel.png"), PNG_BYTES)
  writeFileSync(path.join(repo.dir, "logo.svg"), SVG_BYTES)
  writeFileSync(path.join(repo.dir, "notes.txt"), "hello\n")
  mkdirSync(path.join(repo.dir, "folder.png"))
})
afterEach(() => repo.cleanup())

function raw(repo_?: TempRepo, file = "") {
  return readRepoFileRaw(repo_?.dir ?? repo.dir, file)
}

describe("readRepoFileRaw (GET /api/git/raw payload)", () => {
  it("returns the exact bytes of a png", async () => {
    const { bytes } = await raw(undefined, "assets/pixel.png")
    expect(bytes.equals(PNG_BYTES)).toBe(true)
  })

  it("labels png bytes as image/png", async () => {
    const { headers } = await raw(undefined, "assets/pixel.png")
    expect(headers["Content-Type"]).toBe("image/png")
  })

  it("serves svg as image/svg+xml", async () => {
    const { bytes, headers } = await raw(undefined, "logo.svg")
    expect(bytes.toString()).toContain("<svg")
    expect(headers["Content-Type"]).toBe("image/svg+xml")
  })

  it("sets inline disposition, a byte length and short private caching", async () => {
    const { headers } = await raw(undefined, "assets/pixel.png")
    expect(headers["Content-Disposition"]).toBe("inline")
    expect(headers["Content-Length"]).toBe(String(PNG_BYTES.length))
    expect(headers["Cache-Control"]).toBe("private, max-age=60")
  })

  it("rejects paths escaping the repo before touching the file", async () => {
    await expect(raw(undefined, "../outside.png")).rejects.toMatchObject({ status: 400 } satisfies Partial<HttpError>)
  })

  // The route calls resolveRepo() (with this same mocked config) before
  // readRepoFileRaw — an unlisted repo is a 403 and never reads bytes.
  it("the route's repo gate 403s repos outside projects.json", async () => {
    await expect(resolveRepo(path.join(repo.dir, "..", "elsewhere")))
      .rejects.toMatchObject({ status: 403 } satisfies Partial<HttpError>)
  })

  it("refuses directories and extensions it must not serve", async () => {
    await expect(raw(undefined, "folder.png")).rejects.toMatchObject({ status: 400 } satisfies Partial<HttpError>)
    await expect(raw(undefined, "notes.txt")).rejects.toMatchObject({ status: 400 } satisfies Partial<HttpError>)
    await expect(raw(undefined, "missing.png")).rejects.toMatchObject({ status: 404 } satisfies Partial<HttpError>)
  })

  it("answers 413 for a file over the size cap", async () => {
    const big = path.join(repo.dir, "big.png")
    writeFileSync(big, Buffer.alloc(RAW_FILE_MAX_BYTES + 1, 7))
    await expect(raw(undefined, "big.png")).rejects.toMatchObject({ status: 413 } satisfies Partial<HttpError>)
  })

  it("serves a file exactly at the cap", async () => {
    const atCap = path.join(repo.dir, "at-cap.png")
    writeFileSync(atCap, Buffer.alloc(RAW_FILE_MAX_BYTES, 7))
    const { bytes } = await raw(undefined, "at-cap.png")
    expect(bytes.length).toBe(RAW_FILE_MAX_BYTES)
  })
})