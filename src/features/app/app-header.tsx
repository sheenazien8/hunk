import type { ReactNode } from "react"
import { Bot, Check, GitBranch, Menu, PanelLeft, RefreshCw, Search, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AccountMenu } from "@/features/auth/account-menu"
import type { ActionName, GitOperation } from "@/lib/git/types"

function IconTip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  )
}

const OPERATION_LABEL: Record<GitOperation, string> = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
}

// A merge / rebase / cherry-pick / revert stopped half-way: finish or undo it.
function OperationBanner({ operation, busyAction, onContinue, onAbort }: {
  operation: GitOperation
  busyAction: ActionName | null
  onContinue: () => void
  onAbort: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200 sm:px-4">
      <TriangleAlert size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <strong>{OPERATION_LABEL[operation]} in progress.</strong>{" "}
        <span className="text-xs">Resolve any conflicts and mark the files resolved, then continue — or abort to go back.</span>
      </span>
      <Button size="sm" className="h-7 gap-1" disabled={!!busyAction} onClick={onContinue}>
        {busyAction === "continueOperation" ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
        Continue
      </Button>
      <Button variant="outline" size="sm" className="h-7 gap-1 text-destructive hover:text-destructive" disabled={!!busyAction} onClick={onAbort}>
        {busyAction === "abortOperation" ? <RefreshCw size={13} className="animate-spin" /> : <X size={13} />}
        Abort
      </Button>
    </div>
  )
}

// One-row title bar: sidebar toggle, the `project / branch` breadcrumb with
// sync + stash, then go to file, agent and the account menu (theme). Commit
// lives in the CommitBar above the viewer, Discard All and Refresh in the
// sidebar toolbars, action results in the ActionToast. Banners for an
// in-progress operation and status errors hang below.
export function AppHeader(props: {
  // Breadcrumb: repo switcher / branch picker, sync and stash menus.
  contextControls: ReactNode
  error: string
  busyAction: ActionName | null
  isDark: boolean
  onToggleTheme: () => void
  onToggleSidebar: () => void
  agentOpen: boolean
  onToggleAgent: () => void
  onOpenMobileSidebar: () => void
  onQuickOpen: () => void
  tools?: ReactNode
  operation?: GitOperation
  onContinueOperation: () => void
  onAbortOperation: () => void
}) {
  const { error, busyAction } = props

  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
        <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" title="Open file sidebar" onClick={props.onOpenMobileSidebar}>
          <Menu size={16} />
        </Button>
        <Button variant="ghost" size="icon" className="hidden h-8 w-8 md:inline-flex" title="Toggle sidebar (Ctrl+B)" onClick={props.onToggleSidebar}>
          <PanelLeft size={16} />
        </Button>
        <GitBranch size={18} className="hidden text-muted-foreground sm:block" />
        <h1 className="hidden text-base font-semibold sm:block">Hunk</h1>
        <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <div className="flex min-w-0 items-center gap-1">{props.contextControls}</div>
        <div className="flex-1" />
        {props.tools}
        <IconTip tip="Go to file (Ctrl+P)">
          <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Go to file" onClick={props.onQuickOpen}>
            <Search size={16} />
          </Button>
        </IconTip>
        <IconTip tip="Agent (Ctrl+I)">
          <Button
            variant={props.agentOpen ? "default" : "outline"}
            size="icon"
            className="h-9 w-9"
            aria-label="Agent"
            aria-pressed={props.agentOpen}
            onClick={props.onToggleAgent}
          >
            <Bot size={16} />
          </Button>
        </IconTip>
        <AccountMenu isDark={props.isDark} onToggleTheme={props.onToggleTheme} />
      </div>

      {props.operation && (
        <OperationBanner
          operation={props.operation}
          busyAction={busyAction}
          onContinue={props.onContinueOperation}
          onAbort={props.onAbortOperation}
        />
      )}
      {error && (
        <div className="border-t border-border bg-destructive/10 px-3 py-1.5 text-sm text-destructive sm:px-4" title={error}>
          <span className="line-clamp-1">{error}</span>
        </div>
      )}
    </header>
  )
}
