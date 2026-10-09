import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const OPEN_KEY = "hunk-agent-open"
const WIDTH_KEY = "hunk-agent-width"
const DESKTOP_QUERY = "(min-width: 768px)"
const MIN_WIDTH = 320
const MAX_WIDTH = 1200
const DEFAULT_WIDTH = 448
// Leave the viewer at least this much room.
const MAX_VIEWPORT_SHARE = 0.7

export function clampAgentWidth(w: number, viewport = Infinity) {
  const max = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(viewport * MAX_VIEWPORT_SHARE)))
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(w)))
}

function subscribeDesktop(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}

// Desktop: a right-hand aside whose open state is persisted. Mobile: a
// full-screen sheet that always starts closed. `visible` is whichever
// applies to the current viewport.
export function useAgentPanel() {
  const isDesktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP_QUERY).matches, () => true)
  const [open, setOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    try {
      /* eslint-disable react-hooks/set-state-in-effect -- restoring persisted UI state after hydration; SSR renders the defaults */
      if (localStorage.getItem(OPEN_KEY) === "true") setOpen(true)
      const stored = parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10)
      if (!Number.isNaN(stored)) setWidth(clampAgentWidth(stored, window.innerWidth))
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {}
  }, [])

  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    try {
      localStorage.setItem(OPEN_KEY, String(open))
    } catch {}
  }, [open])

  const toggle = useCallback(() => {
    if (window.matchMedia(DESKTOP_QUERY).matches) setOpen(o => !o)
    else setMobileOpen(o => !o)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setMobileOpen(false)
  }, [])

  const show = useCallback(() => {
    if (window.matchMedia(DESKTOP_QUERY).matches) setOpen(true)
    else setMobileOpen(true)
  }, [])

  // Drag the panel's left edge: moving left widens it. Clamped, persisted on
  // release.
  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    let current = startWidth
    setIsResizing(true)
    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"
    const onMove = (ev: PointerEvent) => {
      current = clampAgentWidth(startWidth + startX - ev.clientX, window.innerWidth)
      setWidth(current)
    }
    const onUp = () => {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onUp)
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      setIsResizing(false)
      try {
        localStorage.setItem(WIDTH_KEY, String(current))
      } catch {}
    }
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerup", onUp)
  }, [width])

  const resetWidth = useCallback(() => {
    setWidth(DEFAULT_WIDTH)
    try {
      localStorage.removeItem(WIDTH_KEY)
    } catch {}
  }, [])

  return {
    isDesktop, open, mobileOpen, setMobileOpen, visible: isDesktop ? open : mobileOpen, toggle, close, show,
    width, isResizing, startResize, resetWidth,
  }
}

export type AgentPanelState = ReturnType<typeof useAgentPanel>

// `render` gets the callback to run after opening a file from the chat
// (closes the mobile sheet so the file is visible).
export function AgentFrame({ panel, render }: {
  panel: AgentPanelState
  render: (onNavigate: () => void) => ReactNode
}) {
  if (panel.isDesktop) {
    if (!panel.open) return null
    return (
      <>
        {/* Drag handle: resize the agent panel (double-click resets width) */}
        <div
          onPointerDown={panel.startResize}
          onDoubleClick={panel.resetWidth}
          title="Drag to resize · double-click to reset"
          className={cn(
            "w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-ring",
            panel.isResizing && "bg-ring"
          )}
        />
        <aside className="flex max-w-[70vw] shrink-0 flex-col" style={{ width: panel.width }}>
          {render(() => {})}
        </aside>
      </>
    )
  }
  return (
    <Sheet open={panel.mobileOpen} onOpenChange={panel.setMobileOpen}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-md">
        <SheetTitle className="sr-only">Agent</SheetTitle>
        <SheetDescription className="sr-only">Chat with the coding agent</SheetDescription>
        {render(() => panel.setMobileOpen(false))}
      </SheetContent>
    </Sheet>
  )
}
