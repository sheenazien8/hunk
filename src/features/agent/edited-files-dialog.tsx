import { useState } from "react"
import { FileEdit } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { DiffView } from "@/features/viewer/diff-view"
import { unifiedDiff } from "@/lib/acp/line-diff"
import type { AgentEdit } from "@/lib/acp/transcript"
import { cn } from "@/lib/utils"

export type AgentEditRow = AgentEdit

const badge: Record<AgentEditRow["change"], { label: string; cls: string }> = {
  added: { label: "new", cls: "border-green-600/40 text-green-700 dark:text-green-400" },
  edited: { label: "edit", cls: "border-border text-muted-foreground" },
  deleted: { label: "del", cls: "border-destructive/40 text-destructive" },
  moved: { label: "move", cls: "border-border text-muted-foreground" },
}

// The list of files the agent changed in this session: rows expand into the
// combined before/after diff, with a shortcut to open the file as it is now.
export function EditedFilesDialog({ open, onOpenChange, repo, edits, onOpenFile }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  repo: string
  edits: AgentEditRow[]
  onOpenFile: (file: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = (path: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-2 p-4">
        <DialogTitle className="text-sm">
          Files the agent changed {edits.length > 0 && <span className="text-muted-foreground">({edits.length})</span>}
        </DialogTitle>
        {edits.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">The agent hasn&apos;t changed any file in this session.</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
            {edits.map(edit => {
              const isOpen = expanded.has(edit.path)
              const reveal = () => { onOpenFile(edit.path); onOpenChange(false) }
              return (
                <div key={edit.path} className="border-b border-border last:border-b-0">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggle(edit.path)}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") toggle(edit.path) }}
                    className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent"
                  >
                    <FileEdit size={12} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono" title={edit.path}>{edit.path}</span>
                    <span className={cn("shrink-0 rounded border px-1.5 text-[10px]", badge[edit.change].cls)}>{badge[edit.change].label}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-2 text-[10px]"
                      onClick={e => { e.stopPropagation(); reveal() }}
                    >
                      Open
                    </Button>
                  </div>
                  {isOpen && (
                    <div className="max-h-80 overflow-auto border border-border/60">
                      <DiffView
                        raw={unifiedDiff(edit.oldText, edit.newText)}
                        view="unified"
                        fullPath={`${repo}/${edit.path}`}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
