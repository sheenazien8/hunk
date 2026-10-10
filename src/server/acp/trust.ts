import "server-only"
import { mkdir, readFile, realpath, rename, stat, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { HttpError } from "../http"
import type { AgentConfig } from "./config"

// Marks a repo as trusted in the agent's own store, the same thing its
// terminal trust prompt saves. Agents read it at startup.
// ponytail: agent recognised by its command (claude-agent-acp / pi-acp);
// add a `trust` field to acp.config.json if a wrapper script hides it.
export async function trustProject(agent: AgentConfig, repo: string): Promise<void> {
  const command = agent.command.join(" ")
  if (/\bclaude-agent-acp\b/.test(command)) {
    const file = path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), ".claude.json")
    return updateJson(file, data => {
      const projects = (data.projects ??= {}) as Record<string, Record<string, unknown>>
      projects[repo] = { ...projects[repo], hasTrustDialogAccepted: true }
    })
  }
  if (/\bpi-acp\b/.test(command)) {
    const file = path.join(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"), "trust.json")
    const key = await realpath(repo).catch(() => repo)
    return updateJson(file, data => {
      data[key] = true
    })
  }
  throw new HttpError(400, `${agent.name} has no project trust Hunk can set`)
}

// Read-modify-write that never clobbers a file it can't parse, and swaps
// the new one in atomically with the old mode.
// ponytail: no lock; a concurrent write by the agent itself could win.
async function updateJson(file: string, update: (data: Record<string, unknown>) => void) {
  let text = "{}"
  let mode = 0o600
  try {
    text = await readFile(file, "utf-8")
    mode = (await stat(file)).mode & 0o777
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new HttpError(500, `Can't parse ${file}; not changing it`)
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(500, `Unexpected content in ${file}; not changing it`)
  update(data as Record<string, unknown>)
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.hunk-${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode })
  await rename(tmp, file)
}
