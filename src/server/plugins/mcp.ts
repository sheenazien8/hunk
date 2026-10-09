import "server-only"
import type { AgentCapabilities, McpServer } from "@agentclientprotocol/sdk"
import { findProject } from "../config"
import { mainWorktreeOf } from "../git/worktree"
import { type PluginConfig, loadPlugins } from "./config"
import { ensurePlugin } from "./process"

const STDIO_BRIDGE = `
const [url, headers] = process.argv.slice(1)
const extra = JSON.parse(headers)
let buffer = ""
let queue = Promise.resolve()
const write = message => process.stdout.write(JSON.stringify(message) + "\\n")
async function forward(line) {
  let request
  try { request = JSON.parse(line) } catch { return }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...extra, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: line,
    })
    const text = await res.text()
    if (!text.trim()) return
    const bodies = (res.headers.get("content-type") || "").includes("text/event-stream")
      ? text.split("\\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim())
      : [text]
    for (const body of bodies) {
      const parsed = JSON.parse(body)
      for (const message of Array.isArray(parsed) ? parsed : [parsed]) write(message)
    }
  } catch (e) {
    if (request && request.id !== undefined) write({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: String(e && e.message || e) } })
  }
}
process.stdin.setEncoding("utf8")
process.stdin.on("data", chunk => {
  buffer += chunk
  let i
  while ((i = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, i).trim()
    buffer = buffer.slice(i + 1)
    if (line) queue = queue.then(() => forward(line))
  }
})
`

export interface PluginMcpContext {
  repo: string
  project: string
}

export async function projectOf(repo: string): Promise<string> {
  const own = findProject(repo)
  if (own) return own.dir
  const main = await mainWorktreeOf(repo)
  return (main && findProject(main)?.dir) || main || repo
}

export function mcpServersFor(plugins: PluginConfig[], capabilities: AgentCapabilities, { repo, project }: PluginMcpContext): McpServer[] {
  const headers = { "x-hunk-repo": repo, "x-hunk-project": project }
  return plugins.flatMap((plugin): McpServer[] => {
    if (!plugin.mcp) return []
    const url = new URL(plugin.mcp, plugin.url).toString()
    if (capabilities.mcpCapabilities?.http) {
      return [{ type: "http", name: plugin.id, url, headers: Object.entries(headers).map(([name, value]) => ({ name, value })) }]
    }
    return [{ name: plugin.id, command: process.execPath, args: ["-e", STDIO_BRIDGE, url, JSON.stringify(headers)], env: [] }]
  })
}

async function startMcpPlugins(): Promise<PluginConfig[]> {
  const plugins = (await loadPlugins()).filter(p => p.mcp)
  const started = await Promise.all(plugins.map(async plugin => {
    try {
      await ensurePlugin(plugin)
      return plugin
    } catch (e) {
      console.warn(`[plugins] ${plugin.id}: MCP not offered to the agent: ${e instanceof Error ? e.message : e}`)
      return null
    }
  }))
  return started.filter(p => p !== null)
}

export async function pluginMcpServers(repo: string, capabilities: AgentCapabilities): Promise<McpServer[]> {
  const plugins = await startMcpPlugins()
  if (plugins.length === 0) return []
  return mcpServersFor(plugins, capabilities, { repo, project: await projectOf(repo) })
}

export async function pluginAgentEnv(repo: string): Promise<Record<string, string>> {
  await startMcpPlugins()
  return { HUNK_REPO: repo, HUNK_PROJECT: await projectOf(repo), PWD: repo }
}
