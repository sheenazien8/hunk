import { describe, expect, it } from "vitest"
import { base64Bytes, capUpdateImages, imagePlaceholder, sniffImageType } from "./images"

describe("images", () => {
  it("measures decoded base64", () => {
    expect(base64Bytes(Buffer.from("abcd").toString("base64"))).toBe(4)
    expect(base64Bytes(Buffer.from("abcde").toString("base64"))).toBe(5)
    expect(base64Bytes(Buffer.from("abcdef").toString("base64"))).toBe(6)
  })

  it("sniffs the type from the bytes", () => {
    expect(sniffImageType(Buffer.from("GIF89a"))).toBe("image/gif")
    expect(sniffImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp")
    expect(sniffImageType(Buffer.from("<svg"))).toBeNull()
  })

  it("caps oversized images in tool call content too", () => {
    const big = { type: "image" as const, mimeType: "image/png", data: "A".repeat(8 * 1024 * 1024) }
    const small = { type: "image" as const, mimeType: "image/png", data: "AAAA" }
    const u = capUpdateImages({ sessionUpdate: "tool_call", toolCallId: "t", title: "Shot", content: [{ type: "content", content: big }, { type: "content", content: small }] })
    expect(u).toMatchObject({ content: [{ content: { type: "text", text: imagePlaceholder("image/png", big.data, "too large to show") } }, { content: small }] })
  })
})
