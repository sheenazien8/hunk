import { Archive, GitPullRequestArrow, RefreshCw, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function Spinner() {
  return <RefreshCw size={14} className="animate-spin mr-2" />
}

// Pulling with uncommitted changes: stash them around the pull, or stay put.
export function PullStashDialog({ open, onOpenChange, rebase, busy, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The pull that was asked for (shown in the copy).
  rebase: boolean
  busy: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Uncommitted changes</DialogTitle>
          <DialogDescription>
            You have uncommitted changes. Stash them, {rebase ? "pull with rebase" : "pull"}, then re-apply them?
            If re-applying conflicts, they stay in the stash list.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner /> : <Archive size={14} className="mr-2" />}
            Stash &amp; Pull
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// After the remote refused a push: pull first (usually right), or overwrite
// the remote branch with --force-with-lease.
export function ForcePushDialog({ open, onOpenChange, branch, upstream, busy, onPullRebase, onForcePush }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  branch: string
  upstream?: string
  busy: boolean
  onPullRebase: () => void
  onForcePush: () => void
}) {
  const target = upstream || "the remote branch"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Push rejected</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                <code className="bg-muted px-1 rounded">{target}</code> has commits that aren&apos;t in{" "}
                <code className="bg-muted px-1 rounded">{branch}</code>. Usually you want to pull them in first.
              </p>
              <p>
                Force pushing replaces {target} with your branch, <strong>discarding those commits</strong> on the remote.
                It&apos;s refused if the remote changed since your last fetch, so only commits you&apos;ve already fetched can be lost.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={onPullRebase} disabled={busy}>
            <GitPullRequestArrow size={14} className="mr-2" />
            Pull with rebase
          </Button>
          <Button variant="destructive" onClick={onForcePush} disabled={busy}>
            {busy ? <Spinner /> : <Upload size={14} className="mr-2" />}
            Force push
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
