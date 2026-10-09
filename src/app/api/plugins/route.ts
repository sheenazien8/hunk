import { NextResponse } from "next/server"
import type { PluginsResponse } from "@/lib/plugins/types"
import { withErrors } from "@/server/http"
import { loadPlugins } from "@/server/plugins/config"

export const GET = withErrors("Failed to load plugins", async () => {
  const plugins = (await loadPlugins()).map(({ id, name }) => ({ id, name }))
  return NextResponse.json({ plugins } satisfies PluginsResponse)
})
