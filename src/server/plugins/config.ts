import "server-only"
import path from "path"
import { readFile, realpath } from "fs/promises"
import { HttpError } from "../http"

export interface PluginConfig {
  id: string
  name: string
  url: string
  mcp?: string
  command?: string[]
  cwd?: string
  env?: Record<string, string>
}

const ID = /^[a-z0-9][a-z0-9-]*$/

function isPluginConfig(value: unknown): value is PluginConfig {
  const p = value as PluginConfig | null
  if (!p || typeof p.id !== "string" || !ID.test(p.id) || typeof p.name !== "string") return false
  try {
    if (!["http:", "https:"].includes(new URL(p.url).protocol)) return false
  } catch {
    return false
  }
  return (p.mcp === undefined || (typeof p.mcp === "string" && p.mcp.startsWith("/")))
    && (p.command === undefined || (Array.isArray(p.command) && p.command.length > 0 && p.command.every(c => typeof c === "string" && c !== "")))
    && (p.cwd === undefined || typeof p.cwd === "string")
    && (p.env === undefined || (typeof p.env === "object" && Object.values(p.env).every(v => typeof v === "string")))
}

export function pluginsConfigPath(): string {
  return process.env.HUNK_PLUGINS_CONFIG || path.join(process.cwd(), "plugins.json")
}

export async function loadPlugins(file = pluginsConfigPath()): Promise<PluginConfig[]> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as { plugins?: unknown }
    if (!Array.isArray(parsed.plugins)) return []
    const plugins = parsed.plugins.filter(isPluginConfig)
    const dir = path.dirname(await realpath(file))
    return plugins
      .filter((p, i) => plugins.findIndex(q => q.id === p.id) === i)
      .map(p => ({ ...p, cwd: p.cwd && path.resolve(dir, p.cwd) }))
  } catch {
    return []
  }
}

export async function findPlugin(id: string): Promise<PluginConfig> {
  const plugin = (await loadPlugins()).find(p => p.id === id)
  if (!plugin) throw new HttpError(404, `Unknown plugin: ${id}`)
  return plugin
}
