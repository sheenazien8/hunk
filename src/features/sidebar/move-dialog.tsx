import { useId, useState } from "react"
import { FolderInput } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { baseName, topLevelPaths, validateMoveTarget } from "./file-ops"

// Moves files/folders into another folder. The destination is typed (with
// the repo's folders as suggestions); a folder that doesn't exist is created.
export function MoveDialog({ open, onOpenChange, paths, folders, existing, busy, onMove }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  paths: string[] | null
  folders: string[]
  existing: ReadonlySet<string>
  busy: boolean
  onMove: (paths: string[], dest: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        {/* Remount per request so the input starts empty. */}
        {paths && <MoveForm key={paths.join("\n")} paths={paths} folders={folders} existing={existing} busy={busy} onMove={onMove} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function MoveForm({ paths, folders, existing, busy, onMove, onCancel }: {
  paths: string[]
  folders: string[]
  existing: ReadonlySet<string>
  busy: boolean
  onMove: (paths: string[], dest: string) => void
  onCancel: () => void
}) {
  const [dest, setDest] = useState("")
  const [touched, setTouched] = useState(false)
  const listId = useId()
  const top = topLevelPaths(paths)
  const error = validateMoveTarget(top, dest, existing)
  const dir = dest.trim().replace(/\/+$/, "")
  const newFolder = dir !== "" && !existing.has(dir)
  // Don't suggest moving folders into themselves.
  const suggestions = folders.filter(f => !top.some(p => f === p || f.startsWith(p + "/")))

  const submit = () => {
    setTouched(true)
    if (!error && !busy) onMove(top, dir)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move {top.length === 1 ? baseName(top[0]) : `${top.length} Items`}</DialogTitle>
        <DialogDescription>
          Folder to move {top.length === 1 ? "it" : "them"} into, relative to the repository root. Leave empty for the root.
        </DialogDescription>
      </DialogHeader>
      {top.length > 1 && (
        <ul className="max-h-32 overflow-y-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
          {top.map(p => <li key={p} className="truncate" title={p}>{p}</li>)}
        </ul>
      )}
      <div className="space-y-1">
        <Input
          placeholder="path/to/folder (empty = repository root)"
          value={dest}
          list={listId}
          aria-invalid={touched && !!error}
          onChange={e => {
            setDest(e.target.value)
            setTouched(true)
          }}
          onKeyDown={e => {
            if (e.key === "Enter") submit()
          }}
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
        <datalist id={listId}>
          {suggestions.map(f => <option key={f} value={f} />)}
        </datalist>
        {touched && error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : newFolder ? (
          <p className="text-xs text-muted-foreground">New folder {dir}/ will be created.</p>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={busy || (touched && !!error)}>
          <FolderInput size={14} className="mr-2" />
          Move
        </Button>
      </DialogFooter>
    </>
  )
}
