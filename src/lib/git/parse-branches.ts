import type { Branch } from "./types"

// `git for-each-ref` format for parseBranches: one ref per line, fields
// NUL-separated. Subjects are single-line, so newlines are safe as separators.
export const BRANCH_FORMAT = [
  "%(refname)",
  "%(refname:short)",
  "%(HEAD)",
  "%(objectname:short)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
  "%(worktreepath)",
  "%(committerdate:iso-strict)",
  "%(contents:subject)",
].join("%00")

// "ahead 2, behind 1" / "ahead 3" / "gone" / "".
export function parseTrack(track: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 }
}

// Parses `git for-each-ref --format=<BRANCH_FORMAT> refs/heads refs/remotes`.
// Remote HEAD symrefs ("origin/HEAD") are skipped.
export function parseBranches(output: string): Branch[] {
  const branches: Branch[] = []
  for (const line of output.split("\n")) {
    const fields = line.split("\0")
    if (fields.length < 9) continue
    const [ref, name, head, shortSha, upstream, track, worktree, date, ...subject] = fields
    const remote = ref.startsWith("refs/remotes/")
    if (!remote && !ref.startsWith("refs/heads/")) continue
    if (remote && ref.endsWith("/HEAD")) continue
    branches.push({
      name,
      remote,
      current: head === "*",
      shortSha,
      upstream: upstream || undefined,
      ...parseTrack(track),
      worktree: worktree || undefined,
      date,
      subject: subject.join("\0"),
    })
  }
  return branches
}
