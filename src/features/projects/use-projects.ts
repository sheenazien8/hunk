import { useCallback, useEffect, useRef, useState } from "react"
import type { Project, ProjectInput } from "@/lib/git/types"
import { api } from "@/lib/api-client"

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// The projects.json list, fetched once and refreshed after every mutation.
// Mutations throw (the caller shows the message); the list on screen stays put
// on failure.
export function useProjects(onError: (message: string) => void) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loaded, setLoaded] = useState(false)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  })

  useEffect(() => {
    api.projects.list().then(
      list => {
        setProjects(list)
        setLoaded(true)
      },
      e => onErrorRef.current(`Couldn't load projects: ${errorText(e)}`),
    )
  }, [])

  const run = useCallback(async (fn: () => Promise<Project[]>) => {
    const next = await fn()
    setProjects(next)
    return next
  }, [])

  return {
    projects,
    loaded,
    add: (project: ProjectInput) => run(() => api.projects.add(project)),
    update: (dir: string, project: ProjectInput) => run(() => api.projects.update(dir, project)),
    remove: (dir: string) => run(() => api.projects.remove(dir)),
  }
}

export type ProjectsState = ReturnType<typeof useProjects>
