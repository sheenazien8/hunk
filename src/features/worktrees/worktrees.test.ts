import { describe, expect, it } from "vitest"
import type { Worktree } from "@/lib/git/types"
import { defaultWorktreePath, findWorktree, tailPath, worktreeLabel } from "./worktrees"

const wt = (over: Partial<Worktree>): Worktree => ({
  path: "/code/app", head: "0123456789abcdef", main: false, detached: false, bare: false, locked: false, prunable: false, ...over,
})

describe("defaultWorktreePath", () => {
  it("puts the worktree next to the main one, slugging the branch", () => {
    expect(defaultWorktreePath("/code/app", "feat/login")).toBe("/code/app-feat-login")
    expect(defaultWorktreePath("/code/app/", "fix #12")).toBe("/code/app-fix-12")
    expect(defaultWorktreePath("/code/app", "")).toBe("/code/app")
  })
})

describe("findWorktree", () => {
  it("ignores trailing slashes", () => {
    const list = [wt({ path: "/code/app", main: true }), wt({ path: "/code/app-x" })]
    expect(findWorktree(list, "/code/app-x/")).toBe(list[1])
    expect(findWorktree(list, "/code/other")).toBeUndefined()
  })
})

describe("worktreeLabel", () => {
  it("labels main, branch, detached and missing worktrees", () => {
    expect(worktreeLabel(wt({ branch: "main", main: true }))).toBe("main (main)")
    expect(worktreeLabel(wt({ branch: "feat" }))).toBe("feat")
    expect(worktreeLabel(wt({ detached: true }))).toBe("detached @ 0123456")
    expect(worktreeLabel(wt({ branch: "gone", prunable: true }))).toBe("gone (missing)")
  })
})

describe("tailPath", () => {
  it("keeps the last segments", () => {
    expect(tailPath("/mnt/storage/code/app-feat")).toBe("…/code/app-feat")
    expect(tailPath("/mnt/storage/code/app/", 1)).toBe("…/app")
  })

  it("leaves short paths alone", () => {
    expect(tailPath("/code/app")).toBe("/code/app")
    expect(tailPath("/")).toBe("/")
  })
})
