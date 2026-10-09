import "server-only"
import { spawn, type ChildProcess } from "child_process"
import { HttpError } from "../http"
import type { PluginConfig } from "./config"

const STARTUP_MS = 15_000
const STRIPPED_ENV = ["CLAUDECODE", "NODE_OPTIONS"]

type Running = { child: ChildProcess; key: string; ready: Promise<void> }

const g = globalThis as unknown as { __hunkPlugins?: Map<string, Running> }

function running(): Map<string, Running> {
  if (!g.__hunkPlugins) {
    const map = new Map<string, Running>()
    g.__hunkPlugins = map
    process.once("exit", () => {
      for (const r of map.values()) r.child.kill("SIGTERM")
    })
  }
  return g.__hunkPlugins
}

export function pluginBase(id: string) {
  return `/plugins/${id}`
}

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(1000) })
    return true
  } catch {
    return false
  }
}

async function waitUntilUp(plugin: PluginConfig, child: ChildProcess) {
  const deadline = Date.now() + STARTUP_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new HttpError(502, `Plugin ${plugin.id} exited during startup`)
    if (await reachable(plugin.url)) return
    await new Promise(r => setTimeout(r, 200))
  }
  throw new HttpError(504, `Plugin ${plugin.id} did not start in time`)
}

function start(plugin: PluginConfig, command: string[]): Running {
  const url = new URL(plugin.url)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...plugin.env,
    PORT: url.port || (url.protocol === "https:" ? "443" : "80"),
    HUNK_PLUGIN_ID: plugin.id,
    HUNK_PLUGIN_BASE: pluginBase(plugin.id),
  }
  for (const key of STRIPPED_ENV) delete env[key]
  const [cmd, ...args] = command
  const child = spawn(cmd, args, { cwd: plugin.cwd, env, stdio: ["ignore", "inherit", "inherit"] })
  const entry: Running = { child, key: JSON.stringify(plugin), ready: Promise.resolve() }
  child.on("error", () => {})
  child.on("exit", () => {
    if (running().get(plugin.id) === entry) running().delete(plugin.id)
  })
  entry.ready = waitUntilUp(plugin, child)
  entry.ready.catch(() => child.kill("SIGTERM"))
  return entry
}

export async function ensurePlugin(plugin: PluginConfig): Promise<void> {
  if (!plugin.command) return
  const map = running()
  let entry = map.get(plugin.id)
  if (entry && entry.key !== JSON.stringify(plugin)) {
    entry.child.kill("SIGTERM")
    entry = undefined
  }
  if (!entry) {
    if (await reachable(plugin.url)) return
    entry = start(plugin, plugin.command)
    map.set(plugin.id, entry)
  }
  try {
    await entry.ready
  } catch (e) {
    if (map.get(plugin.id) === entry) map.delete(plugin.id)
    throw e
  }
}
