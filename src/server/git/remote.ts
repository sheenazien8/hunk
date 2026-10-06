import "server-only"
import { parseBranchHeader } from "@/lib/git/parse-status"
import { type ActionPayload, PUSH_REJECTED } from "@/lib/git/types"
import { HttpError } from "../http"
import { hasTrackedChanges } from "./branches"
import { git, output, remoteGit } from "./exec"
import { getOperation } from "./status"

function stderrOf(e: unknown): string {
  return (e as { stderr?: string } | null)?.stderr || ""
}

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

// Upstream and ahead/behind of the current branch, as of the last fetch.
async function upstreamState(repo: string) {
  return parseBranchHeader((await git(repo, ["status", "--porcelain", "--branch", "--untracked-files=no"])).stdout)
}

async function headSha(repo: string): Promise<string> {
  return (await git(repo, ["rev-parse", "--verify", "-q", "HEAD"], { okExitCodes: [1] })).stdout.trim()
}

// Updates every remote's branches, dropping ones deleted on the remote.
export async function fetch(repo: string): Promise<string> {
  if (!(await git(repo, ["remote"])).stdout.trim()) throw new HttpError(400, "No remote configured")
  await remoteGit(repo, ["fetch", "--all", "--prune"])
  const { upstream, behind } = await upstreamState(repo)
  if (!upstream) return "Fetched"
  return behind > 0 ? `Fetched — ${plural(behind, "new commit")} on ${upstream}` : `Fetched — up to date with ${upstream}`
}

// Brings the upstream's commits in: fast-forward only, or rebasing local
// commits on top (`rebase`). Refuses with uncommitted changes to tracked
// files unless `stash` asks for them to be stashed around the pull.
export async function pull(repo: string, payload: ActionPayload): Promise<string> {
  const branch = (await git(repo, ["branch", "--show-current"])).stdout.trim()
  if (!branch) throw new HttpError(400, "Not on a branch (detached HEAD)")
  const { upstream } = await upstreamState(repo)
  if (!upstream) throw new HttpError(400, `${branch} has no upstream branch — push it first`)
  const operation = await getOperation(repo)
  if (operation) throw new HttpError(409, `Finish or abort the ${operation} in progress first`)
  if (!payload.stash && (await hasTrackedChanges(repo))) {
    throw new HttpError(409, "You have uncommitted changes — commit or stash them before pulling")
  }

  // Explicit, so a pull.rebase / pull.ff setting can't change what was asked.
  const args = ["pull", ...(payload.rebase ? ["--rebase"] : ["--no-rebase", "--ff-only"])]
  if (payload.stash) args.push("--autostash")
  const before = await headSha(repo)
  let r
  try {
    r = await remoteGit(repo, args)
  } catch (e) {
    if (/Not possible to fast-forward|diverg/i.test(stderrOf(e))) {
      throw new HttpError(409, `${branch} and ${upstream} have diverged — pull with rebase instead`)
    }
    if ((await getOperation(repo)) === "rebase") {
      throw new HttpError(409, "Rebase stopped on conflicts — resolve them, mark them resolved, then Continue (or Abort)")
    }
    throw e
  }

  const after = await headSha(repo)
  // git exits 0 here and leaves the conflicted stash entry in place.
  const stashNote = /autostash resulted in conflicts/i.test(r.stdout + r.stderr)
    ? " — re-applying your stashed changes conflicted; they're still in the stash"
    : ""
  if (before === after) return `Already up to date with ${upstream}${stashNote}`
  if (payload.rebase) return `Rebased ${branch} onto ${upstream}${stashNote}`
  const count = before ? Number((await git(repo, ["rev-list", "--count", `${before}..${after}`])).stdout.trim()) : 0
  return `Pulled ${plural(count, "commit")} from ${upstream}${stashNote}`
}

async function pushOnce(repo: string, args: string[]): Promise<string> {
  try {
    return output(await remoteGit(repo, args))
  } catch (e) {
    const stderr = stderrOf(e)
    if (/stale info/i.test(stderr)) {
      throw new HttpError(409, "Force push refused: the remote branch changed since your last fetch — fetch and review it first")
    }
    if (/\[rejected\]|non-fast-forward|fetch first/i.test(stderr)) {
      throw new HttpError(409, `${PUSH_REJECTED}: the remote has commits you don't have — pull first, or force push`)
    }
    throw e
  }
}

// Pushes the current branch, setting `origin` as its upstream the first time.
// `force` overwrites the remote branch — but only with --force-with-lease, so
// commits pushed by someone else since the last fetch are never lost.
export async function push(repo: string, payload: ActionPayload): Promise<string> {
  const force = payload.force ? ["--force-with-lease"] : []
  try {
    return (await pushOnce(repo, ["push", ...force])) || "Pushed"
  } catch (e) {
    if (!/no upstream|set-upstream/i.test(stderrOf(e))) throw e
    return (await pushOnce(repo, ["push", ...force, "-u", "origin", "HEAD"])) || "Pushed (upstream set)"
  }
}
