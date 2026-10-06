import { memo, useMemo, useState, type ReactNode } from "react"
import Markdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"
import type { ToolCallContent, ToolKind } from "@agentclientprotocol/sdk"
import {
  AlertTriangle, Brain, Check, ChevronRight, Circle, CircleDot, Copy, EyeOff, FileEdit, FileSearch, Globe, Info,
  Loader2, ShieldQuestion, Square, SquareTerminal, Trash2, Wrench, X, Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DiffView } from "@/features/viewer/diff-view"
import { unifiedDiff } from "@/lib/acp/line-diff"
import { repoRelative, type ChatItem } from "@/lib/acp/transcript"
import type { ShellResult } from "@/lib/acp/types"
import { cn } from "@/lib/utils"

const MAX_RAW = 4000

const proseCls = "prose prose-sm dark:prose-invert max-w-none break-words prose-pre:my-2 prose-pre:p-0 prose-pre:bg-transparent prose-code:before:content-none prose-code:after:content-none prose-p:my-1.5"

function AgentMarkdown({ text }: { text: string }) {
  return (
    <div className={proseCls}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{text}</Markdown>
    </div>
  )
}

function Row({ label, border, children }: { label: string; border: string; children: ReactNode }) {
  return (
    <div className={cn("border-l-2 pl-3", border)}>
      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function Collapsible({ open, onToggle, header, children }: { open: boolean; onToggle: () => void; header: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent">
        <ChevronRight size={14} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        {header}
      </button>
      {open && <div className="space-y-2 border-t border-border p-2">{children}</div>}
    </div>
  )
}

function ToolIcon({ kind }: { kind?: ToolKind }) {
  const props = { size: 14, className: "shrink-0 text-muted-foreground" }
  switch (kind) {
    case "read":
    case "search":
      return <FileSearch {...props} />
    case "edit":
    case "move":
      return <FileEdit {...props} />
    case "delete":
      return <Trash2 {...props} />
    case "execute":
      return <SquareTerminal {...props} />
    case "fetch":
      return <Globe {...props} />
    case "think":
      return <Brain {...props} />
    default:
      return <Wrench {...props} />
  }
}

function ToolStatus({ status }: { status: string }) {
  if (status === "completed") return <Check size={14} className="shrink-0 text-green-600 dark:text-green-400" aria-label="done" />
  if (status === "failed") return <X size={14} className="shrink-0 text-destructive" aria-label="failed" />
  if (status === "in_progress") return <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" aria-label="running" />
  return <Circle size={12} className="shrink-0 text-muted-foreground" aria-label="pending" />
}

function FilePath({ path, repo, onOpenFile }: { path: string; repo: string; onOpenFile: (file: string) => void }) {
  const rel = repoRelative(repo, path)
  if (!rel) return <span className="break-all font-mono text-xs text-muted-foreground">{path}</span>
  return (
    <button type="button" onClick={() => onOpenFile(rel)} className="break-all text-left font-mono text-xs text-primary hover:underline" title={`Open ${rel}`}>
      {rel}
    </button>
  )
}

function DiffBlock({ content, repo, onOpenFile }: { content: Extract<ToolCallContent, { type: "diff" }>; repo: string; onOpenFile: (file: string) => void }) {
  const raw = useMemo(() => unifiedDiff(content.oldText, content.newText), [content.oldText, content.newText])
  return (
    <div className="overflow-hidden rounded border border-border">
      <div className="border-b border-border bg-muted px-2 py-1">
        <FilePath path={content.path} repo={repo} onOpenFile={onOpenFile} />
        {content.oldText == null && <span className="ml-2 text-[10px] text-muted-foreground">new file</span>}
      </div>
      <div className="max-h-96 overflow-auto">
        <DiffView raw={raw} view="unified" fullPath={content.path} />
      </div>
    </div>
  )
}

function ToolContent({ content, repo, onOpenFile }: { content: ToolCallContent; repo: string; onOpenFile: (file: string) => void }) {
  if (content.type === "diff") return <DiffBlock content={content} repo={repo} onOpenFile={onOpenFile} />
  if (content.type === "terminal") return <div className="text-xs text-muted-foreground">Terminal {content.terminalId}</div>
  const block = content.content
  const text = block.type === "text" ? block.text : block.type === "resource_link" ? block.uri : `[${block.type}]`
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{text}</pre>
}

function rawText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  return text.length > MAX_RAW ? text.slice(0, MAX_RAW) + "\n…" : text
}

function ToolBlock({ item, repo, onOpenFile }: { item: Extract<ChatItem, { kind: "tool" }>; repo: string; onOpenFile: (file: string) => void }) {
  const hasDiff = item.content.some(c => c.type === "diff")
  // Starts expanded once it carries a diff (often only in a later update),
  // until the user toggles it.
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? hasDiff
  return (
    <Collapsible
      open={open}
      onToggle={() => setToggled(!open)}
      header={
        <>
          <ToolIcon kind={item.toolKind} />
          <span className="min-w-0 flex-1 truncate font-mono" title={item.title}>{item.title}</span>
          <ToolStatus status={item.status} />
        </>
      }
    >
      {item.locations.length > 0 && !hasDiff && (
        <div className="flex flex-col gap-0.5">
          {item.locations.map((loc, i) => (
            <span key={i} className="text-xs">
              <FilePath path={loc.path} repo={repo} onOpenFile={onOpenFile} />
              {loc.line != null && <span className="font-mono text-xs text-muted-foreground">:{loc.line}</span>}
            </span>
          ))}
        </div>
      )}
      {item.content.map((c, i) => <ToolContent key={i} content={c} repo={repo} onOpenFile={onOpenFile} />)}
      {item.content.length === 0 && item.rawInput !== undefined && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{rawText(item.rawInput)}</pre>
      )}
    </Collapsible>
  )
}

function shellStatus(result: ShellResult): { label: string; ok: boolean } {
  if (result.timedOut) return { label: "timed out", ok: false }
  if (result.signal) return { label: "stopped", ok: false }
  if (result.exitCode === null) return { label: "failed", ok: false }
  return { label: `exit ${result.exitCode}`, ok: result.exitCode === 0 }
}

function duration(ms: number) {
  return ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

// A `!` / `!!` command and its real output (the last lines of it).
function ShellBlock({ item, onStop }: { item: Extract<ChatItem, { kind: "shell" }>; onStop: (shellId: string) => void }) {
  const [copied, setCopied] = useState(false)
  const status = item.result && shellStatus(item.result)
  const copy = () => {
    void navigator.clipboard?.writeText(item.lines.join("\n")).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }, () => {})
  }
  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex min-w-0 items-center gap-2 px-2 py-1.5 text-xs">
        <SquareTerminal size={14} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono" title={item.command}>$ {item.command}</span>
        {!item.share && (
          <span title="Not shared with the agent (!!)" className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
            <EyeOff size={12} />
            private
          </span>
        )}
        {item.result && <span className="shrink-0 text-[10px] text-muted-foreground">{duration(item.result.durationMs)}</span>}
        {status ? (
          <span className={cn("shrink-0 font-mono text-[10px]", status.ok ? "text-green-600 dark:text-green-400" : "text-destructive")}>{status.label}</span>
        ) : (
          <>
            <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" aria-label="running" />
            <button type="button" title="Stop" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onStop(item.shellId)}>
              <Square size={12} />
            </button>
          </>
        )}
        {item.lines.length > 0 && (
          <button type="button" title="Copy output" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={copy}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        )}
      </div>
      {(item.lines.length > 0 || item.dropped > 0) && (
        <div className="border-t border-border">
          {item.dropped > 0 && <div className="px-2 pt-1 text-[10px] text-muted-foreground">… {item.dropped} earlier {item.dropped === 1 ? "line" : "lines"} hidden</div>}
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs">{item.lines.join("\n")}</pre>
        </div>
      )}
    </div>
  )
}

function ThoughtBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      open={open}
      onToggle={() => setOpen(o => !o)}
      header={
        <>
          <Brain size={14} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate italic text-muted-foreground">{text.trim().split("\n")[0] || "Thinking"}</span>
        </>
      }
    >
      <div className="whitespace-pre-wrap break-words text-xs italic text-muted-foreground">{text}</div>
    </Collapsible>
  )
}

function PlanBlock({ item }: { item: Extract<ChatItem, { kind: "plan" }> }) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Plan</div>
      {item.markdown ? <AgentMarkdown text={item.markdown} /> : (
        <ul className="space-y-0.5 text-xs">
          {item.entries.map((entry, i) => (
            <li key={i} className="flex items-start gap-2">
              {entry.status === "completed"
                ? <Check size={14} className="mt-0.5 shrink-0 text-green-600 dark:text-green-400" />
                : entry.status === "in_progress"
                  ? <CircleDot size={14} className="mt-0.5 shrink-0 text-primary" />
                  : <Circle size={14} className="mt-0.5 shrink-0 text-muted-foreground" />}
              <span className={cn(entry.status === "completed" && "text-muted-foreground line-through")}>{entry.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PermissionBlock({ item, onAnswer }: { item: Extract<ChatItem, { kind: "permission" }>; onAnswer: (requestId: string, optionId: string | null) => void }) {
  const chosen = item.options.find(o => o.optionId === item.optionId)?.name ?? item.optionId
  return (
    <div className={cn("rounded-md border p-2", item.status === "pending" ? "border-primary bg-primary/5" : "border-border bg-card")}>
      <div className="flex items-start gap-2 text-xs">
        <ShieldQuestion size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 break-words font-mono">{item.title}</span>
      </div>
      {item.status === "pending" ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.options.map(o => (
            <Button
              key={o.optionId}
              size="sm"
              variant={o.kind.startsWith("allow") ? (o.kind === "allow_once" ? "default" : "outline") : "destructive"}
              className="h-7 px-2 text-xs"
              onClick={() => onAnswer(item.requestId, o.optionId)}
            >
              {o.name}
            </Button>
          ))}
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          {item.status === "auto" && <Zap size={12} />}
          {item.status === "cancelled" ? "Cancelled" : `${item.status === "auto" ? "Auto-approved" : "Answered"}: ${chosen}`}
        </div>
      )}
    </div>
  )
}

export const ChatItemView = memo(function ChatItemView({ item, repo, onOpenFile, onAnswer, onStopShell }: {
  item: ChatItem
  repo: string
  onOpenFile: (file: string) => void
  onAnswer: (requestId: string, optionId: string | null) => void
  onStopShell: (shellId: string) => void
}) {
  switch (item.kind) {
    case "user":
      return (
        <Row label="You" border="border-primary">
          <div className="whitespace-pre-wrap break-words text-sm">{item.text}</div>
        </Row>
      )
    case "agent":
      return (
        <Row label="Agent" border="border-border">
          <AgentMarkdown text={item.text} />
        </Row>
      )
    case "thought":
      return <ThoughtBlock text={item.text} />
    case "tool":
      return <ToolBlock item={item} repo={repo} onOpenFile={onOpenFile} />
    case "plan":
      return <PlanBlock item={item} />
    case "shell":
      return <ShellBlock item={item} onStop={onStopShell} />
    case "permission":
      return <PermissionBlock item={item} onAnswer={onAnswer} />
    case "turn_end":
      if (item.stopReason === "end_turn") return <div className="border-t border-dashed border-border" />
      return <div className="text-center text-xs text-muted-foreground">Stopped: {item.stopReason.replace(/_/g, " ")}</div>
    case "error":
      return (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{item.message}</span>
        </div>
      )
    case "notice":
      return (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words"><span className="font-medium">{item.title}</span>{item.description && ` — ${item.description}`}</span>
        </div>
      )
  }
})
