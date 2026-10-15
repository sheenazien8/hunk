import { NextResponse } from "next/server"
import type { ProjectInput, ProjectsResponse } from "@/lib/git/types"
import { listProjects } from "@/server/config"
import { HttpError, readJson, requireParam, withErrors } from "@/server/http"
import { addProject, removeProject, updateProject } from "@/server/projects"

const respond = (projects: ProjectsResponse["projects"]) =>
  NextResponse.json({ projects } satisfies ProjectsResponse)

function body(value: unknown): ProjectInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Expected a project object")
  return value as ProjectInput
}

export const GET = withErrors("Failed to load projects", async () => respond(listProjects()))

export const POST = withErrors("Failed to add project", async req =>
  respond(await addProject(body(await readJson<unknown>(req)))))

export const PATCH = withErrors("Failed to update project", async req => {
  const { dir, next } = await readJson<{ dir?: string; next?: unknown }>(req)
  return respond(await updateProject(requireParam(dir, "A project dir is required"), body(next)))
})

export const DELETE = withErrors("Failed to remove project", async req =>
  respond(await removeProject(requireParam(req.nextUrl.searchParams.get("dir"), "A project dir is required"))))
