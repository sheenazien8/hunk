import { useCallback, useEffect, useRef, useState } from "react"

// Copies text, falling back to a hidden textarea + execCommand in
// contexts where the async Clipboard API is unavailable (non-secure origin).
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand("copy")
    } catch {
      // nothing else we can do
    }
    document.body.removeChild(ta)
  }
}

// Tracks which line was just copied ("view-row" key) so the UI can flash a
// checkmark on it for a moment. Shared by every view type.
function useCopied() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markCopied = useCallback((key: string) => {
    setCopiedKey(key)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopiedKey(null), 1500)
  }, [])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return { copiedKey, markCopied }
}

// Tooltip text describing what the next click will copy.
export function copyTitleFor(fullPath: string, anchor: number | null, lineNo: number) {
  if (!fullPath) return undefined
  if (anchor === null) return `Copy ${fullPath}:${lineNo} (click twice for a range)`
  if (anchor === lineNo) return `Copy ${fullPath}:${lineNo}`
  return `Copy ${fullPath}:${Math.min(anchor, lineNo)}-${Math.max(anchor, lineNo)}`
}

// Shared "click twice to copy a path:line range" behavior, used by every
// view type. The first click anchors a line; a second click on another line
// copies "<fullPath>:<min>-<max>" while a second click on the anchored line
// copies just "<fullPath>:<line>". Escape cancels a pending anchor, and
// hovering after the first click previews the highlighted range.
export function useCopyRange(fullPath: string) {
  const { copiedKey, markCopied } = useCopied()
  // The anchor carries the path it was set on, so switching files (or repos)
  // simply invalidates a stale anchor during render — no effect needed.
  const [anchorState, setAnchorState] = useState<{ path: string; line: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const anchor = anchorState && anchorState.path === fullPath ? anchorState.line : null

  useEffect(() => {
    if (anchor === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAnchorState(null)
        setHover(null)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [anchor])

  const click = useCallback((lineNo: number | undefined, key: string) => {
    // Clicks that are part of a text selection are ignored so copy behaves
    // like an editor gutter action.
    if (window.getSelection()?.toString()) return
    if (!fullPath || lineNo == null) return
    if (anchor === null) {
      setAnchorState({ path: fullPath, line: lineNo })
      return
    }
    if (anchor !== lineNo) {
      copyText(`${fullPath}:${Math.min(anchor, lineNo)}-${Math.max(anchor, lineNo)}`)
    } else {
      copyText(`${fullPath}:${lineNo}`)
    }
    markCopied(key)
    setAnchorState(null)
  }, [fullPath, anchor, markCopied])

  const rangePreview =
    anchor != null && hover != null && hover !== anchor
      ? ([Math.min(anchor, hover), Math.max(anchor, hover)] as const)
      : null

  return { copiedKey, anchor, click, rangePreview, setHover }
}
