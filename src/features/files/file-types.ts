const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
  ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
  ".mp3", ".mp4", ".avi", ".mov",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".wasm", ".so", ".dll", ".exe", ".dylib",
])

export function isBinaryFile(file: string) {
  const extIndex = file.lastIndexOf(".")
  if (extIndex === -1) return false
  return BINARY_EXTS.has(file.slice(extIndex).toLowerCase())
}

// Formats the browser renders with <img>, svg included.
const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
])

export function isImageFile(file: string) {
  const extIndex = file.lastIndexOf(".")
  if (extIndex === -1) return false
  return IMAGE_EXTS.has(file.slice(extIndex).toLowerCase())
}

export function isMarkdownFile(file: string) {
  return /\.(md|markdown|mdx)$/i.test(file)
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", mdx: "markdown",
  py: "python", go: "go", rs: "rust", rb: "ruby",
  css: "css", scss: "scss", html: "xml", xml: "xml", svg: "xml",
  sh: "bash", bash: "bash", zsh: "bash",
  yml: "yaml", yaml: "yaml", toml: "ini", sql: "sql",
  java: "java", kt: "kotlin", swift: "swift",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp",
  cs: "csharp", php: "php", dart: "dart", lua: "lua",
  dockerfile: "dockerfile", makefile: "makefile",
}

// highlight.js language name for a file, or undefined to auto-detect.
export function langForFile(file: string): string | undefined {
  const ext = file.split(".").pop()?.toLowerCase() ?? ""
  return EXT_TO_LANG[ext]
}

export function basename(file: string) {
  return file.split("/").pop() ?? file
}
