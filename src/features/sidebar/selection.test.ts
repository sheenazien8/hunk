import { describe, expect, it } from "vitest"
import { clickRow, emptySelection, pruneSelection, selectAll, selectRange, toggleRow, visiblePaths } from "./selection"
import { buildTree } from "./tree"

const tree = buildTree([
  { path: "a/x.ts", status: "" },
  { path: "a/y.ts", status: "" },
  { path: "b/z.ts", status: "" },
  { path: "r.md", status: "" },
])
const expanded = new Set(["a"])
const order = visiblePaths(tree, p => expanded.has(p))
const paths = (s: { paths: ReadonlySet<string> }) => [...s.paths]

describe("selection", () => {
  it("lists visible rows in display order", () => {
    expect(order).toEqual(["a", "a/x.ts", "a/y.ts", "b", "r.md"])
  })

  it("toggles rows, taking the last clicked row along", () => {
    let s = clickRow(emptySelection, "a/x.ts")
    expect(paths(s)).toEqual([])
    s = toggleRow(s, "r.md", order)
    expect(paths(s)).toEqual(["a/x.ts", "r.md"])
    s = toggleRow(s, "a/x.ts", order)
    expect(paths(s)).toEqual(["r.md"])
    expect(paths(toggleRow(emptySelection, "b", order))).toEqual(["b"])
  })

  it("selects ranges from the anchor in both directions", () => {
    let s = clickRow(emptySelection, "a/y.ts")
    s = selectRange(s, "r.md", order)
    expect(paths(s)).toEqual(["a/y.ts", "b", "r.md"])
    s = selectRange(s, "a", order)
    expect(paths(s)).toEqual(["a", "a/x.ts", "a/y.ts"])
    expect(paths(selectRange(emptySelection, "b", order))).toEqual(["b"])
  })

  it("selects all and prunes vanished paths", () => {
    const s = selectAll(emptySelection, order)
    expect(s.paths.size).toBe(5)
    const pruned = pruneSelection(s, p => p !== "b")
    expect(paths(pruned)).toEqual(["a", "a/x.ts", "a/y.ts", "r.md"])
    expect(pruneSelection(pruned, () => true)).toBe(pruned)
  })
})
