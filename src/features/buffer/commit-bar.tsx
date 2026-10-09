import { Check, RefreshCw } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { ActionName } from "@/lib/git/types"

const inputCls = "rounded-md border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"

// Bar above the diff viewer: commit message + Amend + Commit. Lives near the
// staged diffs, so the commit action is in context. Shown only while something
// is staged (or a message / amend is in progress); it stays mounted when
// hidden so a typed message survives. Branch, ahead/behind and Push live in
// the header's branch picker and sync menu. On phones the bar becomes a
// floating "Commit (n)" button that opens a bottom sheet with the same state.
export function CommitBar({
  stagedCount,
  headSubject,
  busyAction,
  onCommit,
  onAmend,
}: {
  stagedCount: number
  headSubject?: string
  busyAction: ActionName | null
  onCommit: (message: string) => Promise<boolean>
  onAmend: (message: string) => Promise<boolean>
}) {
  const [message, setMessage] = useState("")
  const [amendOn, setAmendOn] = useState(false)
  // Phone bottom sheet.
  const [sheetOpen, setSheetOpen] = useState(false)
  const amend = amendOn && !!headSubject
  const canCommit = !busyAction && (amend || !!message.trim())
  const commit = async () => {
    if (!canCommit) return
    const ok = await (amend ? onAmend(message) : onCommit(message))
    if (ok) {
      setMessage("")
      setAmendOn(false)
      setSheetOpen(false)
    }
  }

  if (stagedCount === 0 && !amend && !message) return null

  const busyCommit = busyAction === "commit" || busyAction === "amend"
  const label = amend ? "Amend" : "Commit"

  return (
    <>
      <div className="mb-2 hidden shrink-0 items-center gap-2 rounded-md border border-border bg-card px-2 py-2 sm:flex sm:gap-3 sm:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {stagedCount > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{stagedCount} staged</span>}
          <div className="relative min-w-0 flex-1">
            <input
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  void commit()
                }
              }}
              placeholder={amend ? `Empty keeps "${headSubject}"` : "Commit message…"}
              className={cn(inputCls, "h-8 w-full pl-3 pr-16 placeholder:text-muted-foreground", amend && "ring-1 ring-primary")}
            />
            {headSubject && (
              <button
                type="button"
                aria-pressed={amend}
                onClick={() => setAmendOn(!amendOn)}
                title={amend ? "Stop amending — make a new commit" : `Amend the last commit ("${headSubject}") instead of making a new one`}
                className={cn(
                  "absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-ring",
                  amend ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                Amend
              </button>
            )}
          </div>
        </div>
        <Button type="button" size="sm" className="h-8 shrink-0 gap-1.5" disabled={!canCommit} onClick={() => void commit()}>
          {busyCommit ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
          {label}
        </Button>
      </div>

      <Button
        type="button"
        className="fixed bottom-4 right-4 z-40 h-11 gap-2 rounded-full px-5 shadow-lg sm:hidden"
        onClick={() => setSheetOpen(true)}
      >
        {busyCommit ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
        {label}
        {stagedCount > 0 && <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs tabular-nums">{stagedCount}</span>}
      </Button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="gap-3 rounded-t-xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden">
          <SheetHeader className="p-0">
            <SheetTitle>{amend ? "Amend last commit" : "Commit"}</SheetTitle>
            <SheetDescription>
              {stagedCount} staged file{stagedCount === 1 ? "" : "s"}
              {amend && headSubject ? ` · replacing "${headSubject}"` : ""}
            </SheetDescription>
          </SheetHeader>
          <textarea
            autoFocus
            rows={3}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={amend ? `Empty keeps "${headSubject}"` : "Commit message…"}
            className={cn(inputCls, "w-full resize-none px-3 py-2 text-base placeholder:text-muted-foreground")}
          />
          {headSubject && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={amend} onChange={e => setAmendOn(e.target.checked)} className="h-4 w-4 accent-primary" />
              <span className="min-w-0 truncate">Amend <span className="text-muted-foreground">&ldquo;{headSubject}&rdquo;</span></span>
            </label>
          )}
          <Button type="button" className="h-11 gap-2" disabled={!canCommit} onClick={() => void commit()}>
            {busyCommit ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
            {label}
          </Button>
        </SheetContent>
      </Sheet>
    </>
  )
}
