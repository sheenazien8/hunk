import { useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import type { PluginInfo } from "@/lib/plugins/types"

export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null)
  useEffect(() => {
    api.plugins().then(setPlugins, () => setPlugins([]))
  }, [])
  return plugins
}
