import { existsSync, readFileSync, statSync } from "fs"
import path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTempRepo, type TempRepo } from "../../../test/git-repo"
import { HttpError } from "../http"
import { actions } from "./actions"
import { getDiff } from "./diff"
import { getStatus, isUntracked } from "./status"

let repo: TempRepo

beforeEach(() => {
  repo = createTempRepo()
})
afterEach(() => repo.cleanup())

function commitAll(msg = "init") {
  repo.git("add", "-A")
  repo.git("commit", "-q", "-m", msg)
}

describe("getStatus", () => {
  it("reports branch, staged, unstaged and untracked files", async () => {
    repo.write("a.txt", "a\n")
    commitAll()
    repo.write("a.txt", "a2\n")
    repo.git("add", "a.txt")
    repo.write("a.txt", "a3\n")
    repo.write("dir/new.txt", "n\n")

    const { branch, files } = await getStatus(repo.dir)
    expect(branch).toBe("main")
    expect(files).toEqual([
      { path: "a.txt", status: "modified", staged: true, oldPath: undefined },
      { path: "a.txt", status: "modified", staged: false, oldPath: undefined },
      { path: "dir/new.txt", status: "untracked", staged: false },
    ])
    expect(await isUntracked(repo.dir, "dir/new.txt")).toBe(true)
    expect(await isUntracked(repo.dir, "a.txt")).toBe(false)
  })
})

describe("getDiff", () => {
  it("diffs untracked files against /dev/null", async () => {
    repo.write("a.txt", "a\n")
    commitAll()
    repo.write("u.txt", "hello\n")
    const diff = await getDiff(repo.dir, { file: "u.txt", side: "unstaged" })
    expect(diff).toContain("+hello")
  })

  it("separates staged and unstaged sides", async () => {
    repo.write("a.txt", "1\n")
    commitAll()
    repo.write("a.txt", "2\n")
    repo.git("add", "a.txt")
    repo.write("a.txt", "3\n")
    expect(await getDiff(repo.dir, { file: "a.txt", side: "staged" })).toMatch(/-1\n\+2/)
    expect(await getDiff(repo.dir, { file: "a.txt", side: "unstaged" })).toMatch(/-2\n\+3/)
    expect(await getDiff(repo.dir, { file: "a.txt", side: "head" })).toMatch(/-1\n\+3/)
  })

  it("diffs staged files against the empty tree when HEAD is unborn", async () => {
    repo.write("a.txt", "first\n")
    repo.git("add", "a.txt")
    expect(await getDiff(repo.dir, { file: "a.txt", side: "staged" })).toContain("+first")
  })

  it("keeps rename detection when given the old path", async () => {
    repo.write("old.txt", "same content\nline 2\nline 3\n")
    commitAll()
    repo.git("mv", "old.txt", "new.txt")
    const diff = await getDiff(repo.dir, { file: "new.txt", oldPath: "old.txt", side: "staged" })
    expect(diff).toContain("rename from old.txt")
    expect(diff).toContain("rename to new.txt")
  })

  it("does not interpret file names through a shell", async () => {
    repo.write("a.txt", "a\n")
    commitAll()
    const evil = `x"; touch pwned; echo "`
    await getDiff(repo.dir, { file: evil, side: "unstaged" }).catch(() => "")
    expect(existsSync(path.join(repo.dir, "pwned"))).toBe(false)
  })
})

describe("actions", () => {
  it("stages, unstages and commits", async () => {
    repo.write("a.txt", "a\n")
    commitAll()
    repo.write("a.txt", "b\n")

    expect(await actions.add(repo.dir, { files: ["a.txt"] })).toBe("Staged 1 file")
    expect((await getStatus(repo.dir)).files).toMatchObject([{ path: "a.txt", staged: true }])

    await actions.unstage(repo.dir, { files: ["a.txt"] })
    expect((await getStatus(repo.dir)).files).toMatchObject([{ path: "a.txt", staged: false }])

    await actions.addAll(repo.dir, {})
    await actions.commit(repo.dir, { message: "change" })
    expect((await getStatus(repo.dir)).files).toEqual([])
    expect(repo.git("log", "-1", "--format=%s").trim()).toBe("change")
  })

  it("unstages in a repo with no commits", async () => {
    repo.write("a.txt", "a\n")
    repo.git("add", "a.txt")
    await actions.unstage(repo.dir, { files: ["a.txt"] })
    expect((await getStatus(repo.dir)).files).toMatchObject([{ path: "a.txt", status: "untracked" }])

    repo.git("add", "a.txt")
    await actions.unstageAll(repo.dir, {})
    expect((await getStatus(repo.dir)).files).toMatchObject([{ path: "a.txt", status: "untracked" }])
  })

  it("validates input", async () => {
    await expect(actions.add(repo.dir, {})).rejects.toThrow("No file specified")
    await expect(actions.commit(repo.dir, { message: "  " })).rejects.toThrow("Commit message is required")
    await expect(actions.create(repo.dir, { path: "" })).rejects.toThrow("File path is required")
    await expect(actions.delete(repo.dir, { files: ["../outside"] })).rejects.toBeInstanceOf(HttpError)
    await expect(actions.discard(repo.dir, { files: ["/etc/passwd"] })).rejects.toBeInstanceOf(HttpError)
  })

  it("creates and deletes files", async () => {
    await actions.create(repo.dir, { path: "new.txt" })
    expect(readFileSync(path.join(repo.dir, "new.txt"), "utf-8")).toBe("")
    await expect(actions.create(repo.dir, { path: "new.txt" })).rejects.toMatchObject({ status: 409 })
    expect(await actions.delete(repo.dir, { files: ["new.txt"] })).toBe("Deleted new.txt")
    expect(existsSync(path.join(repo.dir, "new.txt"))).toBe(false)
  })

  it("creates files in missing folders, and folders", async () => {
    await actions.create(repo.dir, { path: "a/b/c.txt" })
    expect(existsSync(path.join(repo.dir, "a/b/c.txt"))).toBe(true)
    await expect(actions.create(repo.dir, { path: "a/b/c.txt/d.txt" })).rejects.toMatchObject({ status: 409 })
    await actions.createDir(repo.dir, { path: "x/y" })
    expect(statSync(path.join(repo.dir, "x/y")).isDirectory()).toBe(true)
    await expect(actions.createDir(repo.dir, { path: "x/y" })).rejects.toMatchObject({ status: 409 })
    await expect(actions.createDir(repo.dir, { path: "a/b/c.txt" })).rejects.toMatchObject({ status: 409 })
    await expect(actions.createDir(repo.dir, { path: "" })).rejects.toMatchObject({ status: 400 })
  })

  it("refuses paths in .git or outside the repo", async () => {
    await expect(actions.create(repo.dir, { path: ".git/hooks/pre-commit" })).rejects.toMatchObject({ status: 400 })
    await expect(actions.createDir(repo.dir, { path: "sub/.GIT" })).rejects.toMatchObject({ status: 400 })
    await expect(actions.delete(repo.dir, { files: [".git"] })).rejects.toMatchObject({ status: 400 })
    await expect(actions.delete(repo.dir, { files: ["."] })).rejects.toMatchObject({ status: 400 })
    await expect(actions.delete(repo.dir, { files: [""] })).rejects.toMatchObject({ status: 400 })
    await expect(actions.rename(repo.dir, { path: "a", to: "../escape" })).rejects.toMatchObject({ status: 400 })
    await expect(actions.rename(repo.dir, { path: "a", to: ".git/x" })).rejects.toMatchObject({ status: 400 })
    expect(existsSync(path.join(repo.dir, ".git/HEAD"))).toBe(true)
  })

  it("deletes folders recursively", async () => {
    repo.write("d/e/f.txt", "f\n")
    repo.write("d/g.txt", "g\n")
    expect(await actions.delete(repo.dir, { files: ["d"] })).toBe("Deleted d")
    expect(existsSync(path.join(repo.dir, "d"))).toBe(false)
  })

  it("renames tracked files through git so the index records it", async () => {
    repo.write("old.txt", "content\n")
    commitAll()
    await actions.rename(repo.dir, { path: "old.txt", to: "sub/new.txt" })
    expect(readFileSync(path.join(repo.dir, "sub/new.txt"), "utf-8")).toBe("content\n")
    expect(repo.git("status", "--porcelain")).toBe("R  old.txt -> sub/new.txt\n")
  })

  it("renames untracked files and folders with mixed content", async () => {
    repo.write("u.txt", "u\n")
    await actions.rename(repo.dir, { path: "u.txt", to: "v.txt" })
    expect(existsSync(path.join(repo.dir, "v.txt"))).toBe(true)
    expect(existsSync(path.join(repo.dir, "u.txt"))).toBe(false)

    repo.write("dir/t.txt", "t\n")
    commitAll()
    repo.write("dir/untracked.txt", "x\n")
    await actions.rename(repo.dir, { path: "dir", to: "moved/dir" })
    expect(existsSync(path.join(repo.dir, "moved/dir/t.txt"))).toBe(true)
    expect(existsSync(path.join(repo.dir, "moved/dir/untracked.txt"))).toBe(true)
    expect(existsSync(path.join(repo.dir, "dir"))).toBe(false)
  })

  it("validates renames", async () => {
    repo.write("a.txt", "a\n")
    repo.write("b.txt", "b\n")
    repo.write("d/x.txt", "x\n")
    await expect(actions.rename(repo.dir, { path: "a.txt", to: "b.txt" })).rejects.toMatchObject({ status: 409 })
    await expect(actions.rename(repo.dir, { path: "missing.txt", to: "c.txt" })).rejects.toMatchObject({ status: 404 })
    await expect(actions.rename(repo.dir, { path: "d", to: "d/inner" })).rejects.toMatchObject({ status: 400 })
    await expect(actions.rename(repo.dir, { path: "a.txt" })).rejects.toMatchObject({ status: 400 })
  })

  it("moves several paths into a folder", async () => {
    repo.write("t.txt", "t\n")
    repo.write("dir/x.txt", "x\n")
    commitAll()
    repo.write("u.txt", "u\n")
    repo.write("dest/already.txt", "a\n")
    const msg = await actions.move(repo.dir, { files: ["t.txt", "u.txt", "dir", "dir/x.txt", "dest/already.txt"], to: "dest/" })
    expect(msg).toBe("Moved 3 items to dest/")
    for (const p of ["dest/t.txt", "dest/u.txt", "dest/dir/x.txt", "dest/already.txt"]) expect(existsSync(path.join(repo.dir, p))).toBe(true)
    expect(existsSync(path.join(repo.dir, "dir"))).toBe(false)
    expect(repo.git("status", "--porcelain")).toContain("R  t.txt -> dest/t.txt")
    expect(await actions.move(repo.dir, { files: ["dest/t.txt"], to: "" })).toBe("Moved dest/t.txt to the repository root")
  })

  it("validates every path before moving any", async () => {
    repo.write("a.txt", "a\n")
    repo.write("b/a.txt", "b\n")
    repo.write("c.txt", "c\n")
    repo.write("dest/c.txt", "old\n")
    repo.write("d/e.txt", "e\n")
    const unchanged = () => expect(existsSync(path.join(repo.dir, "a.txt"))).toBe(true)
    await expect(actions.move(repo.dir, { files: ["a.txt", "b/a.txt"], to: "x" })).rejects.toMatchObject({ status: 409 })
    unchanged()
    await expect(actions.move(repo.dir, { files: ["a.txt", "c.txt"], to: "dest" })).rejects.toMatchObject({ status: 409 })
    unchanged()
    await expect(actions.move(repo.dir, { files: ["a.txt", "missing.txt"], to: "x" })).rejects.toMatchObject({ status: 404 })
    unchanged()
    await expect(actions.move(repo.dir, { files: ["a.txt", "d"], to: "d/sub" })).rejects.toMatchObject({ status: 400 })
    unchanged()
    await expect(actions.move(repo.dir, { files: ["a.txt"], to: "c.txt" })).rejects.toMatchObject({ status: 409 })
    await expect(actions.move(repo.dir, { files: ["a.txt"], to: ".git" })).rejects.toMatchObject({ status: 400 })
    await expect(actions.move(repo.dir, { files: ["a.txt"], to: "../out" })).rejects.toMatchObject({ status: 400 })
    await expect(actions.move(repo.dir, { files: ["a.txt"], to: "" })).rejects.toMatchObject({ status: 400 })
    await expect(actions.move(repo.dir, { files: [] })).rejects.toMatchObject({ status: 400 })
    unchanged()
    expect(existsSync(path.join(repo.dir, "x"))).toBe(false)
  })

  it("discards tracked changes and removes untracked files", async () => {
    repo.write("a.txt", "a\n")
    commitAll()
    repo.write("a.txt", "changed\n")
    repo.write("u.txt", "u\n")
    await actions.discard(repo.dir, { files: ["a.txt", "u.txt"] })
    expect(readFileSync(path.join(repo.dir, "a.txt"), "utf-8")).toBe("a\n")
    expect(existsSync(path.join(repo.dir, "u.txt"))).toBe(false)
  })

  it("discards staged changes, deleting newly added files", async () => {
    repo.write("a.txt", "a\n")
    commitAll()
    repo.write("a.txt", "changed\n")
    repo.write("added.txt", "x\n")
    repo.git("add", "-A")
    expect(await actions.discardStaged(repo.dir, { files: ["a.txt", "added.txt"] })).toBe("Discarded 2 staged files")
    expect(readFileSync(path.join(repo.dir, "a.txt"), "utf-8")).toBe("a\n")
    expect(existsSync(path.join(repo.dir, "added.txt"))).toBe(false)
    expect((await getStatus(repo.dir)).files).toEqual([])
  })

  it("discards everything", async () => {
    repo.write("a.txt", "a\n")
    commitAll()
    repo.write("a.txt", "changed\n")
    repo.write("dir/u.txt", "u\n")
    await actions.discardAll(repo.dir, {})
    expect((await getStatus(repo.dir)).files).toEqual([])
  })
})
