import { describe, expect, it } from "vitest"
import {
  MAX_SCALE,
  MIN_SCALE,
  clampPan,
  fitScale,
  formatPercent,
  rotate,
  rotatedSize,
  stepScale,
  wheelFactor,
  zoomAt,
} from "./image-zoom"

describe("rotate", () => {
  it("wraps both ways", () => {
    expect(rotate(270, 90)).toBe(0)
    expect(rotate(0, -90)).toBe(270)
  })
})

describe("fitScale", () => {
  it("never upscales a small image", () => {
    expect(fitScale({ w: 100, h: 100 }, { w: 1000, h: 1000 }, 0)).toBe(1)
  })

  it("fits the limiting axis, minus padding", () => {
    expect(fitScale({ w: 2000, h: 500 }, { w: 1048, h: 1048 }, 0)).toBe(0.5)
  })

  it("uses swapped dimensions when rotated", () => {
    expect(rotatedSize({ w: 2000, h: 500 }, 90)).toEqual({ w: 500, h: 2000 })
    expect(fitScale({ w: 2000, h: 500 }, { w: 1048, h: 1048 }, 90)).toBe(0.5)
    expect(fitScale({ w: 2000, h: 500 }, { w: 2048, h: 548 }, 90)).toBe(0.25)
  })

  it("is 1 before sizes are known", () => {
    expect(fitScale({ w: 0, h: 0 }, { w: 500, h: 500 }, 0)).toBe(1)
  })
})

describe("stepScale", () => {
  it("moves to the next stop", () => {
    expect(stepScale(1, 1)).toBe(1.25)
    expect(stepScale(1, -1)).toBe(0.75)
    expect(stepScale(0.8, 1)).toBe(1)
    expect(stepScale(0.8, -1)).toBe(0.75)
  })

  it("stops at the limits", () => {
    expect(stepScale(MAX_SCALE, 1)).toBe(MAX_SCALE)
    expect(stepScale(MIN_SCALE, -1)).toBe(MIN_SCALE)
  })
})

describe("zoomAt", () => {
  it("keeps the point under the cursor fixed", () => {
    const t = { scale: 1, x: 10, y: -20, rotation: 0 }
    const at = { x: 100, y: 50 }
    const next = zoomAt(t, 2, at)
    // image-space point under the cursor before and after
    expect((at.x - t.x) / t.scale).toBeCloseTo((at.x - next.x) / next.scale)
    expect((at.y - t.y) / t.scale).toBeCloseTo((at.y - next.y) / next.scale)
  })

  it("zooms about the center by default and clamps the scale", () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0, rotation: 0 }, 1000)).toEqual({ scale: MAX_SCALE, x: 0, y: 0, rotation: 0 })
  })
})

describe("clampPan", () => {
  it("keeps part of the image on screen", () => {
    const t = clampPan({ scale: 1, x: 5000, y: -5000, rotation: 0 }, { w: 200, h: 100 }, { w: 400, h: 400 })
    // half box + half image - margin
    expect(t.x).toBe(200 + 100 - 48)
    expect(t.y).toBe(-(200 + 50 - 48))
  })

  it("leaves in-range offsets alone", () => {
    const t = { scale: 1, x: 30, y: 40, rotation: 0 }
    expect(clampPan(t, { w: 200, h: 100 }, { w: 400, h: 400 })).toEqual(t)
  })
})

describe("wheelFactor", () => {
  it("zooms in on scroll up and out on scroll down", () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1)
    expect(wheelFactor(100, 0)).toBeLessThan(1)
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0))
  })
})

describe("formatPercent", () => {
  it("rounds, with a decimal below 10%", () => {
    expect(formatPercent(1)).toBe("100%")
    expect(formatPercent(0.666)).toBe("67%")
    expect(formatPercent(0.05)).toBe("5.0%")
  })
})
