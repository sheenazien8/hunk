import { readRepoFileRaw } from "@/server/fs/files"
import { requireParam, withErrors } from "@/server/http"
import { resolveRepo } from "@/server/repo"

export const GET = withErrors("Failed to read file", async req => {
  const params = req.nextUrl.searchParams
  const repo = await resolveRepo(params.get("repo"))
  const file = requireParam(params.get("file"), "No file specified")
  const { bytes, headers } = await readRepoFileRaw(repo, file)
  return new Response(new Uint8Array(bytes), { headers })
})