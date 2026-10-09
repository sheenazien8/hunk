import "server-only"
import type { NextRequest } from "next/server"
import { HttpError } from "../http"
import { resolveRepo } from "../repo"
import type { PluginConfig } from "./config"
import { projectOf } from "./mcp"
import { ensurePlugin, pluginBase } from "./process"

const DROPPED_REQUEST_HEADERS = ["host", "cookie", "connection", "content-length", "accept-encoding", "x-hunk-repo", "x-hunk-project", "x-hunk-user", "x-project-dir"]
const DROPPED_RESPONSE_HEADERS = ["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"]

export async function forwardToPlugin(req: NextRequest, plugin: PluginConfig, path: string[], user: string): Promise<Response> {
  const repoParam = req.nextUrl.searchParams.get("repo")
  const repo = repoParam ? await resolveRepo(repoParam) : null
  await ensurePlugin(plugin)

  const target = new URL(plugin.url)
  target.pathname = `${target.pathname.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}`
  target.search = req.nextUrl.search

  const headers = new Headers(req.headers)
  for (const h of DROPPED_REQUEST_HEADERS) headers.delete(h)
  headers.set("x-forwarded-prefix", pluginBase(plugin.id))
  headers.set("x-hunk-user", user)
  if (repo) {
    headers.set("x-hunk-repo", repo)
    headers.set("x-hunk-project", await projectOf(repo))
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD"
  let res: Response
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit)
  } catch {
    throw new HttpError(502, `Plugin ${plugin.id} is not reachable at ${plugin.url}`)
  }

  const out = new Headers(res.headers)
  for (const h of DROPPED_RESPONSE_HEADERS) out.delete(h)
  const location = out.get("location")
  if (location?.startsWith("/") && !location.startsWith("//")) out.set("location", `${pluginBase(plugin.id)}${location}`)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out })
}
