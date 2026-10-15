import { describe, expect, it } from "vitest"
import { matchRanges, previewLine, searchPattern } from "./search-ranges"

function ranges(text: string, query: string, opts: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean } = {}) {
  const re = searchPattern({ query, ...opts })
  return re ? matchRanges(text, re) : null
}

describe("searchPattern / matchRanges", () => {
  it("matches literals case-insensitively by default", () => {
    expect(ranges("Foo foo (foo)", "foo")).toEqual([[0, 3], [4, 7], [9, 12]])
    expect(ranges("Foo foo", "foo", { caseSensitive: true })).toEqual([[4, 7]])
  })

  it("escapes regex characters in literal mode", () => {
    expect(ranges("a.b axb", "a.b")).toEqual([[0, 3]])
    expect(ranges("f(x) f(y)", "f(")).toEqual([[0, 2], [5, 7]])
  })

  it("supports regex and whole word", () => {
    expect(ranges("v1 v22 x", "v\\d+", { regex: true })).toEqual([[0, 2], [3, 6]])
    expect(ranges("cat concat cat_ cat.", "cat", { wholeWord: true })).toEqual([[0, 3], [16, 19]])
  })

  it("returns null for a regex JS can't compile and skips empty matches", () => {
    expect(searchPattern({ query: "a(", regex: true })).toBeNull()
    expect(ranges("abc", "x*", { regex: true })).toEqual([])
  })
})

describe("previewLine", () => {
  it("drops indentation and shifts ranges", () => {
    expect(previewLine("    foo bar", [[8, 11]])).toEqual({ text: "foo bar", ranges: [[4, 7]] })
  })

  it("cuts long lines around the first match", () => {
    const text = "x".repeat(100) + "hit" + "y".repeat(100)
    const out = previewLine(text, [[100, 103]], 50)
    expect(out.text).toBe("…" + "x".repeat(40) + "hit" + "y".repeat(7) + "…")
    expect(out.ranges).toEqual([[41, 44]])
  })

  it("keeps short lines whole", () => {
    expect(previewLine("a hit b", [[2, 5]])).toEqual({ text: "a hit b", ranges: [[2, 5]] })
  })
})
