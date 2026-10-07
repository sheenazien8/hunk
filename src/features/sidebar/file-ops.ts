// Pure helpers for the sidebar file manager: paths, name validation, and
// where new files land.
import { topLevelPaths } from "@/lib/repo-paths"

export { topLevelPaths }

export type NewItemKind = "file" | "dir"

export function parentDir(p: string): string {
  const i = p.lastIndexOf("/")
  return i === -1 ? "" : p.slice(0, i)
}

export function baseName(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1)
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

// True when `p` is `dir` itself or inside it.
export function isUnder(p: string, dir: string): boolean {
  return p === dir || p.startsWith(dir + "/")
}

// The path `p` ends up at after `from` is moved to `to`, or null when the
// move doesn't affect it.
export function remapPath(p: string, from: string, to: string): string | null {
  if (p === from) return to
  if (p.startsWith(from + "/")) return to + p.slice(from.length)
  return null
}

// Where New File / New Folder put things: the folder picked in the tree, else
// the active file's folder, else the repo root.
export function targetDir(selectedDir: string | null, activeFile: string | undefined): string {
  if (selectedDir !== null) return selectedDir
  return activeFile ? parentDir(activeFile) : ""
}

// Validates a name typed into the tree (it may contain "/" to create or move
// into sub-folders, relative to `dir`). Returns an error message, or null.
// `existing` holds every repo path the tree knows (files and dirs).
export function validateName(name: string, { dir, existing, current }: {
  dir: string
  existing: ReadonlySet<string>
  // Rename: the path being renamed (keeping it unchanged isn't an error).
  current?: string
}): string | null {
  const trimmed = name.trim()
  if (!trimmed) return "A name is required"
  if (trimmed.startsWith("/")) return "Name can't start with /"
  if (trimmed.includes("\\")) return "Use / to separate folders"
  const segments = trimmed.split("/")
  if (segments.some(s => s === "")) return "Name has an empty folder segment"
  if (segments.some(s => s === "." || s === "..")) return "Name can't contain . or .. segments"
  if (segments.some(s => s.toLowerCase() === ".git")) return ".git is reserved"
  const full = joinPath(dir, trimmed)
  if (full === current) return null
  if (current && isUnder(full, current)) return "Can't move a folder into itself"
  if (existing.has(full)) return `${trimmed} already exists`
  // A file in the way of a folder segment: "a.txt/b" when a.txt is a file.
  for (let i = 1; i < segments.length; i++) {
    const prefix = joinPath(dir, segments.slice(0, i).join("/"))
    if (existing.has(prefix + "\0file")) return `${segments.slice(0, i).join("/")} is a file`
  }
  return null
}

// The `existing` set validateName expects: every path, plus a "<path>\0file"
// marker for files so a file used as a folder segment is caught.
export function existingPaths(entries: ReadonlyArray<{ path: string; type?: string }>): Set<string> {
  const set = new Set<string>()
  for (const e of entries) {
    set.add(e.path)
    if (e.type !== "dir") set.add(e.path + "\0file")
    for (let d = parentDir(e.path); d; d = parentDir(d)) set.add(d)
  }
  return set
}

// Files in (or equal to) `dir`, for the delete confirmation.
export function countFilesUnder(entries: ReadonlyArray<{ path: string; type?: string }>, dir: string): number {
  return entries.filter(e => e.type !== "dir" && isUnder(e.path, dir)).length
}

// The part of a name to pre-select when renaming: the base name without its
// extension (dot files and folders select everything).
export function renameSelection(name: string, isDir: boolean): [number, number] {
  const dot = name.lastIndexOf(".")
  return isDir || dot <= 0 ? [0, name.length] : [0, dot]
}

// Validates the destination folder for moving `paths` ("" = repo root).
// Mirrors the server's checks so the Move dialog can say what's wrong while
// typing. `existing` comes from existingPaths().
export function validateMoveTarget(paths: string[], dest: string, existing: ReadonlySet<string>): string | null {
  const dir = dest.trim().replace(/\/+$/, "")
  if (dir) {
    if (dir.startsWith("/")) return "Folder can't start with /"
    if (dir.includes("\\")) return "Use / to separate folders"
    const segments = dir.split("/")
    if (segments.some(s => s === "")) return "Folder has an empty segment"
    if (segments.some(s => s === "." || s === "..")) return "Folder can't contain . or .. segments"
    if (segments.some(s => s.toLowerCase() === ".git")) return ".git is reserved"
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join("/")
      if (existing.has(prefix + "\0file")) return `${prefix} is a file`
    }
  }
  const top = topLevelPaths(paths)
  const inside = top.find(p => isUnder(dir, p))
  if (inside !== undefined && dir) return `Can't move ${baseName(inside)} into itself`
  const moving = top.filter(p => parentDir(p) !== dir)
  if (moving.length === 0) return "Already in that folder"
  const names = new Set<string>()
  for (const p of moving) {
    const name = baseName(p)
    if (names.has(name)) return `Two items are named ${name}`
    names.add(name)
    if (existing.has(joinPath(dir, name))) return `${joinPath(dir, name)} already exists`
  }
  return null
}

// Where each moved path ends up: [from, to] pairs, skipping items already in
// `dest` (the server does the same).
export function moveTargets(paths: string[], dest: string): [string, string][] {
  const dir = dest.trim().replace(/\/+$/, "")
  return topLevelPaths(paths)
    .filter(p => parentDir(p) !== dir)
    .map(p => [p, joinPath(dir, baseName(p))])
}
