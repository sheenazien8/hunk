import { NextResponse } from "next/server"
import type { Settings, SettingsResponse } from "@/lib/settings/types"
import { shellEnvLimits } from "@/server/acp/shell"
import { defaultIgnorePatterns } from "@/server/config"
import { HttpError, readJson, withErrors } from "@/server/http"
import { loadSettings, updateSettings } from "@/server/settings"

async function respond(settings: Settings) {
  return NextResponse.json({ settings, env: shellEnvLimits(), ignoreDefaults: await defaultIgnorePatterns() } satisfies SettingsResponse)
}

export const GET = withErrors("Failed to load settings", async () => respond(await loadSettings()))

export const PATCH = withErrors("Failed to save settings", async req => {
  const patch = await readJson<unknown>(req)
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new HttpError(400, "Expected a settings object")
  return respond(await updateSettings(patch))
})
