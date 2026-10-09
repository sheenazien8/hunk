export interface PluginInfo {
  id: string
  name: string
}

export interface PluginsResponse {
  plugins: PluginInfo[]
}

export interface PluginContext {
  type: "hunk:context"
  plugin: string
  repo: string
  project: string
  theme: "light" | "dark"
}

export type PluginMessage =
  | { type: "hunk:ready" }
  | { type: "hunk:openFile"; path: string; line?: number }
  | { type: "hunk:toast"; message: string; ok?: boolean }
  | { type: "hunk:refresh" }
  | { type: "hunk:agentTask"; text: string; files: string[] }

const MAX_TASK_TEXT = 20000
const MAX_TASK_FILES = 50

export function parsePluginMessage(data: unknown): PluginMessage | null {
  const m = data as Record<string, unknown> | null
  if (!m || typeof m !== "object" || typeof m.type !== "string") return null
  switch (m.type) {
    case "hunk:ready":
    case "hunk:refresh":
      return { type: m.type }
    case "hunk:openFile":
      if (typeof m.path !== "string" || m.path === "") return null
      return { type: m.type, path: m.path, line: typeof m.line === "number" && m.line > 0 ? Math.floor(m.line) : undefined }
    case "hunk:agentTask": {
      if (typeof m.text !== "string" || !m.text.trim() || m.text.length > MAX_TASK_TEXT) return null
      const files = Array.isArray(m.files) ? m.files.filter((f): f is string => typeof f === "string" && f !== "") : []
      return { type: m.type, text: m.text, files: [...new Set(files)].slice(0, MAX_TASK_FILES) }
    }
    case "hunk:toast":
      if (typeof m.message !== "string") return null
      return { type: m.type, message: m.message, ok: m.ok !== false }
    default:
      return null
  }
}
