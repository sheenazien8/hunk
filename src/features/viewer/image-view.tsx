"use client"

/* eslint-disable @next/next/no-img-element -- repo bytes served by /api/git/raw,
rendered raw rather than through next/image's optimizer (it must not proxy,
process, or cache arbitrary repo files). */

import { type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import {
  ExternalLink,
  FileX,
  Grid2x2,
  Maximize,
  RotateCcw,
  RotateCw,
  Square,
  SquareDashed,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { basename } from "@/features/files/file-types"
import { api } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import {
  type ImageTransform,
  type Point,
  type Size,
  clampPan,
  fitTransform,
  formatPercent,
  rotate,
  stepScale,
  wheelFactor,
  zoomAt,
} from "./image-zoom"

export function BinaryPlaceholder({ file }: { file: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center text-muted-foreground">
      <FileX size={28} />
      <p className="mt-2 text-sm">{basename(file)}</p>
      <p className="text-sm">Can&apos;t preview this file</p>
    </div>
  )
}

type Backdrop = "checker" | "background" | "inverse"

const BACKDROPS: Backdrop[] = ["checker", "background", "inverse"]

const BACKDROP_LABEL: Record<Backdrop, string> = {
  checker: "Checkerboard background",
  background: "Theme background",
  inverse: "Inverted background",
}

const CHECKER_STYLE = {
  backgroundImage: "conic-gradient(var(--muted) 25%, var(--background) 0 50%, var(--muted) 0 75%, var(--background) 0)",
  backgroundSize: "16px 16px",
}

function ToolTip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  )
}

function ToolButton({ tip, onClick, disabled, children }: { tip: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <ToolTip tip={tip}>
      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={tip} onClick={onClick} disabled={disabled}>
        {children}
      </Button>
    </ToolTip>
  )
}

// svg goes through <img>, where its scripts can't execute.
//
// Zoom: wheel / pinch (at the cursor), +/- keys and buttons (stepped), double
// click toggles fit ↔ zoomed. Drag (or arrow keys) pans; 0 = fit, 1 = 1:1, r/R
// rotate. The view starts fitted and re-fits on resize until the user zooms.
export function ImageView({ repoPath, file }: { repoPath: string; file: string }) {
  const [failed, setFailed] = useState(false)
  const [natural, setNatural] = useState<Size | null>(null)
  const [box, setBox] = useState<Size>({ w: 0, h: 0 })
  const [rotation, setRotation] = useState(0)
  // null = fitted; otherwise the user's zoom and pan.
  const [zoom, setZoom] = useState<Omit<ImageTransform, "rotation"> | null>(null)
  const [backdrop, setBackdrop] = useState<Backdrop>("checker")
  const [dragging, setDragging] = useState(false)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, Point>())

  const size = natural ?? { w: 0, h: 0 }
  const t: ImageTransform = zoom ? { ...zoom, rotation } : fitTransform(size, box, rotation)
  const src = api.rawUrl(repoPath, file)

  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const update = useCallback((fn: (t: ImageTransform) => ImageTransform) => {
    if (!natural) return
    setZoom(prev => {
      const cur = prev ? { ...prev, rotation } : fitTransform(natural, box, rotation)
      const { scale, x, y } = clampPan(fn(cur), natural, box)
      return { scale, x, y }
    })
  }, [natural, box, rotation])

  const pointAt = useCallback((clientX: number, clientY: number): Point => {
    const r = surfaceRef.current!.getBoundingClientRect()
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 }
  }, [])

  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const at = pointAt(e.clientX, e.clientY)
      const factor = wheelFactor(e.deltaY, e.deltaMode)
      update(cur => zoomAt(cur, cur.scale * factor, at))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [update, pointAt])

  const fit = () => setZoom(null)
  const actualSize = (at?: Point) => update(cur => zoomAt(cur, 1, at))
  const step = (dir: 1 | -1) => update(cur => zoomAt(cur, stepScale(cur.scale, dir)))
  const pan = (dx: number, dy: number) => update(cur => ({ ...cur, x: cur.x + dx, y: cur.y + dy }))

  function turn(by: 90 | -90) {
    setRotation(r => rotate(r, by))
    setZoom(prev => prev && { ...prev, x: by > 0 ? -prev.y : prev.y, y: by > 0 ? prev.x : -prev.x })
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !natural) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setDragging(true)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const map = pointers.current
    const prev = map.get(e.pointerId)
    if (!prev) return
    const next = { x: e.clientX, y: e.clientY }
    if (map.size === 1) {
      map.set(e.pointerId, next)
      pan(next.x - prev.x, next.y - prev.y)
      return
    }
    const other = [...map.entries()].find(([id]) => id !== e.pointerId)?.[1]
    if (!other) return
    map.set(e.pointerId, next)
    const before = Math.hypot(prev.x - other.x, prev.y - other.y)
    const after = Math.hypot(next.x - other.x, next.y - other.y)
    if (!before) return
    const mid = pointAt((next.x + other.x) / 2, (next.y + other.y) / 2)
    const dx = (next.x - prev.x) / 2
    const dy = (next.y - prev.y) / 2
    update(cur => {
      const zoomed = zoomAt(cur, cur.scale * (after / before), mid)
      return { ...zoomed, x: zoomed.x + dx, y: zoomed.y + dy }
    })
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) setDragging(false)
  }

  function onDoubleClick(e: { clientX: number; clientY: number }) {
    if (zoom) return fit()
    const at = pointAt(e.clientX, e.clientY)
    update(cur => zoomAt(cur, cur.scale < 1 - 1e-6 ? 1 : cur.scale * 2, at))
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const PAN = e.shiftKey ? 200 : 50
    const handlers: Record<string, () => void> = {
      "+": () => step(1),
      "=": () => step(1),
      "-": () => step(-1),
      "_": () => step(-1),
      "0": fit,
      "1": () => actualSize(),
      r: () => turn(90),
      R: () => turn(-90),
      ArrowLeft: () => pan(PAN, 0),
      ArrowRight: () => pan(-PAN, 0),
      ArrowUp: () => pan(0, PAN),
      ArrowDown: () => pan(0, -PAN),
    }
    const handler = handlers[e.key]
    if (!handler) return
    e.preventDefault()
    handler()
  }

  if (failed) return <BinaryPlaceholder file={file} />

  const nextBackdrop = BACKDROPS[(BACKDROPS.indexOf(backdrop) + 1) % BACKDROPS.length]
  const BackdropIcon = backdrop === "checker" ? Grid2x2 : backdrop === "background" ? Square : SquareDashed

  return (
    <div className="relative h-full min-h-48 overflow-hidden">
      <div
        ref={surfaceRef}
        tabIndex={0}
        role="img"
        aria-label={`${basename(file)}, ${formatPercent(t.scale)}`}
        className={cn(
          "absolute inset-0 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          backdrop === "background" && "bg-background",
          backdrop === "inverse" && "bg-foreground",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={backdrop === "checker" ? CHECKER_STYLE : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        <img
          src={src}
          alt={basename(file)}
          className={cn("pointer-events-none absolute left-1/2 top-1/2 max-w-none", !natural && "invisible")}
          style={{
            width: natural ? natural.w : undefined,
            height: natural ? natural.h : undefined,
            transform: `translate(-50%, -50%) translate(${t.x}px, ${t.y}px) rotate(${t.rotation}deg) scale(${t.scale})`,
            imageRendering: t.scale >= 2 ? "pixelated" : "auto",
          }}
          onLoad={e => setNatural({ w: e.currentTarget.naturalWidth || 300, h: e.currentTarget.naturalHeight || 150 })}
          onError={() => setFailed(true)}
          draggable={false}
        />
      </div>

      {natural && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border bg-card/90 px-2 py-0.5 font-mono text-xs text-muted-foreground shadow-sm">
          {natural.w} × {natural.h}
        </div>
      )}

      <div
        role="toolbar"
        aria-label="Image controls"
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-card/95 p-1 text-foreground shadow-md backdrop-blur"
      >
        <ToolButton tip="Zoom out (-)" onClick={() => step(-1)} disabled={!natural}>
          <ZoomOut size={15} />
        </ToolButton>
        <ToolTip tip="Actual size (1)">
          <button
            type="button"
            className="h-7 min-w-14 rounded-md px-1.5 font-mono text-xs tabular-nums hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            onClick={() => actualSize()}
            disabled={!natural}
          >
            {formatPercent(t.scale)}
          </button>
        </ToolTip>
        <ToolButton tip="Zoom in (+)" onClick={() => step(1)} disabled={!natural}>
          <ZoomIn size={15} />
        </ToolButton>
        <ToolButton tip="Fit to view (0)" onClick={fit} disabled={!natural || !zoom}>
          <Maximize size={15} />
        </ToolButton>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <ToolButton tip="Rotate left (Shift+R)" onClick={() => turn(-90)} disabled={!natural}>
          <RotateCcw size={15} />
        </ToolButton>
        <ToolButton tip="Rotate right (R)" onClick={() => turn(90)} disabled={!natural}>
          <RotateCw size={15} />
        </ToolButton>
        <div className="mx-0.5 h-5 w-px bg-border" />
        <ToolButton tip={BACKDROP_LABEL[nextBackdrop]} onClick={() => setBackdrop(nextBackdrop)}>
          <BackdropIcon size={15} />
        </ToolButton>
        <ToolTip tip="Open in new tab">
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in new tab"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
          >
            <ExternalLink size={15} />
          </a>
        </ToolTip>
      </div>
    </div>
  )
}
