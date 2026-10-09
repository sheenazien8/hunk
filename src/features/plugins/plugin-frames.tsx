import { useEffect, useRef } from "react"
import type { BufferEntry } from "@/features/buffer/buffer"
import { type PluginContext, type PluginMessage, parsePluginMessage } from "@/lib/plugins/types"
import { cn } from "@/lib/utils"

export type HostContext = Omit<PluginContext, "type" | "plugin">

function PluginFrame({ entry, visible, context, onMessage }: {
  entry: BufferEntry
  visible: boolean
  context: HostContext
  onMessage: (message: PluginMessage, plugin: string) => void
}) {
  const plugin = entry.plugin ?? ""
  const frameRef = useRef<HTMLIFrameElement>(null)
  const contextRef = useRef(context)
  const onMessageRef = useRef(onMessage)

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    contextRef.current = context
    const target = frameRef.current?.contentWindow
    target?.postMessage({ type: "hunk:context", plugin, ...context } satisfies PluginContext, location.origin)
  }, [context, plugin])

  useEffect(() => {
    function listen(e: MessageEvent) {
      const target = frameRef.current?.contentWindow
      if (!target || e.source !== target || e.origin !== location.origin) return
      const message = parsePluginMessage(e.data)
      if (!message) return
      if (message.type === "hunk:ready") {
        target.postMessage({ type: "hunk:context", plugin, ...contextRef.current } satisfies PluginContext, location.origin)
      } else {
        onMessageRef.current(message, plugin)
      }
    }
    window.addEventListener("message", listen)
    return () => window.removeEventListener("message", listen)
  }, [plugin])

  return (
    <iframe
      ref={frameRef}
      title={plugin}
      src={`/plugins/${encodeURIComponent(plugin)}`}
      className={cn("h-full w-full rounded-md border border-border bg-card", !visible && "hidden")}
    />
  )
}

export function PluginFrames({ entries, activeId, context, onMessage }: {
  entries: BufferEntry[]
  activeId: string | null
  context: HostContext
  onMessage: (message: PluginMessage, plugin: string) => void
}) {
  const frames = entries.filter(e => e.plugin)
  const showing = frames.some(e => e.id === activeId)
  if (frames.length === 0) return null
  return (
    <div className={cn("min-h-0 flex-1", !showing && "hidden")}>
      {frames.map(e => (
        <PluginFrame key={`${e.id}:${e.pluginNonce}`} entry={e} visible={e.id === activeId} context={context} onMessage={onMessage} />
      ))}
    </div>
  )
}
