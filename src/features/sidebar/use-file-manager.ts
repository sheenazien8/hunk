import { useCallback, useMemo, useState } from "react"
import type { ActionName, ActionPayload, RepoEntry } from "@/lib/git/types"
import {
  type NewItemKind,
  existingPaths,
  isUnder,
  joinPath,
  moveTargets,
  parentDir,
  remapPath,
  targetDir,
  validateName,
} from "./file-ops"

// An inline "new file/folder" row waiting for a name, inside `dir`.
export interface PendingCreate {
  dir: string
  kind: NewItemKind
}

// Sidebar file manager state: the folder new items go into, the inline
// create/rename inputs and drag-to-move. Repo changes go through `runAction`;
// the app reconciles tabs in its afterAction.
export function useFileManager({ entries, activeFile, runAction, expandDir }: {
  entries: RepoEntry[]
  activeFile: string | undefined
  runAction: (action: ActionName, payload?: ActionPayload) => Promise<boolean>
  // Expands `dir` and its ancestors in the tree.
  expandDir: (dir: string) => void
}) {
  // null = follow the active file's folder; "" = repo root.
  const [selectedDir, setSelectedDir] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingCreate | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // Paths being dragged (the selection when a selected row is dragged).
  const [dragging, setDragging] = useState<string[] | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const existing = useMemo(() => existingPaths(entries), [entries])
  // A selected folder that's gone (deleted, renamed elsewhere) stops counting.
  const selected = selectedDir && !existing.has(selectedDir) ? null : selectedDir
  const target = targetDir(selected, activeFile)

  const startCreate = useCallback((kind: NewItemKind, dir?: string) => {
    const into = dir ?? target
    expandDir(into)
    setRenaming(null)
    setPending({ dir: into, kind })
  }, [target, expandDir])

  const validateCreate = useCallback((name: string) => {
    return pending ? validateName(name, { dir: pending.dir, existing }) : null
  }, [pending, existing])

  const submitCreate = useCallback(async (name: string) => {
    if (!pending) return false
    const path = joinPath(pending.dir, name.trim())
    const ok = await runAction(pending.kind === "file" ? "create" : "createDir", { path })
    if (!ok) return false
    setPending(null)
    if (pending.kind === "dir") {
      setSelectedDir(path)
      expandDir(path)
    }
    return true
  }, [pending, runAction, expandDir])

  const validateRename = useCallback((name: string) => {
    return renaming ? validateName(name, { dir: parentDir(renaming), existing, current: renaming }) : null
  }, [renaming, existing])

  const move = useCallback(async (from: string, to: string) => {
    if (from === to) return true
    const ok = await runAction("rename", { path: from, to })
    if (ok && selectedDir) setSelectedDir(remapPath(selectedDir, from, to) ?? selectedDir)
    return ok
  }, [runAction, selectedDir])

  const submitRename = useCallback(async (name: string) => {
    if (!renaming) return false
    const ok = await move(renaming, joinPath(parentDir(renaming), name.trim()))
    if (ok) setRenaming(null)
    return ok
  }, [renaming, move])

  // Moves paths into `dir` ("" = root), skipping ones already there.
  const moveInto = useCallback(async (paths: string[], dir: string) => {
    const pairs = moveTargets(paths, dir)
    if (pairs.length === 0) return true
    const ok = await runAction("move", { files: paths, to: dir })
    if (ok && selectedDir) {
      for (const [from, to] of pairs) {
        const next = remapPath(selectedDir, from, to)
        if (next !== null) {
          setSelectedDir(next)
          break
        }
      }
    }
    return ok
  }, [runAction, selectedDir])

  // Drag and drop: folders (or "" for the root) that `dragging` can move
  // into — not inside a dragged folder, and not where everything already is.
  const canDropInto = useCallback((dir: string) => {
    return !!dragging && !dragging.some(p => isUnder(dir, p)) && dragging.some(p => parentDir(p) !== dir)
  }, [dragging])

  const drop = useCallback((dir: string) => {
    const paths = dragging
    setDragging(null)
    setDropTarget(null)
    if (paths && !paths.some(p => isUnder(dir, p))) void moveInto(paths, dir)
  }, [dragging, moveInto])

  const endDrag = useCallback(() => {
    setDragging(null)
    setDropTarget(null)
  }, [])

  // After deleting `path`, forget it as the selected folder.
  const forget = useCallback((path: string) => {
    setSelectedDir(d => (d && isUnder(d, path) ? null : d))
  }, [])

  return {
    selectedDir: selected,
    setSelectedDir,
    target,
    existing,
    pending,
    startCreate,
    cancelCreate: useCallback(() => setPending(null), []),
    validateCreate,
    submitCreate,
    renaming,
    startRename: useCallback((path: string) => {
      setPending(null)
      setRenaming(path)
    }, []),
    cancelRename: useCallback(() => setRenaming(null), []),
    validateRename,
    submitRename,
    dragging,
    setDragging,
    dropTarget,
    setDropTarget,
    canDropInto,
    drop,
    moveInto,
    endDrag,
    forget,
  }
}

export type FileManager = ReturnType<typeof useFileManager>
