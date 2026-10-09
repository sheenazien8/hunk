import { useId, useState } from "react"
import { FolderGit2, RefreshCw, Trash2 } from "lucide-react"
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
import type { Worktree } from "@/lib/git/types"
import { defaultWorktreePath, worktreeLabel } from "./worktrees"

export interface NewWorktree {
  path: string
  branch: string
  newBranch: boolean
  base: string
}

// Prefill for the add dialog (from the branch picker): which branch, whether
// to create it, and what to start it from.
export interface NewWorktreeSeed {
  branch: string
  newBranch: boolean
  base?: string
}

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

// Mount with a fresh `key` per opening so the seed is applied.
export function AddWorktreeDialog({ open, onOpenChange, seed, mainDir, branches, busy, onCreate }: {
  open: boolean
  seed?: NewWorktreeSeed
  onOpenChange: (open: boolean) => void
  mainDir: string
  branches: string[]
  busy: boolean
  onCreate: (worktree: NewWorktree) => Promise<boolean>
}) {
  const listId = useId()
  const [branch, setBranch] = useState(seed?.branch ?? "")
  const [newBranch, setNewBranch] = useState(seed?.newBranch ?? true)
  const [base, setBase] = useState(seed?.base ?? "HEAD")
  // null = follow the default derived from the branch name.
  const [customPath, setCustomPath] = useState<string | null>(null)
  const path = customPath ?? (branch.trim() ? defaultWorktreePath(mainDir, branch) : "")
  const valid = !!branch.trim() && !!path.trim()

  const reset = () => {
    setBranch("")
    setNewBranch(true)
    setBase("HEAD")
    setCustomPath(null)
  }

  const submit = async () => {
    if (!valid || busy) return
    const ok = await onCreate({ path: path.trim(), branch: branch.trim(), newBranch, base: base.trim() || "HEAD" })
    if (ok) {
      onOpenChange(false)
      reset()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add Worktree</DialogTitle>
          <DialogDescription>Check out a branch into its own directory next to the repository.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 py-2" onSubmit={e => { e.preventDefault(); void submit() }}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={newBranch}
              onChange={e => setNewBranch(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Create a new branch
          </label>
          <Field label={newBranch ? "New branch name" : "Existing branch"}>
            <Input
              placeholder={newBranch ? "feature/my-change" : "branch"}
              value={branch}
              onChange={e => setBranch(e.target.value)}
              list={newBranch ? undefined : listId}
              className="font-mono"
              autoFocus={!seed?.branch}
            />
            <datalist id={listId}>
              {branches.map(b => <option key={b} value={b} />)}
            </datalist>
          </Field>
          {newBranch && (
            <Field label="Start from">
              <Input
                placeholder="HEAD"
                value={base}
                onChange={e => setBase(e.target.value)}
                list={listId}
                className="font-mono"
              />
            </Field>
          )}
          <Field label="Directory">
            <Input
              placeholder={defaultWorktreePath(mainDir, "branch")}
              value={path}
              onChange={e => setCustomPath(e.target.value)}
              className="font-mono"
              autoFocus={!!seed?.branch}
            />
          </Field>
          {/* Lets Enter submit from any field. */}
          <button type="submit" hidden />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? <Spinner /> : <FolderGit2 size={14} className="mr-2" />}
            Add Worktree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RemoveWorktreeDialog({ open, onOpenChange, worktree, busy, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  worktree: Worktree | null
  busy: boolean
  onConfirm: (force: boolean) => void
}) {
  const [force, setForce] = useState(false)
  const change = (next: boolean) => {
    if (!next) setForce(false)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Remove Worktree</DialogTitle>
          <DialogDescription>
            Remove the <code className="bg-muted px-1 rounded">{worktree ? worktreeLabel(worktree) : ""}</code> worktree
            at <code className="bg-muted px-1 rounded break-all">{worktree?.path}</code>? The branch is kept.
          </DialogDescription>
        </DialogHeader>
        {!worktree?.prunable && (
          <label className="flex items-center gap-2 py-2 text-sm">
            <input
              type="checkbox"
              checked={force}
              onChange={e => setForce(e.target.checked)}
              className="h-4 w-4 accent-destructive"
            />
            Force — discard uncommitted changes{worktree?.locked ? " and ignore the lock" : ""}
          </label>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => change(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { onConfirm(force); setForce(false) }} disabled={busy}>
            {busy ? <Spinner /> : <Trash2 size={14} className="mr-2" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
