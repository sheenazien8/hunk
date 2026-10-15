import { useState } from "react"
import { FolderPlus, Pencil, RefreshCw, Trash2 } from "lucide-react"
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
import type { Project, ProjectInput } from "@/lib/git/types"

function Spinner() {
  return <RefreshCw size={14} className="animate-spin mr-2" />
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

// Add + edit share this dialog. Mount with a fresh `key` per opening so the
// `project` seed is applied.
export function ProjectDialog({ open, onOpenChange, project, defaultDir, busy, onSave }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Absent = add.
  project?: Project
  defaultDir: string
  busy: boolean
  onSave: (input: ProjectInput) => Promise<boolean>
}) {
  const [name, setName] = useState(project?.name ?? "")
  const [dir, setDir] = useState(project?.dir ?? defaultDir)
  const [ignore, setIgnore] = useState((project?.ignore ?? []).join("\n"))
  const valid = !!name.trim() && !!dir.trim()

  const submit = async () => {
    if (!valid || busy) return
    const patterns = ignore.split("\n").map(p => p.trim()).filter(Boolean)
    const ok = await onSave({ name: name.trim(), dir: dir.trim(), ignore: patterns })
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{project ? "Edit Project" : "Add Project"}</DialogTitle>
          <DialogDescription>
            A directory Hunk may open and run git in. The path must exist and be a git working tree.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 py-2" onSubmit={e => { e.preventDefault(); void submit() }}>
          <Field label="Name">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="My project" autoFocus />
          </Field>
          <Field label="Directory">
            <Input value={dir} onChange={e => setDir(e.target.value)} placeholder="/path/to/repo" className="font-mono" />
          </Field>
          <Field label="Ignore patterns (optional, one per line)">
            <textarea
              value={ignore}
              onChange={e => setIgnore(e.target.value)}
              placeholder={"dist\n*.log"}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </Field>
          <button type="submit" hidden />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? <Spinner /> : project ? <Pencil size={14} className="mr-2" /> : <FolderPlus size={14} className="mr-2" />}
            {project ? "Save" : "Add Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RemoveProjectDialog({ open, onOpenChange, project, busy, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
  busy: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Remove Project</DialogTitle>
          <DialogDescription>
            Remove <code className="rounded bg-muted px-1">{project?.name}</code> at{" "}
            <code className="rounded bg-muted px-1 break-all">{project?.dir}</code> from the list? The repository itself
            is untouched; Hunk only loses access to it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner /> : <Trash2 size={14} className="mr-2" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
