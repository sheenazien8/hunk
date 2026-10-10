import type { ContentBlock, SessionUpdate, ToolCallContent } from "@agentclientprotocol/sdk"

// Images in the agent chat: what may be sent to the agent and what gets
// rendered. Shared by the server (validation, capping the event log) and
// the client (attach + display).

export interface ChatImage {
  data: string
  mimeType: string
}

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const
// Per image, decoded. Images enter the event log, which the browser replays.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_PROMPT_IMAGES = 4
// All images of one prompt, base64. The proxy buffers request bodies only up
// to 10 MB (and silently truncates past that), so stay well under it.
export const MAX_PROMPT_IMAGE_CHARS = 8 * 1024 * 1024

export function isImageType(mimeType: string): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(mimeType)
}

// Decoded size of a base64 string.
export function base64Bytes(data: string): number {
  const pad = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0
  return Math.floor((data.length * 3) / 4) - pad
}

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

// The image type its first bytes say it is, or null.
export function sniffImageType(bytes: Uint8Array): (typeof IMAGE_TYPES)[number] | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b)
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg"
  if (starts([0x47, 0x49, 0x46, 0x38])) return "image/gif"
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"
  return null
}

// What an image looks like when it can't (or mustn't) be shown.
export function imagePlaceholder(mimeType: string, data: string, reason?: string): string {
  return `[image: ${mimeType || "unknown type"}, ${formatBytes(base64Bytes(data))}${reason ? ` — ${reason}` : ""}]`
}

function capBlock(block: ContentBlock): ContentBlock {
  if (block.type !== "image" || base64Bytes(block.data) <= MAX_IMAGE_BYTES) return block
  return { type: "text", text: imagePlaceholder(block.mimeType, block.data, "too large to show") }
}

function capToolContent(content: ToolCallContent[] | null | undefined) {
  return content?.map(c => (c.type === "content" ? { ...c, content: capBlock(c.content) } : c))
}

// An agent update with oversized images replaced by a placeholder, so one
// huge screenshot (live or replayed by session/load) can't bloat the log.
export function capUpdateImages(u: SessionUpdate): SessionUpdate {
  switch (u.sessionUpdate) {
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return u.content.type === "image" ? { ...u, content: capBlock(u.content) } : u
    case "tool_call":
    case "tool_call_update":
      return u.content ? { ...u, content: capToolContent(u.content) } : u
    default:
      return u
  }
}
