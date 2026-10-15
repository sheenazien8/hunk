import type { SearchOptions } from "./types"

export const PREVIEW_MAX = 240
// Context kept before the first match when a long line is cut.
const PREVIEW_LEAD = 40

// The JS equivalent of the git grep search, used to find what to highlight in
// each line git returned. Regex mode runs `git grep -P`, whose syntax JS
// mostly shares; a pattern JS can't compile just gets no highlight. Whole word
// mirrors `-w`: no word character right before or after the match.
export function searchPattern({ query, caseSensitive, wholeWord, regex }: SearchOptions): RegExp | null {
  let source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  if (wholeWord) source = `(?<!\\w)(?:${source})(?!\\w)`
  try {
    return new RegExp(source, caseSensitive ? "g" : "gi")
  } catch {
    return null
  }
}

export function matchRanges(text: string, re: RegExp): [number, number][] {
  const ranges: [number, number][] = []
  re.lastIndex = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    ranges.push([m.index, m.index + m[0].length])
  }
  return ranges
}

// The line as shown in results: leading indentation dropped and, past
// PREVIEW_MAX, cut to a window starting a little before the first match.
export function previewLine(text: string, ranges: [number, number][], max = PREVIEW_MAX): { text: string; ranges: [number, number][] } {
  let start = text.length - text.trimStart().length
  if (text.length - start > max && ranges.length > 0) start = Math.max(start, ranges[0][0] - PREVIEW_LEAD)
  const end = Math.min(text.length, start + max)
  const prefix = start > text.length - text.trimStart().length ? "…" : ""
  const suffix = end < text.length ? "…" : ""
  const shift = prefix.length - start
  return {
    text: prefix + text.slice(start, end) + suffix,
    ranges: ranges
      .filter(([a, b]) => b > start && a < end)
      .map(([a, b]) => [Math.max(a, start) + shift, Math.min(b, end) + shift]),
  }
}
