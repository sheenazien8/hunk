// Agent terminal output: the agent runs the command in its own process and
// reports the bytes through ACP (terminal content refs, `terminal_update` /
// `terminal_output_chunk` v2 updates, or pi-style `_meta.terminal_*` patches).
// Hunk only displays them, so this is pure decode + bounding; the session
// (`AgentSession`) owns the buffer per terminalId.
export const TERMINAL_MAX_BYTES = 64 * 1024

export interface TerminalBuffer {
  command: string | null
  cwd: string | null
  text: string
}

// One reported change for a terminal.
export interface TerminalPatch {
  id: string
  command?: string | null
  cwd?: string | null
  // Text to append, or (with `replace`) the full buffer
  text?: string
  // true = text is a replacement snapshot, not an append
  replace?: boolean
  exit?: { exitCode: number | null; signal: string | null } | null
}

// Decodes one report: base64 (`data` contentEncoding, v2 RFD / claude's
// delta meta) is turned into text; invalid UTF-8 keeps replacement
// characters (lossy). Chunks that split a code point get one — the buffer
// merges text, so only the boundary char is affected.
export function decodeTerminalChunk(data: string, base64: boolean): string {
  if (!data) return ""
  if (!base64) return data
  const bytes = base64Bytes(data)
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes)
}

export function decodeTerminalBase64(data: string): string {
  return decodeTerminalChunk(data, true)
}

// Tail of a text buffer bounded by bytes, so one huge command cannot bloat
// the session. Cuts at a UTF-16 boundary: only whole code units are kept.
export function tailBytes(text: string, max = TERMINAL_MAX_BYTES): string {
  let from = 0
  while (TextEncoderByteLength(text.slice(from)) > max) from++
  return text.slice(from)
}

// Byte length of a text buffer without copying (chunked into encodeInto).
function TextEncoderByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i += 0x8000) bytes += new TextEncoder().encodeInto(text.slice(i, i + 0x8000), new Uint8Array(4 * 0x8000)).written
  return bytes
}

function base64Bytes(data: string): Uint8Array {
  const binary = atobStrict(data.replace(/\s+/g, ""))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function atobStrict(data: string): string {
  if (typeof atob === "function") return atob(data)
  // Node without a global atob (very old): the Buffer path keeps the tests
  // and server code working in either runtime.
  return (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } }).Buffer!.from(data, "base64").toString("binary")
}