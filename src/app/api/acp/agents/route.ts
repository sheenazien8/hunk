import { NextResponse } from "next/server"
import type { AgentsResponse } from "@/lib/acp/types"
import { loadAgents } from "@/server/acp/config"
import { withErrors } from "@/server/http"
import { loadSettings } from "@/server/settings"

// The settings' default agent comes first: the client picks the first one
// when the browser has no last-used agent.
export const GET = withErrors("Failed to load agents", async () => {
  const { defaultAgent } = (await loadSettings()).agent
  const agents = (await loadAgents())
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => Number(b.id === defaultAgent) - Number(a.id === defaultAgent))
  return NextResponse.json({ agents } satisfies AgentsResponse)
})
