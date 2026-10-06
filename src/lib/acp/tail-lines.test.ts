import { describe, expect, it } from "vitest"
import { cleanLine, emptyTail, tailAppend, tailLines } from "./tail-lines"

const numbers = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i))

describe("tail lines", () => {
  it("keeps short output whole", () => {
    const t = tailAppend(emptyTail(), "a\nb\n")
    expect(tailLines(t)).toEqual({ lines: ["a", "b"], dropped: 0 })
  })

  it("keeps the last 150 lines and counts the rest", () => {
    const t = tailAppend(emptyTail(), numbers(1, 1000).join("\n") + "\n")
    expect(tailLines(t)).toEqual({ lines: numbers(851, 1000), dropped: 850 })
  })

  it("joins lines split across chunks", () => {
    let t = emptyTail()
    for (const chunk of ["he", "llo\nwor", "ld\n", "par"]) t = tailAppend(t, chunk)
    expect(t.lines).toEqual(["hello", "world"])
    expect(tailLines(t).lines).toEqual(["hello", "world", "par"])
  })

  it("counts drops across many small chunks", () => {
    let t = emptyTail()
    for (const n of numbers(1, 400)) t = tailAppend(t, n + "\n")
    expect(tailLines(t)).toEqual({ lines: numbers(251, 400), dropped: 250 })
  })

  it("includes the unfinished line within the limit", () => {
    const t = tailAppend(emptyTail(), numbers(1, 150).join("\n") + "\nlast")
    expect(tailLines(t)).toEqual({ lines: [...numbers(2, 150), "last"], dropped: 1 })
  })

  it("cleans lines like a terminal would", () => {
    expect(cleanLine("\x1b[31mred\x1b[0m")).toBe("red")
    expect(cleanLine("10%\r50%\r100%")).toBe("100%")
    expect(cleanLine("crlf\r")).toBe("crlf")
    expect(cleanLine("x".repeat(3000))).toHaveLength(2001)
  })
})
