import { describe, expect, it } from "vitest"
import { parseBranchHeader, parseStatus } from "./parse-status"

describe("parseStatus", () => {
  it("splits files with staged and unstaged changes into two entries", () => {
    expect(parseStatus("MM src/a.ts\n")).toEqual([
      { path: "src/a.ts", status: "modified", staged: true, oldPath: undefined },
      { path: "src/a.ts", status: "modified", staged: false, oldPath: undefined },
    ])
  })

  it("maps index and worktree codes", () => {
    const files = parseStatus("A  new.ts\nD  gone.ts\n D wt-gone.ts\n M wt.ts\nC  copy.ts\n?? untracked.ts\n")
    expect(files.map(f => [f.path, f.status, f.staged])).toEqual([
      ["new.ts", "added", true],
      ["gone.ts", "deleted", true],
      ["wt-gone.ts", "deleted", false],
      ["wt.ts", "modified", false],
      ["copy.ts", "added", true],
      ["untracked.ts", "untracked", false],
    ])
  })

  it("keeps the rename source only on the side that carries the rename", () => {
    expect(parseStatus("RM old.ts -> new.ts\n")).toEqual([
      { path: "new.ts", status: "renamed", staged: true, oldPath: "old.ts" },
      { path: "new.ts", status: "modified", staged: false, oldPath: undefined },
    ])
  })

  it("ignores blank lines", () => {
    expect(parseStatus("")).toEqual([])
  })
})

describe("parseStatus conflicts", () => {
  it("reports unmerged paths once, as conflicted and unstaged", () => {
    expect(parseStatus("UU both.txt\nAA added.txt\nDU deleted-by-us.txt\nM  staged.txt\n")).toEqual([
      { path: "both.txt", status: "conflicted", staged: false },
      { path: "added.txt", status: "conflicted", staged: false },
      { path: "deleted-by-us.txt", status: "conflicted", staged: false },
      { path: "staged.txt", status: "modified", staged: true, oldPath: undefined },
    ])
  })
})

describe("parseBranchHeader", () => {
  it("reads upstream and ahead/behind counts", () => {
    expect(parseBranchHeader("## main...origin/main [ahead 1, behind 2]\n M a.ts\n")).toEqual({ upstream: "origin/main", ahead: 1, behind: 2 })
    expect(parseBranchHeader("## feat/x...origin/feat/x [behind 3]\n")).toEqual({ upstream: "origin/feat/x", ahead: 0, behind: 3 })
    expect(parseBranchHeader("## main...origin/main\n")).toEqual({ upstream: "origin/main", ahead: 0, behind: 0 })
  })

  it("flags an upstream deleted on the remote", () => {
    expect(parseBranchHeader("## main...origin/main [gone]\n")).toEqual({ upstream: "origin/main", ahead: 0, behind: 0, gone: true })
  })

  it("has no upstream for local-only, unborn and detached HEADs", () => {
    for (const line of ["## main", "## No commits yet on main", "## HEAD (no branch)", ""]) {
      expect(parseBranchHeader(line)).toEqual({ ahead: 0, behind: 0 })
    }
  })

  it("is skipped by parseStatus", () => {
    expect(parseStatus("## main...origin/main [ahead 1]\n?? a.ts\n")).toEqual([{ path: "a.ts", status: "untracked", staged: false }])
  })
})
