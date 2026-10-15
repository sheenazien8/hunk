import { NextResponse } from "next/server"
import { searchRepo } from "@/server/git/search"
import { withErrors } from "@/server/http"
import { resolveRepo } from "@/server/repo"

export const GET = withErrors("Search failed", async req => {
  const params = req.nextUrl.searchParams
  const repo = await resolveRepo(params.get("repo"))
  return NextResponse.json(await searchRepo(repo, {
    query: params.get("q") ?? "",
    caseSensitive: params.get("case") === "1",
    wholeWord: params.get("word") === "1",
    regex: params.get("regex") === "1",
    include: params.get("include") ?? undefined,
    exclude: params.get("exclude") ?? undefined,
  }))
})
