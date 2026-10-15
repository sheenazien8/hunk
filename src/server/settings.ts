import "server-only"
import path from "path"
import { randomUUID } from "crypto"
import { readFile, readlink, realpath, rename, unlink, writeFile } from "fs/promises"
import { DEFAULT_SETTINGS, mergeSettings, parseSettings, type Settings } from "@/lib/settings/types"

// settings.json: global settings edited from the Settings dialog. Read on
// every call (like acp.config.json), so edits apply without a restart.

export function settingsPath(): string {
  return process.env.HUNK_SETTINGS_PATH || path.join(process.cwd(), "settings.json")
}

export async function loadSettings(file = settingsPath()): Promise<Settings> {
  try {
    return parseSettings(JSON.parse(await readFile(file, "utf-8")))
  } catch {
    return DEFAULT_SETTINGS
  }
}

// The file a write should replace: the target of a symlink (deploy-host.sh
// links settings.json/projects.json into .next/standalone), so the rename
// doesn't swap the link for a plain file.
export async function writeTarget(file: string): Promise<string> {
  try {
    return await realpath(file)
  } catch {
    try {
      return path.resolve(path.dirname(file), await readlink(file))
    } catch {
      return file
    }
  }
}

// PATCHes run one after another so concurrent ones can't lose each other's changes.
let queue: Promise<unknown> = Promise.resolve()

export function updateSettings(patch: unknown, file = settingsPath()): Promise<Settings> {
  const run = queue.then(async () => {
    const next = mergeSettings(await loadSettings(file), patch)
    const target = await writeTarget(file)
    const tmp = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf-8")
      await rename(tmp, target)
    } catch (e) {
      await unlink(tmp).catch(() => {})
      throw e
    }
    return next
  })
  queue = run.catch(() => {})
  return run
}
