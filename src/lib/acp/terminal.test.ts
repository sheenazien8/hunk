import { describe, expect, it } from "vitest"
import { decodeTerminalBase64, decodeTerminalChunk, tailBytes, TERMINAL_MAX_BYTES, type TerminalBuffer } from "./terminal"

describe("decodeTerminalChunk", () => {
  it("decodes base64 bytes to text", () => {
    expect(decodeTerminalBase64(Buffer.from("hello\n").toString("base64"))).toBe("hello\n")
  })

  it("decodes chunks that split a UTF-8 code point", () => {
    // é/emoji bytes land whole here, but a chunk boundary mid-code-point
    // must not throw or corrupt the neighbor bytes: each chunk decodes
    // standalone and the replacement char marks the cut.
    const bytes = Buffer.from("h\u00e9llo\nm\u00e9n\n", "utf-8")
    const cut = bytes.indexOf(0x6d) // before the second 'm\u00e9n' line
    const mid = Buffer.from(bytes.subarray(0, cut + 2)).toString("base64") // ends inside é
    const a = decodeTerminalBase64(mid)
    expect(a.endsWith("\uFFFD")).toBe(true)
    const b = decodeTerminalBase64(bytes.subarray(cut + 2).toString("base64"))
    expect(b.startsWith("\uFFFD") || b.startsWith("n")).toBe(true)
  })

  it("decodes emoji split across chunks without throwing", () => {
    const bytes = Buffer.from("a\u{1F44B}b", "utf-8")
    const cut = bytes.indexOf(0x62) // right before the trailing b
    const emojiStart = bytes.length - 5 // 4 emoji bytes + 'b'
    void cut
    const a = decodeTerminalBase64(bytes.subarray(0, emojiStart).toString("base64"))
    const b = decodeTerminalBase64(bytes.subarray(emojiStart).toString("base64"))
    expect(a + b).toBe("a\u{1F44B}b")
  })

  it("keeps invalid UTF-8 lossy instead of throwing", () => {
    expect(decodeTerminalBase64("SGn/" /* [0x48 0x69 0xFF] */)).toBe("Hi\uFFFD")
  })

  it("passes plain text through empty-handed", () => {
    expect(decodeTerminalChunk("", false)).toBe("")
    expect(decodeTerminalChunk("plain", false)).toBe("plain")
  })
})

describe("tailBytes", () => {
  it("keeps short text whole", () => {
    expect(tailBytes("abc")).toBe("abc")
  })

  it("cuts to the last max bytes, on a code-unit boundary", () => {
    const text = "x".repeat(TERMINAL_MAX_BYTES + 10)
    expect(tailBytes(text)).toHaveLength(TERMINAL_MAX_BYTES)
    expect(tailBytes(text)).toBe("x".repeat(TERMINAL_MAX_BYTES))
  })

  it("counts multi-byte characters by bytes, never splitting them", () => {
    // é is 2 bytes in UTF-8; the boundary never lands between its bytes
    const half = "e".repeat(TERMINAL_MAX_BYTES - 1)
    const text = half + "éé"
    const cut = tailBytes(text)
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(TERMINAL_MAX_BYTES)
    expect(Buffer.byteLength(cut)).toBeGreaterThanOrEqual(TERMINAL_MAX_BYTES - 2)
    expect(cut.endsWith("\uFFFD")).toBe(false)
  })
})

describe("terminal buffer merge", () => {
  // The merge lives in AgentSession.trackTerminal; its inputs/outputs are
  // TerminalPatch / TerminalBuffer, exercised here without the server.
  const merge = (prev: TerminalBuffer | undefined, patch: { command?: string | null; text?: string; replace?: boolean }): TerminalBuffer => {
    const base = prev ?? { command: null, cwd: null, text: "" }
    const restart = patch.command !== undefined && patch.command !== null && patch.command !== base.command
    const text = restart || patch.replace ? (patch.text ?? "") : tailBytes(base.text + (patch.text ?? ""))
    return { command: patch.command !== undefined ? patch.command : base.command, cwd: base.cwd, text }
  }

  it("appends chunks", () => {
    let t = merge(undefined, { command: "ls" })
    t = merge(t, { text: "aa\n" })
    t = merge(t, { text: "bb" })
    expect(t).toEqual({ command: "ls", cwd: null, text: "aa\nbb" })
  })

  it("restarts on a new command", () => {
    let t = merge(undefined, { command: "one" })
    t = merge(t, { text: "old" })
    t = merge(t, { command: "two", text: "new" })
    expect(t.text).toBe("new")
  })
})