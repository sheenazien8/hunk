import "server-only"
import type { ActionPayload, GitOperation } from "@/lib/git/types"
import { HttpError } from "../http"
import { git } from "./exec"
import { requireSha } from "./refs"
import { getOperation } from "./status"

// `--continue` must not open an editor for the message — nobody can type in it.
const NO_EDITOR = { env: { GIT_EDITOR: "true" } }

function stderrOf(e: unknown): string {
  return (e as { stderr?: string } | null)?.stderr || ""
}

async function headSha(repo: string): Promise<string> {
  const sha = (await git(repo, ["rev-parse", "--verify", "-q", "HEAD"], { okExitCodes: [1] })).stdout.trim()
  if (!sha) throw new HttpError(400, "No commits yet")
  return sha
}

async function subjectOf(repo: string, sha: string): Promise<string> {
  return (await git(repo, ["log", "-1", "--format=%s", sha, "--"])).stdout.trim()
}

async function refuseDuringOperation(repo: string) {
  const operation = await getOperation(repo)
  if (operation) throw new HttpError(409, `Finish or abort the ${operation} in progress first`)
}

// Rewrites the last commit with what's staged; an empty message keeps the
// current one.
export async function amend(repo: string, payload: ActionPayload): Promise<string> {
  await headSha(repo).catch(() => {
    throw new HttpError(400, "Nothing to amend — no commits yet")
  })
  await refuseDuringOperation(repo)
  const message = (payload.message || "").trim()
  await git(repo, ["commit", "--amend", ...(message ? ["-m", message] : ["--no-edit"])])
  return `Amended "${await subjectOf(repo, "HEAD")}"`
}

// Drops the last commit but keeps its changes staged. `sha` is the HEAD the
// UI showed: if it has moved since, the user would undo something else.
export async function undoCommit(repo: string, payload: ActionPayload): Promise<string> {
  const head = await headSha(repo)
  if (payload.sha !== undefined && !head.startsWith(requireSha(payload.sha).toLowerCase())) {
    throw new HttpError(409, "HEAD has moved — refresh and try again")
  }
  const parent = (await git(repo, ["rev-parse", "--verify", "-q", "HEAD~1"], { okExitCodes: [1] })).stdout.trim()
  if (!parent) throw new HttpError(400, "Can't undo the first commit")
  await refuseDuringOperation(repo)
  const subject = await subjectOf(repo, head)
  await git(repo, ["reset", "--soft", parent])
  return `Undid "${subject}" — its changes are staged`
}

type PickKind = "revert" | "cherry-pick"

// Applies a commit (cherry-pick) or its inverse (revert) as a new commit.
// Merge commits are taken relative to their first parent (-m 1), the side
// they were merged into. Conflicts leave the operation in progress for the
// conflict view + continue/abort.
async function pick(repo: string, kind: PickKind, payload: ActionPayload): Promise<string> {
  const sha = requireSha(payload.sha)
  const full = (await git(repo, ["rev-parse", "--verify", "-q", `${sha}^{commit}`], { okExitCodes: [1] })).stdout.trim()
  if (!full) throw new HttpError(404, `Unknown commit: ${sha}`)
  await refuseDuringOperation(repo)
  const parents = (await git(repo, ["rev-list", "--parents", "-n", "1", full, "--"])).stdout.trim().split(" ").length - 1
  const short = full.slice(0, 7)
  const args = [kind, ...(parents > 1 ? ["-m", "1"] : []), ...(kind === "revert" ? ["--no-edit"] : []), full]

  try {
    await git(repo, args)
  } catch (e) {
    const stderr = stderrOf(e)
    const operation = await getOperation(repo)
    if (/would be overwritten|your local changes|uncommitted changes/i.test(stderr) && !operation) {
      throw new HttpError(409, "You have uncommitted changes — commit or stash them first")
    }
    // Nothing left to commit: the change is already there (cherry-pick) or
    // already undone (revert). Don't leave an empty operation hanging.
    if (/is now empty|nothing to commit/i.test(stderr)) {
      if (operation) await git(repo, [kind, "--abort"]).catch(() => undefined)
      throw new HttpError(409, kind === "revert"
        ? `Nothing to revert — the changes of ${short} are already undone`
        : `Nothing to cherry-pick — the changes of ${short} are already on this branch`)
    }
    if (operation) {
      const what = kind === "revert" ? "Revert" : "Cherry-pick"
      throw new HttpError(409, `${what} of ${short} stopped on conflicts — resolve them, mark them resolved, then Continue (or Abort)`)
    }
    throw e
  }

  if (kind === "revert") return `Reverted ${short}`
  const branch = (await git(repo, ["branch", "--show-current"])).stdout.trim()
  return `Cherry-picked ${short}${branch ? ` onto ${branch}` : ""}`
}

export function revert(repo: string, payload: ActionPayload) {
  return pick(repo, "revert", payload)
}

export function cherryPick(repo: string, payload: ActionPayload) {
  return pick(repo, "cherry-pick", payload)
}

async function requireOperation(repo: string, verb: string): Promise<GitOperation> {
  const operation = await getOperation(repo)
  if (!operation) throw new HttpError(400, `Nothing to ${verb} — no merge, rebase, cherry-pick or revert in progress`)
  return operation
}

const CONTINUE: Record<GitOperation, string[]> = {
  merge: ["commit", "--no-edit"],
  rebase: ["rebase", "--continue"],
  "cherry-pick": ["cherry-pick", "--continue"],
  revert: ["revert", "--continue"],
}

// Commits the resolved step and carries on. A rebase can stop again on the
// next commit's conflicts; that's reported, not treated as a failure.
export async function continueOperation(repo: string): Promise<string> {
  const operation = await requireOperation(repo, "continue")
  const unmerged = (await git(repo, ["diff", "--name-only", "--diff-filter=U"])).stdout.trim()
  if (unmerged) throw new HttpError(409, "Resolve every conflicted file and mark it resolved first")
  try {
    await git(repo, CONTINUE[operation], NO_EDITOR)
  } catch (e) {
    if ((await getOperation(repo)) !== operation) throw e
    if ((await git(repo, ["diff", "--name-only", "--diff-filter=U"])).stdout.trim()) {
      throw new HttpError(409, `The ${operation} stopped on new conflicts — resolve them, then Continue again`)
    }
    if (/is now empty|nothing to commit/i.test(stderrOf(e))) {
      throw new HttpError(409, `Nothing left to commit in this ${operation} step — Abort it, or make a change first`)
    }
    throw e
  }
  return `Continued the ${operation}${(await getOperation(repo)) ? "" : " — done"}`
}

// Puts the branch and working tree back as they were before the operation.
export async function abortOperation(repo: string): Promise<string> {
  const operation = await requireOperation(repo, "abort")
  await git(repo, [operation, "--abort"])
  return `Aborted the ${operation}`
}
