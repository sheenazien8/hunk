import { useState } from "react"
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ActionName } from "@/lib/git/types"
import { isDiscardAction } from "./use-git-actions"

// Open flag + the value the dialog is about. The value is kept after closing
// so the content doesn't blank out during the close animation.
export function useDialog<T>() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<T | null>(null)
  const show = (v: T) => {
    setValue(v)
    setOpen(true)
  }
  return { open, setOpen, value, show }
}

export type DiscardKind = "discard" | "discardAll" | "discardStaged"

export interface DiscardRequest {
  action: DiscardKind
  files?: string[]
}

function discardCopy({ action, files }: DiscardRequest) {
  const s = files && files.length > 1 ? "s" : ""
  switch (action) {
    case "discardAll":
      return {
        title: "Discard all changes",
        description: "This will revert all modified tracked files and remove all untracked files and directories. This action cannot be undone.",
      }
    case "discardStaged":
      return {
        title: "Discard staged changes",
        description: `Are you sure you want to unstage and revert the selected file${s}? This action cannot be undone.`,
      }
    case "discard":
      return {
        title: "Discard changes",
        description: `Are you sure you want to discard changes to the selected file${s}? This action cannot be undone.`,
      }
  }
}

function Spinner() {
  return <RefreshCw size={14} className="animate-spin mr-2" />
}

// What the delete dialog is about: top-level paths (a folder covers what's
// inside it), how many of them are folders, the files they hold and how many
// of those have uncommitted changes.
export interface DeleteRequest {
  paths: string[]
  dirCount: number
  fileCount: number
  changedCount: number
}

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

export function DeletePathDialog({ open, onOpenChange, request, busy, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: DeleteRequest | null
  busy: boolean
  onConfirm: () => void
}) {
  const paths = request?.paths ?? []
  const single = paths.length === 1
  const isDir = single && request?.dirCount === 1
  const title = single ? (isDir ? "Delete Folder" : "Delete File") : `Delete ${paths.length} Items`
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {single ? (
              <>
                Are you sure you want to delete <code className="bg-muted px-1 rounded break-all">{paths[0]}{isDir ? "/" : ""}</code>
                {isDir && request && (request.fileCount > 0 ? <> and the {plural(request.fileCount, "file")} in it</> : " (empty)")}?
              </>
            ) : (
              <>
                Are you sure you want to delete these {paths.length} items
                {request && request.dirCount > 0 && <> ({plural(request.dirCount, "folder")}, {plural(request.fileCount, "file")} in all)</>}?
              </>
            )}{" "}
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {!single && (
          <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
            {paths.map(p => <li key={p} className="truncate" title={p}>{p}</li>)}
          </ul>
        )}
        {request && request.changedCount > 0 && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {single && !isDir
              ? "It has uncommitted changes that will be lost."
              : `${plural(request.changedCount, "file")} ${request.changedCount === 1 ? "has" : "have"} uncommitted changes that will be lost.`}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner /> : <Trash2 size={14} className="mr-2" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DiscardDialog({ open, onOpenChange, request, busyAction, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: DiscardRequest | null
  busyAction: ActionName | null
  onConfirm: () => void
}) {
  const copy = request ? discardCopy(request) : null
  const busy = isDiscardAction(busyAction)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{copy?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner /> : <RotateCcw size={14} className="mr-2" />}
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
