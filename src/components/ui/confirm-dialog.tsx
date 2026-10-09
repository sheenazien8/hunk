import { type ReactNode, useCallback, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export interface ConfirmRequest {
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

// Promise-based replacement for window.confirm: `await ask({...})` resolves
// true on confirm, false on cancel/Escape/outside click.
export function useConfirm() {
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const ask = useCallback((next: ConfirmRequest) => {
    // A second ask while one is up settles the first as cancelled.
    resolveRef.current?.(false)
    setRequest(next)
    setOpen(true)
    return new Promise<boolean>(resolve => {
      resolveRef.current = resolve
    })
  }, [])

  const settle = (value: boolean) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setOpen(false)
  }

  return {
    open,
    request,
    ask,
    confirm: () => settle(true),
    onOpenChange: (value: boolean) => {
      if (!value) settle(false)
    },
  }
}

export function ConfirmDialog({ open, request, onConfirm, onOpenChange }: {
  open: boolean
  request: ConfirmRequest | null
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          {request?.description && <DialogDescription>{request.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{request?.cancelLabel ?? "Cancel"}</Button>
          <Button variant={request?.destructive ? "destructive" : "default"} onClick={onConfirm}>
            {request?.confirmLabel ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
