import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react"

// Open state for a hand-rolled popover: closes on a pointerdown outside
// `rootRef` or on Escape (which hands focus back to `triggerRef`).
export function usePopover<Root extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<Root>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [open])

  return { open, setOpen, rootRef, triggerRef }
}

// Arrow keys inside a popover list: move focus between its enabled
// [role=option] buttons, wrapping around; ArrowDown from the filter input
// enters the list. Put it on the popover's container `onKeyDown`.
export function moveOptionFocus(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)'))
  if (items.length === 0) return
  e.preventDefault()
  const step = e.key === "ArrowDown" ? 1 : -1
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next = i === -1 ? (step === 1 ? 0 : items.length - 1) : (i + step + items.length) % items.length
  items[next].focus()
}
