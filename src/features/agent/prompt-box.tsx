import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AtSign, EyeOff, FileCode, FileDiff, ImagePlus, Loader2, Send, Square, SquareTerminal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { base64Bytes, formatBytes, MAX_PROMPT_IMAGE_CHARS, MAX_PROMPT_IMAGES, type ChatImage } from "@/lib/acp/images"
import { extractMentions, insertMention, mentionAt, rankFiles, removeMention } from "@/lib/acp/mentions"
import { parsePromptInput } from "@/lib/acp/shell-prefix"
import { cn } from "@/lib/utils"
import { ConfigBar } from "./config-bar"
import { IMAGE_ACCEPT, imageFiles, prepareImage } from "./image-attach"
import type { Agent } from "./use-agent"

const PROMPT_HEIGHT_KEY = "hunk-agent-prompt-height"
const PROMPT_ROWS = 5
const PROMPT_MIN_HEIGHT = 56
// Never let the prompt box take more than this share of the viewport.
const PROMPT_MAX_VIEWPORT_SHARE = 0.6
const SUGGESTION_LIMIT = 50

export function clampPromptHeight(h: number, viewport = Infinity) {
  const max = Math.max(PROMPT_MIN_HEIGHT, Math.floor(viewport * PROMPT_MAX_VIEWPORT_SHARE))
  return Math.min(max, Math.max(PROMPT_MIN_HEIGHT, Math.round(h)))
}

// Height of the prompt box, dragged from its top edge (up = taller) and
// persisted. null = the default of PROMPT_ROWS rows.
function usePromptHeight() {
  const [height, setHeight] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const boxRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      const stored = parseInt(localStorage.getItem(PROMPT_HEIGHT_KEY) ?? "", 10)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring persisted UI state after hydration; SSR renders the default rows
      if (!Number.isNaN(stored)) setHeight(clampPromptHeight(stored, window.innerHeight))
    } catch {}
  }, [])

  const startResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = boxRef.current?.offsetHeight ?? PROMPT_MIN_HEIGHT
    let current = startHeight
    setIsResizing(true)
    document.body.style.userSelect = "none"
    document.body.style.cursor = "row-resize"
    const onMove = (ev: PointerEvent) => {
      current = clampPromptHeight(startHeight + startY - ev.clientY, window.innerHeight)
      setHeight(current)
    }
    const onUp = () => {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onUp)
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
      setIsResizing(false)
      try {
        localStorage.setItem(PROMPT_HEIGHT_KEY, String(current))
      } catch {}
    }
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerup", onUp)
  }, [])

  const reset = useCallback(() => {
    setHeight(null)
    try {
      localStorage.removeItem(PROMPT_HEIGHT_KEY)
    } catch {}
  }, [])

  return { height, isResizing, startResize, reset, boxRef }
}

function ToolButton({ icon, label, title, disabled, onClick }: {
  icon: React.ReactNode
  label: string
  title: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground" title={title} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </Button>
  )
}

// What is typed after the "@" at the caret, unless those suggestions were
// dismissed; null when no mention is being typed.
function activeQuery(text: string, caret: number, dismissedAt: number | null): string | null {
  const mention = mentionAt(text, caret)
  return mention && mention.start !== dismissedAt ? mention.query : null
}

function fileName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1)
}

interface Attachment extends ChatImage {
  id: number
  name: string
}

let nextAttachmentId = 1

// Images attached to the next prompt (paste, drop or the file picker),
// already downscaled and re-encoded.
function useAttachments() {
  const [images, setImages] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const add = useCallback(async (files: File[], current: Attachment[]) => {
    if (files.length === 0) return
    setError("")
    if (current.length + files.length > MAX_PROMPT_IMAGES) {
      setError(`At most ${MAX_PROMPT_IMAGES} images per message`)
      return
    }
    setBusy(true)
    try {
      let chars = current.reduce((n, img) => n + img.data.length, 0)
      const added: Attachment[] = []
      for (const file of files) {
        const image = await prepareImage(file)
        chars += image.data.length
        if (chars > MAX_PROMPT_IMAGE_CHARS) throw new Error("The attached images are too large together")
        added.push({ ...image, id: nextAttachmentId++, name: file.name || "pasted image" })
      }
      setImages(list => [...list, ...added])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const remove = (id: number) => setImages(list => list.filter(img => img.id !== id))
  const clear = () => {
    setImages([])
    setError("")
  }
  return { images, busy, error, add, remove, clear }
}

// Prompt input: `!cmd` / `!!cmd` run a shell command (shared with the agent
// on the next prompt / private), @-mention files (sent to the agent as resource links),
// attach images (paste, drop or pick; only when the agent takes them),
// quick buttons to mention the open file or all changed files, chips for
// what will be attached, a drag handle for its height, and below it the
// agent's settings (model, thinking, mode…) with context usage.
export function PromptBox({ agent, files, changedFiles, activeFile }: {
  agent: Agent
  // Mentionable repo files (git-ignored ones left out), for suggestions
  files: string[]
  // Files with uncommitted changes
  changedFiles: string[]
  // The file open in the viewer
  activeFile: string | null
}) {
  const [text, setText] = useState("")
  const [caret, setCaret] = useState(0)
  // "@" position whose suggestions were dismissed with Escape
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [highlight, setHighlight] = useState({ query: "", index: 0 })
  const listRef = useRef<HTMLDivElement>(null)
  const { busy, connected } = agent.transcript.state
  const disabled = !agent.sessionId || agent.streamStatus === "closed" || !connected
  const { height, isResizing, startResize, reset, boxRef } = usePromptHeight()
  const attachments = useAttachments()
  const pickerRef = useRef<HTMLInputElement>(null)
  const canAttach = !disabled && agent.transcript.state.images

  useEffect(() => {
    if (agent.sessionId) boxRef.current?.focus()
  }, [agent.sessionId, boxRef])

  const input = useMemo(() => parsePromptInput(text), [text])
  const isShell = input.kind === "shell"
  const shellRunning = agent.transcript.items.some(item => item.kind === "shell" && !item.result)
  const canSend = !disabled && agent.pending !== "send" && (input.kind === "shell"
    ? !!input.command && !shellRunning
    : (!!input.text || attachments.images.length > 0) && !busy && !attachments.busy)

  const known = useMemo(() => new Set([...files, ...changedFiles]), [files, changedFiles])
  const attached = useMemo(() => extractMentions(text, known), [text, known])

  const query = activeQuery(text, caret, dismissedAt)
  const suggestions = useMemo(() => (query === null ? [] : rankFiles(files, query, SUGGESTION_LIMIT)), [files, query])
  const mention = query === null ? null : mentionAt(text, caret)
  const index = mention && highlight.query === mention.query ? Math.min(highlight.index, suggestions.length - 1) : 0
  const showSuggestions = !!mention && !disabled

  useEffect(() => {
    listRef.current?.querySelector("[data-active=true]")?.scrollIntoView({ block: "nearest" })
  }, [index, showSuggestions])

  // Applies a new text + caret and puts the caret there in the textarea.
  const update = (next: string, nextCaret: number) => {
    setText(next)
    setCaret(nextCaret)
    requestAnimationFrame(() => {
      const box = boxRef.current
      if (!box) return
      box.focus()
      box.setSelectionRange(nextCaret, nextCaret)
    })
  }

  // Inserts `insert` at the caret, with a space before it if needed.
  const insertAtCaret = (insert: string) => {
    const box = boxRef.current
    const start = box?.selectionStart ?? text.length
    const end = box?.selectionEnd ?? start
    const pad = start > 0 && !/\s/.test(text[start - 1]) ? " " : ""
    update(text.slice(0, start) + pad + insert + text.slice(end), start + pad.length + insert.length)
  }

  const pick = (path: string) => {
    if (!mention) return
    const next = insertMention(text, mention.start, caret, path)
    update(next.text, next.caret)
  }

  const mentionFiles = (paths: string[]) => {
    const fresh = paths.filter(p => !attached.includes(p))
    if (fresh.length > 0) insertAtCaret(fresh.map(p => `@${p}`).join(" ") + " ")
  }

  const send = async () => {
    if (!canSend) return
    const images = attachments.images.map(({ data, mimeType }) => ({ data, mimeType }))
    const ok = input.kind === "shell" ? await agent.runShell(input.command, input.share) : await agent.send(input.text, attached, images)
    if (ok) {
      setText("")
      setCaret(0)
      setDismissedAt(null)
      if (input.kind !== "shell") attachments.clear()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (showSuggestions && suggestions.length > 0 && mention) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const step = e.key === "ArrowDown" ? 1 : -1
        setHighlight({ query: mention.query, index: (index + step + suggestions.length) % suggestions.length })
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        pick(suggestions[index])
        return
      }
    }
    if (showSuggestions && e.key === "Escape" && mention) {
      e.preventDefault()
      e.stopPropagation()
      setDismissedAt(mention.start)
      return
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const trackCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => setCaret(e.currentTarget.selectionStart)

  const attach = (files: File[]) => void attachments.add(files, attachments.images)

  // Pasted images attach (when the agent takes them); text pastes as usual.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(e.clipboardData.items)
    if (files.length === 0 || !canAttach) return
    e.preventDefault()
    attach(files)
  }

  const onDragOver = (e: React.DragEvent) => {
    if (canAttach && Array.from(e.dataTransfer.items).some(i => i.kind === "file")) e.preventDefault()
  }

  const onDrop = (e: React.DragEvent) => {
    const files = imageFiles(e.dataTransfer.files)
    if (files.length === 0 || !canAttach) return
    e.preventDefault()
    attach(files)
  }

  return (
    <div className="border-t border-border" onDragOver={onDragOver} onDrop={onDrop}>
      {/* Drag handle: resize the prompt box (double-click resets to 5 rows) */}
      <div
        onPointerDown={startResize}
        onDoubleClick={reset}
        title="Drag to resize · double-click to reset"
        className={cn("h-1.5 cursor-row-resize transition-colors hover:bg-ring", isResizing && "bg-ring")}
      />

      <div className="flex flex-wrap items-center gap-0.5 px-1.5 pb-1">
        <ToolButton icon={<AtSign size={12} />} label="File" title="Mention a file (type @)" disabled={disabled} onClick={() => insertAtCaret("@")} />
        <ToolButton
          icon={<FileCode size={12} />}
          label="Current file"
          title={activeFile ? `Mention ${activeFile}` : "No file open"}
          disabled={disabled || !activeFile}
          onClick={() => activeFile && mentionFiles([activeFile])}
        />
        <ToolButton
          icon={<FileDiff size={12} />}
          label={`Changes${changedFiles.length ? ` (${changedFiles.length})` : ""}`}
          title="Mention every file with uncommitted changes"
          disabled={disabled || changedFiles.length === 0}
          onClick={() => mentionFiles(changedFiles)}
        />
        {agent.transcript.state.images && (
          <>
            <ToolButton
              icon={attachments.busy ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
              label="Image"
              title="Attach an image (or paste / drop one)"
              disabled={!canAttach || attachments.busy}
              onClick={() => pickerRef.current?.click()}
            />
            <input
              ref={pickerRef}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              hidden
              onChange={e => {
                attach(imageFiles(e.target.files))
                e.target.value = ""
              }}
            />
          </>
        )}
      </div>

      {attachments.error && (
        <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] text-destructive">
          <span className="min-w-0 flex-1 break-words">{attachments.error}</span>
        </div>
      )}

      {!isShell && attachments.images.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
          {attachments.images.map(img => (
            <span key={img.id} title={`${img.name} · ${formatBytes(base64Bytes(img.data))}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- inline data: URL thumbnail */}
              <img src={`data:${img.mimeType};base64,${img.data}`} alt={img.name} className="h-12 w-12 rounded border border-border object-cover" />
              <button
                type="button"
                title={`Remove ${img.name}`}
                className="absolute -right-1 -top-1 rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
                onClick={() => attachments.remove(img.id)}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {isShell && (
        <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] text-muted-foreground">
          {input.share ? <SquareTerminal size={12} className="shrink-0" /> : <EyeOff size={12} className="shrink-0" />}
          <span className="font-medium text-foreground">Shell</span>
          <span>
            {input.share ? "· runs in the repo, output goes to the agent with your next message (!! to keep it private)" : "· runs in the repo, output stays private"}
            {shellRunning && " · a command is still running"}
          </span>
        </div>
      )}

      {!isShell && attached.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pb-1.5">
          {attached.map(path => (
            <span key={path} title={path} className="flex max-w-full items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
              <FileCode size={11} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{fileName(path)}</span>
              <button type="button" title={`Remove ${path}`} className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => update(removeMention(text, path), Math.min(caret, text.length))}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 px-2 pb-2">
        <div className="relative min-w-0 flex-1">
          {showSuggestions && (
            <div
              ref={listRef}
              role="listbox"
              aria-label="Files"
              className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            >
              {suggestions.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">{files.length === 0 ? "Loading files…" : "No matching files"}</div>
              ) : suggestions.map((path, i) => (
                <button
                  key={path}
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  data-active={i === index}
                  // Keep focus (and the caret) in the textarea.
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pick(path)}
                  onMouseEnter={() => setHighlight({ query: mention?.query ?? "", index: i })}
                  className={cn("flex w-full min-w-0 items-baseline gap-2 rounded px-2 py-1 text-left text-xs", i === index && "bg-accent")}
                >
                  <span className="shrink-0 font-mono">{fileName(path)}</span>
                  <span className="min-w-0 truncate text-[10px] text-muted-foreground">{path}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={boxRef}
            value={text}
            onChange={e => {
              setText(e.target.value)
              setCaret(e.target.selectionStart)
            }}
            onSelect={trackCaret}
            onClick={trackCaret}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => setDismissedAt(mention?.start ?? null)}
            onFocus={() => setDismissedAt(null)}
            rows={PROMPT_ROWS}
            style={height === null ? undefined : { height }}
            disabled={disabled}
            aria-autocomplete="list"
            placeholder={disabled ? "Start or resume a session first" : "Message the agent… (@ to mention a file, !cmd to run a command, Shift+Enter for a new line)"}
            className="block min-h-14 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
        </div>
        {busy && !isShell ? (
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Stop" onClick={() => void agent.cancel()}>
            <Square size={14} />
          </Button>
        ) : (
          <Button size="icon" className="h-9 w-9 shrink-0" title={isShell ? "Run (Enter)" : "Send (Enter)"} disabled={!canSend} onClick={() => void send()}>
            {agent.pending === "send" ? <Loader2 size={14} className="animate-spin" /> : isShell ? <SquareTerminal size={14} /> : <Send size={14} />}
          </Button>
        )}
      </div>

      <ConfigBar agent={agent} />
    </div>
  )
}
