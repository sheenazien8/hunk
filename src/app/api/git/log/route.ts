import { NextResponse } from "next/server"
import { getLog, MAX_LOG_LIMIT } from "@/server/git/log"
import { withErrors } from "@/server/http"
import { resolveRepo } from "@/server/repo"

function intParam(value: string | null, fallback: number, max: number) {
  const n = Number(value)
  return value && Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback
}

export const GET = withErrors("Failed to load history", async req => {
  const params = req.nextUrl.searchParams
  const repo = await resolveRepo(params.get("repo"))
  const file = params.get("file") || undefined
  const ref = params.get("ref") || undefined
  const limit = Math.max(1, intParam(params.get("limit"), 50, MAX_LOG_LIMIT))
  const skip = intParam(params.get("skip"), 0, Number.MAX_SAFE_INTEGER)
  return NextResponse.json(await getLog(repo, { file, ref, limit, skip }))
})
