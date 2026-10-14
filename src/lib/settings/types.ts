import { SHELL_MAX_LINES } from "@/lib/acp/tail-lines"

// Only things that are safe to change from the browser live here. What runs
// on the host (agent/plugin commands), which repos are reachable and whether
// shell commands are allowed stay env/config-file only.

export type DiffView = "split" | "unified"
export type ThemeSetting = "light" | "dark" | "system"

export interface Settings {
  agent: {
    // Starting value of auto mode for new, loaded and resumed sessions.
    autoApproveDefault: boolean
    // Agent id from acp.config.json picked when the browser has no last-used
    // agent; "" = the first one.
    defaultAgent: string
    // `!` command limits (HUNK_SHELL_MAX_LINES / HUNK_SHELL_TIMEOUT win when set).
    shellMaxLines: number
    // Seconds
    shellTimeout: number
  }
  viewer: {
    defaultDiffView: DiffView
    renderMarkdown: boolean
  }
  git: {
    confirmPush: boolean
  }
  files: {
    // Global All Files ignore patterns; null (or empty) = ignore.config.json,
    // else the built-in list.
    ignore: string[] | null
  }
  theme: ThemeSetting
}

export const SHELL_LINES_MAX = 5_000
export const SHELL_TIMEOUT_MAX = 24 * 60 * 60
const IGNORE_MAX = 500
const PATTERN_MAX = 200

export const DEFAULT_SETTINGS: Settings = {
  agent: { autoApproveDefault: false, defaultAgent: "", shellMaxLines: SHELL_MAX_LINES, shellTimeout: 300 },
  viewer: { defaultDiffView: "split", renderMarkdown: false },
  git: { confirmPush: false },
  files: { ignore: null },
  theme: "system",
}

// GET/PATCH /api/settings
export interface SettingsResponse {
  settings: Settings
  // Values env vars set instead (read-only in the UI).
  env: { shellMaxLines?: number; shellTimeout?: number }
  // What files.ignore falls back to when it's null.
  ignoreDefaults: string[]
}

export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends unknown[] | string | number | boolean | null
    ? Settings[K]
    : { [P in keyof Settings[K]]?: Settings[K][P] }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback)

function oneOf<T extends string>(v: unknown, values: readonly T[], fallback: T): T {
  return values.includes(v as T) ? (v as T) : fallback
}

export function clampInt(v: unknown, fallback: number, max: number): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback
}

function ignoreList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const list = v
    .filter((p): p is string => typeof p === "string")
    .map(p => p.trim())
    .filter(p => p !== "" && p.length <= PATTERN_MAX)
  // Empty = back to the defaults: an empty list would walk .git and
  // node_modules.
  return list.length > 0 ? [...new Set(list)].slice(0, IGNORE_MAX) : null
}

export function parseSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS
  const root = isObject(raw) ? raw : {}
  const agent = isObject(root.agent) ? root.agent : {}
  const viewer = isObject(root.viewer) ? root.viewer : {}
  const git = isObject(root.git) ? root.git : {}
  const files = isObject(root.files) ? root.files : {}
  return {
    agent: {
      autoApproveDefault: bool(agent.autoApproveDefault, d.agent.autoApproveDefault),
      defaultAgent: typeof agent.defaultAgent === "string" ? agent.defaultAgent.trim() : d.agent.defaultAgent,
      shellMaxLines: clampInt(agent.shellMaxLines, d.agent.shellMaxLines, SHELL_LINES_MAX),
      shellTimeout: clampInt(agent.shellTimeout, d.agent.shellTimeout, SHELL_TIMEOUT_MAX),
    },
    viewer: {
      defaultDiffView: oneOf(viewer.defaultDiffView, ["split", "unified"] as const, d.viewer.defaultDiffView),
      renderMarkdown: bool(viewer.renderMarkdown, d.viewer.renderMarkdown),
    },
    git: {
      confirmPush: bool(git.confirmPush, d.git.confirmPush),
    },
    files: {
      ignore: ignoreList(files.ignore),
    },
    theme: oneOf(root.theme, ["light", "dark", "system"] as const, d.theme),
  }
}

// Applies a PATCH: sections merge key by key, everything else (arrays,
// scalars, null) replaces. A patch value of the wrong shape for a section is
// ignored rather than wiping it. The result is validated.
export function mergeSettings(current: Settings, patch: unknown): Settings {
  if (!isObject(patch)) return current
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    const base = (current as unknown as Record<string, unknown>)[key]
    if (isObject(base)) {
      if (isObject(value)) next[key] = { ...base, ...value }
    } else {
      next[key] = value
    }
  }
  return parseSettings(next)
}
