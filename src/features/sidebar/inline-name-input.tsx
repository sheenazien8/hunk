import { type ReactNode, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

// An editable tree row (VS Code style) for naming a new file/folder or
// renaming one. Enter submits, Escape cancels; leaving the field submits a
// valid changed name and cancels otherwise. Keys and clicks stay inside so
// the row/tree/global shortcut handlers never see them.
export function InlineNameInput({ depth, icon, prefix, initial = "", selection, validate, onSubmit, onCancel }: {
  depth: number
  icon: ReactNode
  // Shown before the input (the target folder when it isn't visible in the tree).
  prefix?: string
  initial?: string
  // Range to pre-select (rename selects the base name without its extension).
  selection?: [number, number]
  validate: (name: string) => string | null
  // Resolves false to keep the input open (the action failed).
  onSubmit: (name: string) => Promise<boolean>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const [submitting, setSubmitting] = useState(false)
  // Sync mirror for the key/blur handlers of the render before the update.
  const submittingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const changed = value.trim() !== "" && value.trim() !== initial
  const error = changed ? validate(value) : null

  // Focus after mount: a context menu that just closed may still be moving
  // focus around in this tick.
  useEffect(() => {
    const t = setTimeout(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      if (selection) input.setSelectionRange(selection[0], selection[1])
    })
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus once on mount
  }, [])

  const submit = async () => {
    if (submittingRef.current) return
    if (!changed) {
      onCancel()
      return
    }
    if (error) return
    submittingRef.current = true
    setSubmitting(true)
    const ok = await onSubmit(value)
    if (!ok) {
      submittingRef.current = false
      setSubmitting(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div
      className="py-0.5 pr-1"
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        <span className="w-3.5 shrink-0" />
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        {prefix && <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{prefix}/</span>}
        <input
          ref={inputRef}
          value={value}
          readOnly={submitting}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!error}
          aria-label={initial ? "New name" : "Name"}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === "Enter") {
              e.preventDefault()
              void submit()
            } else if (e.key === "Escape") {
              e.preventDefault()
              onCancel()
            }
          }}
          onBlur={() => {
            if (submittingRef.current) return
            if (changed && !error) void submit()
            else onCancel()
          }}
          className={cn(
            "h-6 min-w-0 flex-1 rounded-sm border bg-background px-1.5 text-xs text-foreground outline-none focus:ring-1 read-only:opacity-60",
            error ? "border-destructive focus:ring-destructive" : "border-input focus:ring-ring"
          )}
        />
      </div>
      {error && <p className="mt-0.5 pl-9 text-[10px] leading-tight text-destructive">{error}</p>}
    </div>
  )
}
