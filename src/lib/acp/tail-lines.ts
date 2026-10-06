// Keeps the last N lines of a command's output as it streams in. Pure and
// immutable, so the server (while the command runs) and the transcript fold
// (on the client) share it.

export const SHELL_MAX_LINES = 150
const MAX_LINE = 2_000
// A line that never ends (no "\n") is cut to its last this-many chars.
const MAX_PARTIAL = 64_000

export interface Tail {
  lines: string[]
  // Text after the last "\n" (the line still being written)
  partial: string
  // Complete lines that fell off the front
  dropped: number
}

export function emptyTail(): Tail {
  return { lines: [], partial: "", dropped: 0 }
}

// ESC sequences (CSI, OSC, single-char) and other control chars except tab.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b-\x1f\x7f]/g

// One output line as it would look in a terminal: a "\r" progress bar keeps
// only what was written last, escape codes go, very long lines are cut.
export function cleanLine(line: string): string {
  let s = line.endsWith("\r") ? line.slice(0, -1) : line
  const cr = s.lastIndexOf("\r")
  if (cr >= 0) s = s.slice(cr + 1)
  s = s.replace(ANSI, "")
  return s.length > MAX_LINE ? s.slice(0, MAX_LINE) + "…" : s
}

export function tailAppend(t: Tail, chunk: string, max = SHELL_MAX_LINES): Tail {
  if (!chunk) return t
  const parts = (t.partial + chunk).split("\n")
  let partial = parts.pop() ?? ""
  if (partial.length > MAX_PARTIAL) partial = partial.slice(-MAX_PARTIAL)
  if (parts.length === 0) return { ...t, partial }
  const fresh = parts.length > max ? parts.slice(-max) : parts
  let dropped = t.dropped + parts.length - fresh.length
  let lines = t.lines.concat(fresh.map(cleanLine))
  if (lines.length > max) {
    dropped += lines.length - max
    lines = lines.slice(-max)
  }
  return { lines, partial, dropped }
}

// The output so far, the unfinished line included.
export function tailLines(t: Tail, max = SHELL_MAX_LINES): { lines: string[]; dropped: number } {
  if (!t.partial) return { lines: t.lines, dropped: t.dropped }
  const lines = [...t.lines, cleanLine(t.partial)]
  return lines.length > max ? { lines: lines.slice(-max), dropped: t.dropped + lines.length - max } : { lines, dropped: t.dropped }
}
