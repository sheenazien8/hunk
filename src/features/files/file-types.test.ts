import { describe, expect, it } from "vitest"
import { isBinaryFile, isImageFile } from "./file-types"

describe("isImageFile", () => {
  it("accepts the previewable image extensions", () => {
    for (const file of ["a.png", "b.jpg", "c.jpeg", "d.gif", "e.webp", "f.bmp", "g.ico", "h.svg"]) {
      expect(isImageFile(file), file).toBe(true)
    }
  })

  it("is case-insensitive", () => {
    expect(isImageFile("LOGO.PNG")).toBe(true)
    expect(isImageFile("photo.Jpg")).toBe(true)
    expect(isImageFile("icon.SVG")).toBe(true)
  })

  it("rejects other binaries, text files and extensionless names", () => {
    for (const file of ["a.pdf", "a.zip", "a.mp4", "a.ts", "a.md", "a", "Makefile", "dir/file", "a.png.bak"]) {
      expect(isImageFile(file), file).toBe(false)
    }
  })

  it("keys on the whole extension, not a substring", () => {
    expect(isImageFile("a.pngx")).toBe(false)
    expect(isImageFile("a.svgz")).toBe(false)
  })
})

describe("isBinaryFile", () => {
  it("covers the raster image formats but not svg", () => {
    expect(isBinaryFile("a.png")).toBe(true)
    expect(isBinaryFile("a.jpg")).toBe(true)
    expect(isBinaryFile("a.ico")).toBe(true)
    expect(isBinaryFile("a.svg")).toBe(false)
    expect(isBinaryFile("a.svg")).not.toBe(isImageFile("a.svg"))
  })
})