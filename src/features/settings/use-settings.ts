import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api-client"
import { DEFAULT_SETTINGS, mergeSettings, type SettingsPatch, type SettingsResponse } from "@/lib/settings/types"

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Until the GET answers, `settings` are the defaults.
export function useSettings(onError: (message: string) => void) {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  })
  // Set once a PATCH started: its response is newer than a GET still in flight.
  const patchedRef = useRef(false)

  useEffect(() => {
    api.settings.get().then(
      res => {
        if (!patchedRef.current) setData(res)
      },
      e => onErrorRef.current(`Couldn't load settings: ${errorText(e)}`),
    )
  }, [])

  const update = useCallback(async (patch: SettingsPatch) => {
    patchedRef.current = true
    const before = data
    setData(prev => ({
      env: prev?.env ?? {},
      ignoreDefaults: prev?.ignoreDefaults ?? [],
      settings: mergeSettings(prev?.settings ?? DEFAULT_SETTINGS, patch),
    }))
    try {
      setData(await api.settings.update(patch))
      return true
    } catch (e) {
      onErrorRef.current(`Couldn't save settings: ${errorText(e)}`)
      setData(await api.settings.get().catch(() => before))
      return false
    }
  }, [data])

  return {
    settings: data?.settings ?? DEFAULT_SETTINGS,
    loaded: !!data,
    env: data?.env ?? {},
    ignoreDefaults: data?.ignoreDefaults ?? [],
    update,
  }
}

export type SettingsState = ReturnType<typeof useSettings>
