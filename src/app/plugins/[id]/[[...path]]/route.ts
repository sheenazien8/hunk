import type { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/auth"
import { HttpError, withErrors } from "@/server/http"
import { findPlugin } from "@/server/plugins/config"
import { forwardToPlugin } from "@/server/plugins/forward"

async function handle(req: NextRequest, ctx: RouteContext<"/plugins/[id]/[[...path]]">) {
  const { id, path = [] } = await ctx.params
  return withErrors("Plugin request failed", async () => {
    const user = await getSessionUser(req)
    if (!user) throw new HttpError(401, "Unauthorized")
    return forwardToPlugin(req, await findPlugin(id), path, user.username)
  })(req)
}

export const GET = handle
export const HEAD = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
