import { describe, expect, it } from "vitest"
import {
  countFilesUnder,
  existingPaths,
  joinPath,
  moveTargets,
  parentDir,
  remapPath,
  renameSelection,
  targetDir,
  topLevelPaths,
  validateMoveTarget,
  validateName,
} from "./file-ops"

const entries = [
  { path: "README.md", type: "file" },
  { path: "src", type: "dir" },
  { path: "src/a.ts", type: "file" },
  { path: "src/lib/b.ts", type: "file" },
  { path: "empty", type: "dir" },
]
const existing = existingPaths(entries)

describe("paths", () => {
  it("splits and joins", () => {
    expect(parentDir("src/lib/b.ts")).toBe("src/lib")
    expect(parentDir("README.md")).toBe("")
    expect(joinPath("", "x")).toBe("x")
    expect(joinPath("src", "x")).toBe("src/x")
  })

  it("remaps paths under a moved file or folder", () => {
    expect(remapPath("src/a.ts", "src/a.ts", "lib/a.ts")).toBe("lib/a.ts")
    expect(remapPath("src/lib/b.ts", "src", "app")).toBe("app/lib/b.ts")
    expect(remapPath("srcx/a.ts", "src", "app")).toBeNull()
  })

  it("picks the target dir", () => {
    expect(targetDir("empty", "src/a.ts")).toBe("empty")
    expect(targetDir("", "src/a.ts")).toBe("")
    expect(targetDir(null, "src/lib/b.ts")).toBe("src/lib")
    expect(targetDir(null, undefined)).toBe("")
  })
})

describe("validateName", () => {
  it("accepts new names, including nested ones", () => {
    expect(validateName("c.ts", { dir: "src", existing })).toBeNull()
    expect(validateName("new/deep/c.ts", { dir: "src", existing })).toBeNull()
    expect(validateName("lib/c.ts", { dir: "src", existing })).toBeNull()
  })

  it("rejects bad names", () => {
    expect(validateName("  ", { dir: "", existing })).toMatch(/required/)
    expect(validateName("/abs", { dir: "", existing })).toMatch(/start with/)
    expect(validateName("a//b", { dir: "", existing })).toMatch(/empty/)
    expect(validateName("a/", { dir: "", existing })).toMatch(/empty/)
    expect(validateName("../x", { dir: "src", existing })).toMatch(/\.\./)
    expect(validateName(".GIT/config", { dir: "", existing })).toMatch(/reserved/)
    expect(validateName("a.ts", { dir: "src", existing })).toMatch(/already exists/)
    expect(validateName("lib", { dir: "src", existing })).toMatch(/already exists/)
    expect(validateName("a.ts/x", { dir: "src", existing })).toMatch(/is a file/)
  })

  it("handles renames", () => {
    expect(validateName("a.ts", { dir: "src", existing, current: "src/a.ts" })).toBeNull()
    expect(validateName("lib/inner", { dir: "src", existing, current: "src/lib" })).toMatch(/into itself/)
  })
})

describe("misc", () => {
  it("counts files under a dir", () => {
    expect(countFilesUnder(entries, "src")).toBe(2)
    expect(countFilesUnder(entries, "empty")).toBe(0)
  })

  it("selects the base name for rename", () => {
    expect(renameSelection("button.test.tsx", false)).toEqual([0, 11])
    expect(renameSelection(".env", false)).toEqual([0, 4])
    expect(renameSelection("my.dir", true)).toEqual([0, 6])
  })
})

describe("moving several paths", () => {
  it("keeps only top-level paths", () => {
    expect(topLevelPaths(["src", "src/a.ts", "srcx", "src", "README.md"])).toEqual(["src", "srcx", "README.md"])
  })

  it("validates the destination folder", () => {
    expect(validateMoveTarget(["README.md", "src/a.ts"], "empty", existing)).toBeNull()
    expect(validateMoveTarget(["README.md"], "new/folder/", existing)).toBeNull()
    expect(validateMoveTarget(["src/a.ts"], "", existing)).toBeNull()
    expect(validateMoveTarget(["README.md"], "", existing)).toMatch(/Already in/)
    expect(validateMoveTarget(["src"], "src/lib", existing)).toMatch(/into itself/)
    expect(validateMoveTarget(["src/a.ts", "x/a.ts"], "empty", existing)).toMatch(/Two items/)
    expect(validateMoveTarget(["src/lib/b.ts"], "src", existing)).toBeNull()
    expect(validateMoveTarget(["README.md"], "README.md", existing)).toMatch(/is a file/)
    expect(validateMoveTarget(["README.md"], "../x", existing)).toMatch(/\.\./)
    expect(validateMoveTarget(["README.md"], ".git", existing)).toMatch(/reserved/)
    expect(validateMoveTarget(["empty"], "src", existingPaths([...entries, { path: "src/empty", type: "dir" }]))).toMatch(/already exists/)
  })

  it("maps moved paths, skipping ones already there", () => {
    expect(moveTargets(["src", "src/a.ts", "README.md", "empty/x"], "empty/")).toEqual([["src", "empty/src"], ["README.md", "empty/README.md"]])
  })
})
