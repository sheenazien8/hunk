import "server-only"
import { matchRanges, previewLine, searchPattern } from "@/lib/git/search-ranges"
import type { SearchFileResult, SearchOptions, SearchResponse } from "@/lib/git/types"
import { loadIgnorePatterns } from "../config"
import { isIgnored } from "../fs/walk"
import { HttpError } from "../http"
import { gitLines } from "./exec"

export const SEARCH_LIMIT = 2000
const SEARCH_TIMEOUT = 20_000
const MAX_QUERY = 1000

// Comma-separated globs → git pathspecs. A bare name ("*.ts", "node_modules")
// matches at any depth, a path ("src/lib") from the repo root; either matches
// a folder's contents too.
export function globPathspecs(globs: string | undefined, exclude: boolean): string[] {
  const magic = exclude ? ":(exclude,glob)" : ":(glob)"
  return (globs ?? "")
    .split(",")
    .map(g => g.trim().replace(/^\.\//, "").replace(/\/+$/, ""))
    .filter(Boolean)
    .flatMap(g => {
      const base = g.includes("/") ? g.replace(/^\/+/, "") : `**/${g}`
      return [`${magic}${base}`, `${magic}${base}/**`]
    })
}

function grepArgs(opts: SearchOptions, regexFlag: "-P" | "-E"): string[] {
  return [
    "grep", "-n", "-I", "--null", "--untracked", "--no-color",
    opts.regex ? regexFlag : "-F",
    ...(opts.caseSensitive ? [] : ["-i"]),
    ...(opts.wholeWord ? ["-w"] : []),
    "-e", opts.query,
    "--",
    ...globPathspecs(opts.include, false),
    ...globPathspecs(opts.exclude, true),
  ]
}

// Content search over the working tree: tracked and untracked files, minus
// git-ignored ones (git grep --untracked), binaries (-I) and the All Files
// ignore patterns. Stops at `limit` matching lines.
export async function searchRepo(repo: string, opts: SearchOptions, limit = SEARCH_LIMIT): Promise<SearchResponse> {
  if (!opts.query) return { files: [], total: 0, truncated: false }
  if (opts.query.length > MAX_QUERY) throw new HttpError(400, "Search query is too long")

  const patterns = await loadIgnorePatterns(repo)
  const ignored = new Map<string, boolean>()
  const re = searchPattern(opts)

  const run = async (regexFlag: "-P" | "-E") => {
    const files: SearchFileResult[] = []
    let total = 0
    const result = await gitLines(repo, grepArgs(opts, regexFlag), line => {
      const a = line.indexOf("\0")
      const b = line.indexOf("\0", a + 1)
      if (a < 0 || b < 0) return
      const path = line.slice(0, a)
      let skip = ignored.get(path)
      if (skip === undefined) ignored.set(path, skip = isIgnored(path.split("/"), patterns))
      if (skip) return
      if (total >= limit) return false
      const text = line.slice(b + 1)
      const match = { line: Number(line.slice(a + 1, b)), ...previewLine(text, re ? matchRanges(text, re) : []) }
      const last = files[files.length - 1]
      if (last?.path === path) last.matches.push(match)
      else files.push({ path, matches: [match] })
      total++
    }, { okExitCodes: [1], timeout: SEARCH_TIMEOUT })
    return { files, total, truncated: result.stopped || result.timedOut }
  }

  try {
    return await run("-P")
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr ?? ""
    // git built without PCRE: fall back to extended regex.
    if (opts.regex && /perl|pcre/i.test(stderr) && /compiled|support/i.test(stderr)) return await run("-E").catch(invalidRegex)
    return invalidRegex(e)
  }

  function invalidRegex(e: unknown): never {
    const stderr = (e as { stderr?: string }).stderr ?? ""
    if (opts.regex && (e as { code?: unknown }).code === 128) {
      throw new HttpError(400, `Invalid regex: ${stderr.trim().replace(/^fatal:\s*/, "")}`)
    }
    throw e
  }
}
