// Pure zoom/pan math for the image viewer. Coordinates are relative to the
// viewport's center; the image is drawn centered, then offset by (x, y),
// rotated, and scaled.

export type Size = { w: number; h: number }
export type Point = { x: number; y: number }
export type ImageTransform = { scale: number; x: number; y: number; rotation: number }

export const MIN_SCALE = 0.02
export const MAX_SCALE = 32

// Stops for the zoom buttons and +/- keys; wheel and pinch zoom are continuous.
const ZOOM_STEPS = [0.02, 0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32]

const FIT_PADDING = 24

export function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function rotate(rotation: number, by: 90 | -90) {
  return (((rotation + by) % 360) + 360) % 360
}

export function rotatedSize(natural: Size, rotation: number): Size {
  return rotation % 180 === 0 ? natural : { w: natural.h, h: natural.w }
}

export function fitScale(natural: Size, box: Size, rotation: number) {
  const { w, h } = rotatedSize(natural, rotation)
  if (!w || !h || !box.w || !box.h) return 1
  const availW = Math.max(1, box.w - FIT_PADDING * 2)
  const availH = Math.max(1, box.h - FIT_PADDING * 2)
  return clampScale(Math.min(1, availW / w, availH / h))
}

export function fitTransform(natural: Size, box: Size, rotation: number): ImageTransform {
  return { scale: fitScale(natural, box, rotation), x: 0, y: 0, rotation }
}

export function stepScale(scale: number, dir: 1 | -1) {
  const next = dir > 0
    ? ZOOM_STEPS.find(s => s > scale + 1e-6)
    : [...ZOOM_STEPS].reverse().find(s => s < scale - 1e-6)
  return next ?? (dir > 0 ? MAX_SCALE : MIN_SCALE)
}

// Zoom to `scale` keeping the image point under `at` (viewport-center
// relative) where it is — so wheel/pinch zoom follows the cursor.
export function zoomAt(t: ImageTransform, scale: number, at: Point = { x: 0, y: 0 }): ImageTransform {
  const next = clampScale(scale)
  const ratio = next / t.scale
  return {
    ...t,
    scale: next,
    x: at.x - (at.x - t.x) * ratio,
    y: at.y - (at.y - t.y) * ratio,
  }
}

// Keep at least `margin` px of the image inside the box so it can't be
// panned out of sight; a smaller-than-box axis stays freely movable inside.
export function clampPan(t: ImageTransform, natural: Size, box: Size, margin = 48): ImageTransform {
  const { w, h } = rotatedSize(natural, t.rotation)
  const limitX = Math.max(0, (box.w + w * t.scale) / 2 - Math.min(margin, w * t.scale))
  const limitY = Math.max(0, (box.h + h * t.scale) / 2 - Math.min(margin, h * t.scale))
  return {
    ...t,
    x: Math.min(limitX, Math.max(-limitX, t.x)),
    y: Math.min(limitY, Math.max(-limitY, t.y)),
  }
}

// Continuous zoom factor for one wheel event (trackpad pinch arrives as a
// ctrl+wheel with small deltas, so both feel proportional).
export function wheelFactor(deltaY: number, deltaMode: number) {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-Math.max(-200, Math.min(200, px)) * 0.002)
}

export function formatPercent(scale: number) {
  const pct = scale * 100
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`
}
