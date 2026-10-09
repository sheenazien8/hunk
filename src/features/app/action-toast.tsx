import { useEffect } from "react"
import { CircleAlert, CircleCheck, X } from "lucide-react"
import type { ActionResult } from "@/features/changes/use-git-actions"
import { cn } from "@/lib/utils"

const SUCCESS_MS = 3000

// Bottom-left on desktop (clear of the agent prompt box), under the header on
// phones (clear of the floating Commit button): result of the last git action. Successes fade out on their own;
// failures stay until dismissed, since the message is often git's stderr.
export function ActionToast({ result, onDismiss }: { result: ActionResult | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!result?.ok) return
    const t = setTimeout(onDismiss, SUCCESS_MS)
    return () => clearTimeout(t)
  }, [result, onDismiss])

  if (!result) return null

  return (
    <div
      role={result.ok ? "status" : "alert"}
      className={cn(
        "fixed left-4 right-4 top-16 z-50 flex items-start gap-2 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg sm:bottom-4 sm:right-auto sm:top-auto sm:w-96",
        result.ok ? "border-border" : "border-destructive/50",
      )}
    >
      {result.ok
        ? <CircleCheck size={16} className="mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
        : <CircleAlert size={16} className="mt-0.5 shrink-0 text-destructive" />}
      <p className="max-h-40 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words">{result.message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <X size={14} />
      </button>
    </div>
  )
}
