import "server-only"
import { spawn } from "child_process"
import { randomUUID } from "crypto"
import { existsSync } from "fs"
import { emptyTail, SHELL_MAX_LINES, tailAppend, tailLines, type Tail } from "@/lib/acp/tail-lines"
import type { ShellResult } from "@/lib/acp/types"
import { HttpError } from "../http"
import { agentEnv } from "./agent-process"
import type { AgentSession } from "./session"

// `!` / `!!` commands from the prompt box. This is a shell on purpose (the
// user types shell syntax: pipes, globs, &&), so it's the one place that
// doesn't go through execFile. It grants nothing new: a logged-in user can
// already make the agent run anything in the repo. HUNK_SHELL_DISABLED=1
// turns it off.
//
// Configurable (env, read on every run):
//   HUNK_SHELL_MAX_LINES  output lines kept (shown and sent to the agent), default 150
//   HUNK_SHELL_TIMEOUT    seconds before a command is stopped, default 300

const MAX_LINES_LIMIT = 5_000
const TIMEOUT_LIMIT_S = 24 * 60 * 60
const KILL_GRACE_MS = 3_000
// After the shell exits, how long background children may keep the
// output pipes open before they're killed.
const EXIT_GRACE_MS = 1_000
const SNAPSHOT_MS = 300
const MAX_COMMAND = 10_000
// Shared results kept for the next prompt
const MAX_SHARED = 5

// Process groups of running commands, killed synchronously on exit
// (globalThis: dev HMR re-evaluates this module).
const g = globalThis as typeof globalThis & { __hunkShellGroups?: Set<number> }
const groups: Set<number> = (g.__hunkShellGroups ??= (() => {
  const set = new Set<number>()
  process.once("exit", () => {
    for (const pid of set) killGroup(pid, "SIGKILL")
  })
  return set
})())

// A positive integer env var, capped at `max`; `fallback` when unset/invalid.
function envInt(name: string, fallback: number, max: number): number {
  const n = Number(process.env[name])
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback
}

export function shellMaxLines() {
  return envInt("HUNK_SHELL_MAX_LINES", SHELL_MAX_LINES, MAX_LINES_LIMIT)
}

function shellTimeoutMs() {
  return envInt("HUNK_SHELL_TIMEOUT", 300, TIMEOUT_LIMIT_S) * 1000
}

function killGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal)
  } catch {}
}

function shellPath(): string {
  const user = process.env.SHELL
  if (user?.startsWith("/") && existsSync(user)) return user
  return existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh"
}

function shellEnv(): NodeJS.ProcessEnv {
  return {
    ...agentEnv(undefined),
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    TERM: "dumb",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  }
}

export function runShell(session: AgentSession, command: string, share: boolean) {
  if (process.env.HUNK_SHELL_DISABLED === "1") throw new HttpError(403, "Shell commands are disabled on this server")
  const cmd = command.trim()
  if (!cmd) throw new HttpError(400, "Command is empty")
  if (cmd.length > MAX_COMMAND) throw new HttpError(400, "Command is too long")
  if (session.shell) throw new HttpError(409, "A command is still running")

  const maxLines = shellMaxLines()
  const shellId = randomUUID()
  const started = Date.now()
  let tail: Tail = emptyTail()
  let finished = false
  let timedOut = false
  let snapshotTimer: NodeJS.Timeout | undefined
  let killTimer: NodeJS.Timeout | undefined
  let exitTimer: NodeJS.Timeout | undefined

  session.push({ type: "shell_start", shellId, command: cmd, share })
  // detached: its own process group, so a stop kills pipelines and
  // grandchildren too.
  const child = spawn(shellPath(), ["-c", cmd], {
    cwd: session.repo,
    env: shellEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  const pid = child.pid
  if (pid) groups.add(pid)

  const snapshot = () => {
    snapshotTimer = undefined
    if (!finished) session.broadcast({ type: "shell_output", shellId, ...tailLines(tail, maxLines) })
  }
  const onData = (chunk: string) => {
    tail = tailAppend(tail, chunk, maxLines)
    snapshotTimer ??= setTimeout(snapshot, SNAPSHOT_MS)
  }
  child.stdout.setEncoding("utf-8").on("data", onData)
  child.stderr.setEncoding("utf-8").on("data", onData)

  const stop = () => {
    if (finished || !pid) return
    killGroup(pid, "SIGTERM")
    killTimer ??= setTimeout(() => killGroup(pid, "SIGKILL"), KILL_GRACE_MS)
  }
  const timeout = setTimeout(() => {
    timedOut = true
    stop()
  }, shellTimeoutMs())

  const finish = (exitCode: number | null, signal: string | null, error?: string) => {
    if (finished) return
    finished = true
    clearTimeout(snapshotTimer)
    clearTimeout(killTimer)
    clearTimeout(exitTimer)
    clearTimeout(timeout)
    if (pid) groups.delete(pid)
    if (session.shell?.id === shellId) session.shell = null
    if (error) tail = tailAppend(tail, (tail.partial ? "\n" : "") + error + "\n", maxLines)
    const result: ShellResult = { command: cmd, ...tailLines(tail, maxLines), exitCode, signal, timedOut, durationMs: Date.now() - started }
    if (share) session.sharedShell = [...session.sharedShell, result].slice(-MAX_SHARED)
    session.push({ type: "shell_end", shellId, result })
  }

  child.on("error", e => finish(null, null, `Failed to run: ${e.message}`))
  child.on("exit", (code, signal) => {
    exitTimer = setTimeout(() => {
      if (pid) killGroup(pid, "SIGKILL")
      finish(code, signal)
    }, EXIT_GRACE_MS)
  })
  child.on("close", (code, signal) => finish(code, signal))

  session.shell = { id: shellId, stop }
}

export function stopShell(session: AgentSession, shellId: string) {
  if (session.shell?.id !== shellId) throw new HttpError(409, "That command is not running")
  session.shell.stop()
}

// The text block that tells the agent what the user ran since the last
// prompt.
export function shellContext(results: ShellResult[]): string {
  const blocks = results.map(r => {
    const status = r.timedOut ? "timed out" : r.signal ? `killed (${r.signal})` : `exit ${r.exitCode ?? "?"}`
    const hidden = r.dropped > 0 ? `[${r.dropped} earlier lines not shown]\n` : ""
    return `<shell-command status="${status}">\n$ ${r.command}\n${hidden}${r.lines.join("\n")}\n</shell-command>`
  })
  return [
    `The user ran these shell commands in the repo themselves (not you) before this message. The output is real; at most the last ${shellMaxLines()} lines of each.`,
    ...blocks,
  ].join("\n")
}
