import { execFileSync } from "child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createTempRepo, type TempRepo } from "../../../test/git-repo"
import { PUSH_REJECTED } from "@/lib/git/types"
import { HttpError } from "../http"
import { actions } from "./actions"
import { remoteGit } from "./exec"
import { getLog } from "./log"
import { getStatus } from "./status"

// `repo` (what Hunk acts on) and `other` (someone else's clone) share the
// bare `origin`, which starts with one commit on main.
let repo: TempRepo
let originDir: string
let otherDir: string

const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf-8" })
const other = (...args: string[]) => run(otherDir, ...args)
const read = (file: string) => readFileSync(path.join(repo.dir, file), "utf-8")

function commitAll(msg: string) {
  repo.git("add", "-A")
  repo.git("commit", "-q", "-m", msg)
  return repo.git("rev-parse", "HEAD").trim()
}

function otherCommit(file: string, content: string, msg: string) {
  writeFileSync(path.join(otherDir, file), content)
  other("add", "-A")
  other("commit", "-q", "-m", msg)
  other("push", "-q")
}

async function expectHttpError(p: Promise<unknown>, status: number, message?: RegExp) {
  const e = await p.then(() => null, (err: unknown) => err)
  expect(e).toBeInstanceOf(HttpError)
  expect((e as HttpError).status).toBe(status)
  if (message) expect((e as HttpError).message).toMatch(message)
}

beforeEach(() => {
  repo = createTempRepo()
  originDir = mkdtempSync(path.join(os.tmpdir(), "hunk-origin-"))
  run(originDir, "init", "-q", "--bare", "-b", "main")
  repo.write("a.txt", "1\n")
  commitAll("first")
  repo.git("remote", "add", "origin", originDir)
  repo.git("push", "-q", "-u", "origin", "main")
  otherDir = mkdtempSync(path.join(os.tmpdir(), "hunk-other-"))
  run(otherDir, "clone", "-q", originDir, ".")
})

afterEach(() => {
  repo.cleanup()
  rmSync(originDir, { recursive: true, force: true })
  rmSync(otherDir, { recursive: true, force: true })
})

describe("upstream status", () => {
  it("reports upstream, ahead and behind", async () => {
    expect(await getStatus(repo.dir)).toMatchObject({ upstream: "origin/main", ahead: 0, behind: 0 })
    repo.write("a.txt", "2\n")
    commitAll("local")
    otherCommit("b.txt", "b\n", "remote")
    expect(await getStatus(repo.dir)).toMatchObject({ ahead: 1, behind: 0 })
    expect(await actions.fetch(repo.dir, {})).toMatch(/1 new commit on origin\/main/)
    expect(await getStatus(repo.dir)).toMatchObject({ ahead: 1, behind: 1 })
  })

  it("has no upstream for a local-only branch, and reports HEAD", async () => {
    repo.git("switch", "-q", "-c", "local")
    const status = await getStatus(repo.dir)
    expect(status.upstream).toBeUndefined()
    expect(status.head).toBe(repo.git("rev-parse", "HEAD").trim())
  })
})

describe("fetch", () => {
  it("refuses without a remote", async () => {
    repo.git("remote", "remove", "origin")
    await expectHttpError(actions.fetch(repo.dir, {}), 400, /No remote/)
  })

  it("times out instead of hanging", async () => {
    // ext:: runs a command as the transport; `sleep` never answers.
    const p = remoteGit(repo.dir, ["-c", "protocol.ext.allow=always", "fetch", "ext::sleep 10"], { timeout: 300 })
    await expectHttpError(p, 504, /Timed out/)
  })
})

describe("pull", () => {
  it("fast-forwards", async () => {
    otherCommit("b.txt", "b\n", "remote 1")
    otherCommit("c.txt", "c\n", "remote 2")
    expect(await actions.pull(repo.dir, {})).toBe("Pulled 2 commits from origin/main")
    expect(read("c.txt")).toBe("c\n")
    expect(await actions.pull(repo.dir, {})).toMatch(/Already up to date/)
  })

  it("refuses a diverged branch, and rebases when asked", async () => {
    repo.write("a.txt", "local\n")
    commitAll("local")
    otherCommit("b.txt", "b\n", "remote")
    await expectHttpError(actions.pull(repo.dir, {}), 409, /diverged/)
    expect(await actions.pull(repo.dir, { rebase: true })).toMatch(/Rebased main onto origin\/main/)
    expect(repo.git("log", "--format=%s").trim().split("\n")).toEqual(["local", "remote", "first"])
  })

  it("refuses with uncommitted changes unless they're stashed", async () => {
    otherCommit("b.txt", "b\n", "remote")
    repo.write("a.txt", "dirty\n")
    await expectHttpError(actions.pull(repo.dir, {}), 409, /uncommitted changes/)
    expect(await actions.pull(repo.dir, { stash: true })).toMatch(/Pulled 1 commit/)
    expect(read("a.txt")).toBe("dirty\n")
    expect(read("b.txt")).toBe("b\n")
  })

  it("leaves a conflicted rebase in progress, which can be aborted", async () => {
    repo.write("a.txt", "local\n")
    const local = commitAll("local")
    otherCommit("a.txt", "remote\n", "remote")
    await expectHttpError(actions.pull(repo.dir, { rebase: true }), 409, /Rebase stopped on conflicts/)
    expect(await getStatus(repo.dir)).toMatchObject({ operation: "rebase", files: [{ path: "a.txt", status: "conflicted" }] })
    expect(await actions.abortOperation(repo.dir, {})).toBe("Aborted the rebase")
    expect(repo.git("rev-parse", "HEAD").trim()).toBe(local)
    expect((await getStatus(repo.dir)).operation).toBeUndefined()
  })

  it("refuses without an upstream", async () => {
    repo.git("switch", "-q", "-c", "local")
    await expectHttpError(actions.pull(repo.dir, {}), 400, /no upstream/)
  })
})

describe("push", () => {
  it("sets the upstream on the first push", async () => {
    repo.git("switch", "-q", "-c", "feat")
    expect(await actions.push(repo.dir, {})).toBeTruthy()
    expect((await getStatus(repo.dir)).upstream).toBe("origin/feat")
  })

  it("reports a rejected push, and force-pushes with a lease", async () => {
    otherCommit("b.txt", "b\n", "remote")
    repo.write("a.txt", "local\n")
    const local = commitAll("local")
    await expectHttpError(actions.push(repo.dir, {}), 409, new RegExp(`^${PUSH_REJECTED}`))
    // The lease is against origin/main as last fetched: stale, so refused…
    repo.git("fetch", "-q")
    otherCommit("c.txt", "c\n", "remote 2")
    await expectHttpError(actions.push(repo.dir, { force: true }), 409, /changed since your last fetch/)
    // …until we've seen what we'd overwrite.
    repo.git("fetch", "-q")
    await actions.push(repo.dir, { force: true })
    expect(run(originDir, "rev-parse", "main").trim()).toBe(local)
  })
})

describe("amend and undo", () => {
  it("amends the message, or keeps it when empty", async () => {
    repo.write("a.txt", "2\n")
    commitAll("second")
    expect(await actions.amend(repo.dir, { message: "second, reworded" })).toBe('Amended "second, reworded"')
    repo.write("b.txt", "b\n")
    repo.git("add", "b.txt")
    await actions.amend(repo.dir, {})
    expect(repo.git("log", "--format=%s").trim().split("\n")).toEqual(["second, reworded", "first"])
    expect(repo.git("show", "--name-only", "--format=", "HEAD").trim().split("\n")).toEqual(["a.txt", "b.txt"])
  })

  it("undoes the last commit, keeping its changes staged", async () => {
    repo.write("a.txt", "2\n")
    const second = commitAll("second")
    await expectHttpError(actions.undoCommit(repo.dir, { sha: "abcdef0" }), 409, /HEAD has moved/)
    expect(await actions.undoCommit(repo.dir, { sha: second })).toBe('Undid "second" — its changes are staged')
    expect((await getStatus(repo.dir)).files).toEqual([{ path: "a.txt", status: "modified", staged: true, oldPath: undefined }])
    await expectHttpError(actions.undoCommit(repo.dir, {}), 400, /first commit/)
  })
})

describe("revert and cherry-pick", () => {
  it("reverts a commit", async () => {
    repo.write("a.txt", "2\n")
    const second = commitAll("second")
    expect(await actions.revert(repo.dir, { sha: second })).toBe(`Reverted ${second.slice(0, 7)}`)
    expect(read("a.txt")).toBe("1\n")
    await expectHttpError(actions.revert(repo.dir, { sha: "HEAD" }), 400)
  })

  it("cherry-picks a commit from another branch, and refuses one already applied", async () => {
    repo.git("switch", "-q", "-c", "feat")
    repo.write("b.txt", "b\n")
    const feat = commitAll("feat")
    repo.git("switch", "-q", "main")
    expect(await actions.cherryPick(repo.dir, { sha: feat })).toBe(`Cherry-picked ${feat.slice(0, 7)} onto main`)
    expect(read("b.txt")).toBe("b\n")
    await expectHttpError(actions.cherryPick(repo.dir, { sha: feat }), 409, /already on this branch/)
    expect((await getStatus(repo.dir)).operation).toBeUndefined()
  })

  it("stops on conflicts; continue commits the resolution, abort restores", async () => {
    repo.git("switch", "-q", "-c", "feat")
    repo.write("a.txt", "feat\n")
    const feat = commitAll("feat")
    repo.git("switch", "-q", "main")
    repo.write("a.txt", "main\n")
    const main = commitAll("main")

    await expectHttpError(actions.cherryPick(repo.dir, { sha: feat }), 409, /stopped on conflicts/)
    expect((await getStatus(repo.dir)).operation).toBe("cherry-pick")
    await expectHttpError(actions.revert(repo.dir, { sha: main }), 409, /Finish or abort the cherry-pick/)
    await expectHttpError(actions.continueOperation(repo.dir, {}), 409, /Resolve every conflicted file/)
    expect(await actions.abortOperation(repo.dir, {})).toBe("Aborted the cherry-pick")
    expect(read("a.txt")).toBe("main\n")

    await expectHttpError(actions.cherryPick(repo.dir, { sha: feat }), 409)
    repo.write("a.txt", "resolved\n")
    repo.git("add", "a.txt")
    expect(await actions.continueOperation(repo.dir, {})).toBe("Continued the cherry-pick — done")
    expect(repo.git("log", "-1", "--format=%s").trim()).toBe("feat")
    expect(read("a.txt")).toBe("resolved\n")
  })

  it("refuses to continue or abort when nothing is in progress", async () => {
    await expectHttpError(actions.continueOperation(repo.dir, {}), 400)
    await expectHttpError(actions.abortOperation(repo.dir, {}), 400)
  })
})

describe("getLog of another branch", () => {
  it("lists a local or remote branch's commits, and rejects unknown ones", async () => {
    repo.git("switch", "-q", "-c", "feat")
    repo.write("b.txt", "b\n")
    commitAll("on feat")
    repo.git("switch", "-q", "main")
    otherCommit("c.txt", "c\n", "on origin")
    repo.git("fetch", "-q")

    expect((await getLog(repo.dir, { limit: 10, skip: 0 })).commits.map(c => c.subject)).toEqual(["first"])
    expect((await getLog(repo.dir, { ref: "feat", limit: 10, skip: 0 })).commits.map(c => c.subject)).toEqual(["on feat", "first"])
    expect((await getLog(repo.dir, { ref: "origin/main", limit: 10, skip: 0 })).commits.map(c => c.subject)).toEqual(["on origin", "first"])
    expect((await getLog(repo.dir, { ref: "feat", file: "b.txt", limit: 10, skip: 0 })).commits.map(c => c.subject)).toEqual(["on feat"])
    await expectHttpError(getLog(repo.dir, { ref: "nope", limit: 10, skip: 0 }), 400, /Unknown branch/)
    await expectHttpError(getLog(repo.dir, { ref: "--all", limit: 10, skip: 0 }), 400)
  })
})
