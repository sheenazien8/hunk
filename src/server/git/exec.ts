import "server-only"
import { execFile, spawn } from "child_process"
import { promisify } from "util"
import { HttpError } from "../http"

const execFileAsync = promisify(execFile)

export const MAX_BUFFER = 10 * 1024 * 1024

// `git hash-object -t tree /dev/null` — diffing the index against this shows
// every staged file as added when HEAD doesn't exist yet.
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

export interface GitResult {
  stdout: string
  stderr: string
}

interface GitOptions {
  maxBuffer?: number
  // Non-zero exit codes that still mean success (e.g. 1 for `diff --no-index`).
  okExitCodes?: number[]
  // Merged over process.env.
  env?: Record<string, string>
  // Kill git after this many ms (0 = never).
  timeout?: number
}

// Runs git with an argument array — no shell, so paths are never interpreted.
export async function git(repo: string, args: string[], opts: GitOptions = {}): Promise<GitResult> {
  try {
    return await execFileAsync("git", args, {
      cwd: repo,
      maxBuffer: opts.maxBuffer ?? MAX_BUFFER,
      env: opts.env ? { ...process.env, ...opts.env } : undefined,
      timeout: opts.timeout ?? 0,
    })
  } catch (e) {
    const err = e as { code?: unknown; stdout?: string; stderr?: string }
    if (typeof err.code === "number" && opts.okExitCodes?.includes(err.code)) {
      return { stdout: err.stdout ?? "", stderr: err.stderr ?? "" }
    }
    throw e
  }
}

export interface GitLinesResult {
  // onLine asked to stop, so git was killed before it finished.
  stopped: boolean
  timedOut: boolean
}

// Runs git and hands stdout to `onLine` one line at a time, for output too big
// to buffer (e.g. grep over a whole repo). Returning false from `onLine` kills
// git. Fails like git() on any other exit code, with stderr on the error.
export function gitLines(
  repo: string,
  args: string[],
  onLine: (line: string) => boolean | void,
  opts: Pick<GitOptions, "okExitCodes" | "timeout"> = {},
): Promise<GitLinesResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] })
    let stopped = false
    let timedOut = false
    let rest = ""
    let stderr = ""
    const stop = () => {
      stopped = true
      child.stdout.removeAllListeners("data")
      child.kill()
    }
    const timer = opts.timeout ? setTimeout(() => {
      timedOut = true
      stop()
    }, opts.timeout) : undefined

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      const lines = (rest + chunk).split("\n")
      rest = lines.pop() ?? ""
      for (const line of lines) {
        if (onLine(line) === false) {
          stop()
          return
        }
      }
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk
    })
    child.on("error", e => {
      clearTimeout(timer)
      reject(e)
    })
    child.on("close", code => {
      clearTimeout(timer)
      if (stopped) return resolve({ stopped: !timedOut, timedOut })
      if (code !== 0 && !opts.okExitCodes?.includes(code ?? -1)) {
        return reject(Object.assign(new Error(stderr.trim() || `git exited with ${code}`), { code, stderr }))
      }
      if (rest) onLine(rest)
      resolve({ stopped: false, timedOut: false })
    })
  })
}

export const REMOTE_TIMEOUT = 60_000

// Fetch/pull/push: they may ask for credentials, and nobody is there to type
// them. git must not prompt on the terminal, and ssh must not either: forcing
// its askpass to `false` makes password, passphrase and host-key prompts fail
// at once (credential helpers and ssh-agent still work). REMOTE_TIMEOUT
// catches anything else, so a missing login surfaces as an error instead of
// a request that never ends.
export async function remoteGit(repo: string, args: string[], opts: GitOptions = {}): Promise<GitResult> {
  try {
    return await git(repo, args, {
      timeout: REMOTE_TIMEOUT,
      ...opts,
      env: { GIT_TERMINAL_PROMPT: "0", SSH_ASKPASS_REQUIRE: "force", SSH_ASKPASS: "false", ...opts.env },
    })
  } catch (e) {
    if ((e as { killed?: boolean }).killed) {
      throw new HttpError(504, "Timed out talking to the remote — is it reachable, and are credentials set up?")
    }
    throw e
  }
}

// True when a git error was caused by HEAD not existing yet (no commits).
export function isUnbornHead(e: unknown): boolean {
  const stderr = (e as { stderr?: string } | null)?.stderr || ""
  const msg = stderr || (e instanceof Error ? e.message : "")
  return /Failed to resolve 'HEAD'|unborn|bad revision|unknown revision|does not have any commits yet/i.test(msg)
}

export function output(r: GitResult): string {
  return (r.stdout || r.stderr).trim()
}
