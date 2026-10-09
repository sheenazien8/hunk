import { useLayoutEffect, useRef, useState } from "react"
import { ArrowDown, Bot, Loader2, Plus, RefreshCw, Trash2, X, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"
import { ChatItemView } from "./chat-items"
import { PromptBox } from "./prompt-box"
import { SessionPicker } from "./session-picker"
import type { Agent } from "./use-agent"

const NEAR_BOTTOM_PX = 80
const selectCls = "h-8 min-w-0 cursor-pointer rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"

function Messages({ agent, repo, onOpenFile }: { agent: Agent; repo: string; onOpenFile: (file: string) => void }) {
  const { items, state } = agent.transcript
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // Follow new output only while the user is already at the bottom.
  useLayoutEffect(() => {
    if (nearBottomRef.current) scrollToBottom()
  }, [items, state.busy])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    nearBottomRef.current = near
    setShowJump(!near)
  }

  const waiting = items.some(i => i.kind === "permission" && i.status === "pending")

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full space-y-3 overflow-y-auto overflow-x-hidden p-3">
        {items.length === 0 && (
          <div className="pt-8 text-center text-sm text-muted-foreground">
            Ask the agent to do something in this repository.
          </div>
        )}
        {items.map(item => (
          <ChatItemView key={item.id} item={item} repo={repo} onOpenFile={onOpenFile} onAnswer={agent.answer} onStopShell={agent.stopShell} />
        ))}
        {state.busy && !waiting && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
            <Loader2 size={14} className="animate-spin" /> Working…
          </div>
        )}
      </div>
      {showJump && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-2 left-1/2 h-7 -translate-x-1/2 gap-1 text-xs shadow"
          onClick={() => {
            nearBottomRef.current = true
            scrollToBottom()
          }}
        >
          <ArrowDown size={12} /> Jump to latest
        </Button>
      )}
    </div>
  )
}

// The agent chat: agent/session pickers, auto mode, the transcript, and the
// prompt box. Rendered inside the desktop aside or the mobile sheet.
export function AgentPanel({ agent, repo, files, changedFiles, activeFile, onOpenFile, onClose }: {
  agent: Agent
  repo: string
  files: string[]
  changedFiles: string[]
  activeFile: string | null
  onOpenFile: (file: string) => void
  onClose: () => void
}) {
  const { state } = agent.transcript
  const confirm = useConfirm()

  const toggleAuto = async () => {
    if (!state.autoApprove && !(await confirm.ask({
      title: "Turn on auto mode?",
      description: "The agent will run commands and edit files without asking.",
      confirmLabel: "Turn on",
      destructive: true,
    }))) return
    void agent.setAutoApprove(!state.autoApprove)
  }

  const closeSession = async () => {
    if (await confirm.ask({
      title: "Close this session?",
      description: "The agent stops working on it.",
      confirmLabel: "Close session",
      destructive: true,
    })) void agent.closeSession()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Bot size={16} className="shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold">Agent</span>
        {/* Always shown so the active agent is visible; agents come from acp.config.json. */}
        <select
          value={agent.agentId}
          onChange={e => agent.selectAgent(e.target.value)}
          disabled={agent.agents.length < 2}
          className={cn(selectCls, "disabled:cursor-default disabled:opacity-100")}
          title={agent.agents.length < 2 ? "Agent (add more in acp.config.json)" : "Agent"}
        >
          {agent.agents.length === 0 && <option value="">Loading…</option>}
          {agent.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div className="flex-1" />
        {state.autoApprove && agent.sessionId && (
          <span className="flex items-center gap-1 text-xs text-primary"><Zap size={12} /> Auto</span>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Close panel (Ctrl+I)" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <SessionPicker
          repo={repo}
          agentId={agent.agentId}
          sessionId={agent.sessionId}
          title={state.title}
          disabled={!agent.agentId || agent.pending === "open"}
          onPick={agent.resume}
        />
        <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" disabled={!agent.agentId || agent.pending === "open"} onClick={() => void agent.newSession()}>
          {agent.pending === "open" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          New
        </Button>
        <Button
          variant={state.autoApprove ? "default" : "outline"}
          size="icon"
          className="h-8 w-8"
          title={state.autoApprove ? "Auto mode on: permissions are approved automatically" : "Auto mode off: ask before running tools"}
          aria-pressed={state.autoApprove}
          disabled={!agent.sessionId || !state.connected}
          onClick={toggleAuto}
        >
          <Zap size={14} />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Close session" disabled={!agent.sessionId} onClick={closeSession}>
          <Trash2 size={14} />
        </Button>
      </div>

      {agent.sessionId && agent.streamStatus === "closed" && (
        <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          <span className="flex-1">This session is no longer running.</span>
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={agent.pending === "open"} onClick={() => agent.sessionId && agent.resume(agent.sessionId)}>
            <RefreshCw size={12} /> Resume
          </Button>
        </div>
      )}
      {agent.sessionId && agent.streamStatus === "connecting" && (
        <div className="border-b border-border px-3 py-1 text-xs text-muted-foreground">Connecting…</div>
      )}
      {agent.error && (
        <div className="flex items-start gap-2 border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <span className="min-w-0 flex-1 break-words">{agent.error}</span>
          <button type="button" onClick={agent.clearError} title="Dismiss"><X size={12} /></button>
        </div>
      )}

      <Messages agent={agent} repo={repo} onOpenFile={onOpenFile} />
      <PromptBox agent={agent} files={files} changedFiles={changedFiles} activeFile={activeFile} />
      <ConfirmDialog open={confirm.open} request={confirm.request} onConfirm={confirm.confirm} onOpenChange={confirm.onOpenChange} />
    </div>
  )
}
