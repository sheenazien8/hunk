import "server-only"
import { execFile } from "child_process"
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
