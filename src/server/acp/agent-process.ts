import "server-only"
import { spawn, type ChildProcess } from "child_process"
import { Readable, Writable } from "stream"
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type AgentCapabilities,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk"
import type { AgentConfig } from "./config"

const INIT_TIMEOUT_MS = 60_000
const STDERR_LINES = 20

export interface AgentHandlers {
  sessionUpdate: (params: SessionNotification) => void
  requestPermission: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  exit: (reason: string) => void
}

// Env vars that break a nested agent: CLAUDECODE makes claude refuse to
// start ("nested session") when hunk itself runs under Claude Code,
// and NODE_OPTIONS from `next dev` isn't meant for the child.
const STRIPPED_ENV = ["CLAUDECODE", "NODE_OPTIONS", "CLAUDE_CODE_ENTRYPOINT"]

// Every running agent child, kept on globalThis (dev HMR) so one exit hook
// can kill them all. It must be synchronous: nothing async runs during exit.
const g = globalThis as typeof globalThis & { __hunkAcpChildren?: Set<ChildProcess> }
const children: Set<ChildProcess> = (g.__hunkAcpChildren ??= (() => {
  const set = new Set<ChildProcess>()
  process.once("exit", () => {
    for (const child of set) child.kill("SIGTERM")
  })
  return set
})())

export function agentEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  for (const key of STRIPPED_ENV) delete env[key]
  return env
}

// One agent process (JSON-RPC over stdio) running in `repo`, shared by all
// of that repo's sessions for this agent.
export class AgentProcess {
  capabilities: AgentCapabilities = {}
  lastActive = Date.now()
  private stderr: string[] = []
  private exited = false

  private constructor(
    readonly agent: AgentConfig,
    readonly repo: string,
    private child: ChildProcess,
    readonly connection: ClientSideConnection,
  ) {}

  get alive() {
    return !this.exited
  }

  static async start(agent: AgentConfig, repo: string, handlers: AgentHandlers): Promise<AgentProcess> {
    const [command, ...args] = agent.command
    const child = spawn(command, args, { cwd: repo, env: agentEnv(agent.env), stdio: ["pipe", "pipe", "pipe"] })
    children.add(child)
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    )
    // fs/terminal client capabilities are off, so these are the only
    // agent→client requests we answer; the SDK rejects the rest.
    const connection = new ClientSideConnection(() => ({
      sessionUpdate: params => handlers.sessionUpdate(params),
      requestPermission: params => handlers.requestPermission(params),
    }), stream)
    const proc = new AgentProcess(agent, repo, child, connection)

    let failStart: (e: Error) => void = () => {}
    const startFailed = new Promise<never>((_, reject) => { failStart = reject })
    startFailed.catch(() => {})

    child.stderr!.setEncoding("utf-8")
    child.stderr!.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue
        console.error(`[acp:${agent.id}] ${line}`)
        proc.stderr.push(line)
        if (proc.stderr.length > STDERR_LINES) proc.stderr.shift()
      }
    })
    child.on("error", e => failStart(new Error(`Failed to start ${command}: ${e.message}`)))
    child.on("exit", (code, signal) => {
      children.delete(child)
      proc.exited = true
      const reason = `Agent exited (${signal ?? code})${proc.stderr.length ? `: ${proc.stderr.slice(-3).join(" | ")}` : ""}`
      failStart(new Error(reason))
      handlers.exit(reason)
    })

    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${agent.name} did not answer initialize within ${INIT_TIMEOUT_MS / 1000}s`)), INIT_TIMEOUT_MS)
    })
    try {
      const init = await Promise.race([
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "hunk", version: "0.1.0" },
        }),
        startFailed,
        timeout,
      ])
      proc.capabilities = init.agentCapabilities ?? {}
      return proc
    } catch (e) {
      proc.kill()
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  touch() {
    this.lastActive = Date.now()
  }

  kill() {
    if (!this.exited) this.child.kill("SIGTERM")
  }
}
