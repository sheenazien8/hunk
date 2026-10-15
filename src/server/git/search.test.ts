import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTempRepo, type TempRepo } from "../../../test/git-repo"
import { HttpError } from "../http"
import { globPathspecs, searchRepo } from "./search"

let repo: TempRepo

beforeEach(() => {
  repo = createTempRepo()
  repo.write(".gitignore", "dist/\n")
  repo.write("src/a.ts", "const needle = 1\n  // Needle again\nother\n")
  repo.write("src/b.test.ts", "needle in a test\n")
  repo.write("README.md", "no match here\nneedles\n")
  repo.git("add", "-A")
  repo.git("commit", "-q", "-m", "init")
  repo.write("notes.txt", "untracked needle\n")
  repo.write("dist/out.js", "ignored needle\n")
  repo.write("node_modules/pkg/index.js", "needle in deps\n")
  repo.write("bin.dat", "needle\0binary\n")
})
afterEach(() => repo.cleanup())

const paths = (r: Awaited<ReturnType<typeof searchRepo>>) => r.files.map(f => f.path).sort()

describe("searchRepo", () => {
  it("finds tracked and untracked text files, skipping ignored and binary ones", async () => {
    const r = await searchRepo(repo.dir, { query: "needle" })
    expect(paths(r)).toEqual(["README.md", "notes.txt", "src/a.ts", "src/b.test.ts"])
    expect(r.files.find(f => f.path === "src/a.ts")?.matches).toEqual([
      { line: 1, text: "const needle = 1", ranges: [[6, 12]] },
      { line: 2, text: "// Needle again", ranges: [[3, 9]] },
    ])
    expect(r).toMatchObject({ total: 5, truncated: false })
  })

  it("honours case, whole word and regex", async () => {
    expect((await searchRepo(repo.dir, { query: "Needle", caseSensitive: true })).total).toBe(1)
    expect(paths(await searchRepo(repo.dir, { query: "needles", wholeWord: true }))).toEqual(["README.md"])
    const r = await searchRepo(repo.dir, { query: "needle\\s=\\s\\d", regex: true })
    expect(r.files).toEqual([{ path: "src/a.ts", matches: [{ line: 1, text: "const needle = 1", ranges: [[6, 16]] }] }])
  })

  it("filters with include / exclude globs", async () => {
    expect(paths(await searchRepo(repo.dir, { query: "needle", include: "*.ts" }))).toEqual(["src/a.ts", "src/b.test.ts"])
    expect(paths(await searchRepo(repo.dir, { query: "needle", include: "src/", exclude: "*.test.ts" }))).toEqual(["src/a.ts"])
    expect(paths(await searchRepo(repo.dir, { query: "needle", exclude: "src, *.md" }))).toEqual(["notes.txt"])
  })

  it("stops at the limit", async () => {
    const r = await searchRepo(repo.dir, { query: "needle" }, 2)
    expect(r).toMatchObject({ total: 2, truncated: true })
  })

  it("returns nothing for no match or an empty query", async () => {
    expect(await searchRepo(repo.dir, { query: "zzz-not-there" })).toEqual({ files: [], total: 0, truncated: false })
    expect(await searchRepo(repo.dir, { query: "" })).toEqual({ files: [], total: 0, truncated: false })
  })

  it("rejects an invalid regex with 400", async () => {
    const p = searchRepo(repo.dir, { query: "a(", regex: true })
    await expect(p).rejects.toBeInstanceOf(HttpError)
    await p.catch(e => expect((e as HttpError).status).toBe(400))
  })
})

describe("globPathspecs", () => {
  it("anchors paths and matches bare names anywhere", () => {
    expect(globPathspecs(" *.ts, ./src/lib/ ,", false)).toEqual([":(glob)**/*.ts", ":(glob)**/*.ts/**", ":(glob)src/lib", ":(glob)src/lib/**"])
    expect(globPathspecs("vendor", true)).toEqual([":(exclude,glob)**/vendor", ":(exclude,glob)**/vendor/**"])
    expect(globPathspecs(undefined, false)).toEqual([])
  })
})
